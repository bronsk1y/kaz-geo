// ====== НАСТРОЙКИ ======
const GEONAMES_USERNAME = 'Wujab'; 
const POLLING_INTERVAL_MS = 20000; 

// ====== DOM ЭЛЕМЕНТЫ ======
const cityInput = document.querySelector('#city-name');
const submitButton = document.querySelector('#submit-button');
const calledCitiesContainer = document.querySelector('#called-cities-container');
const forbiddenLettersEl = document.querySelector('.forbidden-letters');

// ====== СОСТОЯНИЕ ИГРЫ (синхронизируется с базой) ======
let currentRound = null; // { id, started_at, ends_at }
let lastCityLastLetter = null; // буква, на которую должен начинаться следующий город (из ОБЩЕГО списка)
let lastCityUserId = null; // user_id автора последнего названного города (для блокировки повторной отправки)
let knownCityIds = new Set(); // id городов, уже отрисованных на странице (чтобы не дублировать при поллинге)

// личное окно последних 5 букв ТЕКУЩЕГО игрока в рамках раунда
const FORBIDDEN_WINDOW_SIZE = 5;
let forbiddenLettersWindow = [];

// сколько карточек городов одновременно показывать на странице (визуальное окно,
// правила игры всё равно учитывают полную историю раунда из базы)
const VISIBLE_CITIES_LIMIT = 15;

// буквы, на которых игра не обрывается, а смещается на букву раньше
const EXCLUDED_LETTERS = ['Ы', 'Ь', 'Ъ'];

// альтернативные пары: если предыдущий город кончается на ключ,
// следующий может начинаться на любую из букв в значении
const ALTERNATIVE_LETTERS = {
  'Й': ['Й', 'И'],
  'И': ['И', 'Й'],
  'Ё': ['Ё', 'Е'],
  'Е': ['Е', 'Ё'],
};

// ====== УТИЛИТЫ ПРАВИЛ ИГРЫ ======

function normalizeForCompare(str) {
  return str
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-\s]/g, '')
    .trim();
}

function getEffectiveLastLetter(word) {
  const letters = word.toUpperCase().replace(/[^А-ЯЁ]/g, '');
  let i = letters.length - 1;

  while (i > 0 && EXCLUDED_LETTERS.includes(letters[i])) {
    i--;
  }

  return letters[i];
}

function getAllowedStartLetters(lastLetter) {
  return ALTERNATIVE_LETTERS[lastLetter] || [lastLetter];
}

// ====== ШТРАФНЫЕ БУКВЫ (личные для игрока) ======

function isLetterForbidden(letter) {
  return forbiddenLettersWindow.includes(letter);
}

function pushToForbiddenWindow(letter) {
  forbiddenLettersWindow.push(letter);
  if (forbiddenLettersWindow.length > FORBIDDEN_WINDOW_SIZE) {
    forbiddenLettersWindow.shift();
  }
}

function renderForbiddenLetters() {
  if (!forbiddenLettersEl) return;

  if (forbiddenLettersWindow.length === 0) {
    forbiddenLettersEl.innerHTML = '<span>Вы пока не назвали ни одного города</span>';
    return;
  }

  forbiddenLettersEl.innerHTML = forbiddenLettersWindow
    .map((letter) => `<div class="letter">${letter}</div>`)
    .join('');
}

// ====== УТИЛИТА: FETCH С ТАЙМАУТОМ ======
// Без таймаута на мобильной сети одно подвисшее соединение могло
// бесконечно "висеть", из-за чего весь процесс выглядел зависшим.

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ====== GEONAMES: ПОИСК И ПРОВЕРКА ГОРОДА ======

async function checkCityExists(cityName) {
  try {
    const response = await fetchWithTimeout(
      `https://secure.geonames.org/searchJSON?name_equals=${encodeURIComponent(
        cityName
      )}&featureClass=P&maxRows=5&lang=ru&username=${GEONAMES_USERNAME}`
    );

    if (!response.ok) return null;

    const data = await response.json();

    if (data.status) {
      console.error('Ошибка GeoNames:', data.status.message);
      return null;
    }

    const results = data.geonames || [];
    if (results.length === 0) return null;

    const priorityOrder = ['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPL', 'PPLX'];
    const sorted = [...results].sort(
      (a, b) => priorityOrder.indexOf(a.fcode) - priorityOrder.indexOf(b.fcode)
    );
    const best = sorted[0];

    return {
      foundName: best.name,
      country: best.countryName,
      region: best.adminName1 || null,
      geonameId: best.geonameId,
    };
  } catch (err) {
    console.error('Ошибка проверки города:', err);
    return null;
  }
}

async function getCityDetails(geonameId) {
  try {
    const response = await fetchWithTimeout(
      `https://secure.geonames.org/getJSON?geonameId=${geonameId}&lang=ru&username=${GEONAMES_USERNAME}`
    );

    if (!response.ok) return null;

    const data = await response.json();

    if (data.status) {
      console.error('Ошибка GeoNames:', data.status.message);
      return null;
    }

    return {
      population: data.population || null,
      adminName1: data.adminName1 || null,
    };
  } catch (err) {
    console.error('Ошибка загрузки деталей города:', err);
    return null;
  }
}

// ====== WIKIPEDIA: ТОЛЬКО ФОТО ======

async function getCityImage(cityName) {
  try {
    const response = await fetch(
      `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cityName)}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data.type === 'disambiguation') return null;

    if (data.originalimage?.source) {
      return data.originalimage.source;
    }

    if (data.thumbnail?.source) {
      return data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
    }

    return null;
  } catch (err) {
    console.error('Ошибка загрузки фото города:', err);
    return null;
  }
}

// ====== СБОРКА ТЕКСТА МЕТАДАННЫХ ======

function buildCityMeta(country, region, population) {
  const parts = [];

  if (population) {
    parts.push(`Население ${population.toLocaleString('ru-RU')} чел.`);
  }

  let locationPart = `страна: ${country}`;
  if (region) {
    locationPart += ` ${region}`;
  }
  parts.push(locationPart);

  return parts.join(', ');
}

// ====== РАУНДЫ ======

async function getActiveRound() {
  try {
    const { data, error } = await supabaseClient
      .from('rounds')
      .select('*')
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Ошибка загрузки раунда:', error.message);
      return null;
    }

    if (data && new Date(data.ends_at) <= new Date()) {
      return await rotateRound(data.id);
    }

    if (data) return data;

    return await createNewRound();
  } catch (err) {
    console.error('Сетевая ошибка при загрузке раунда:', err);
    return null;
  }
}

async function createNewRound() {
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + 3 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabaseClient
    .from('rounds')
    .insert({
      started_at: startedAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Ошибка создания раунда:', error.message);
    return null;
  }

  return data;
}

async function rotateRound(oldRoundId) {
  await supabaseClient.from('rounds').update({ is_active: false }).eq('id', oldRoundId);
  return await createNewRound();
}

// ====== ЗАГРУЗКА ГОРОДОВ РАУНДА ======

async function loadRoundCities(roundId) {
  try {
    const { data, error } = await supabaseClient
      .from('cities')
      .select('*')
      .eq('round_id', roundId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Ошибка загрузки городов:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Сетевая ошибка при загрузке городов:', err);
    return [];
  }
}

// ====== СОЗДАНИЕ КАРТОЧКИ ГОРОДА ======

function renderCityCard(cityRow) {
  const cityEl = document.createElement('div');
  cityEl.className = 'city city--no-image';
  cityEl.dataset.cityId = cityRow.id;

  const metaText = buildCityMeta(cityRow.country, cityRow.region, cityRow.population);

  cityEl.innerHTML = `
    <div class="city__overlay"></div>
    <div class="city__content">
      <div class="city__header">
        <span class="city__label">${cityRow.username} назвал</span>
      </div>
      <div class="city__title-row">
        <h3 class="city__name">${cityRow.city_name}</h3>
      </div>
      <p class="city__meta">${metaText}</p>
    </div>
  `;

  // новые города добавляются в начало списка (сверху)
  calledCitiesContainer.prepend(cityEl);
  trimVisibleCities();

  // фото подгружается в фоне, не блокируя отрисовку карточки и остальной список
  getCityImage(cityRow.city_name).then((cityImage) => {
    if (cityImage && cityEl.isConnected) {
      cityEl.classList.remove('city--no-image');
      cityEl.style.backgroundImage = `url("${cityImage}")`;
    }
  });
}

// убирает из DOM карточки сверх лимита (самые старые, то есть нижние в списке)
function trimVisibleCities() {
  const cards = calledCitiesContainer.children;
  while (cards.length > VISIBLE_CITIES_LIMIT) {
    calledCitiesContainer.removeChild(cards[cards.length - 1]);
  }
}

// ====== ИНИЦИАЛИЗАЦИЯ СОСТОЯНИЯ ИЗ БАЗЫ ======

async function initGameState() {
  const [round, sessionResult] = await Promise.all([
    getActiveRound(),
    supabaseClient.auth.getSession(),
  ]);

  currentRound = round;

  if (!currentRound) {
    showToast('Не удалось загрузить список городов. Проверьте соединение и обновите страницу.', 'error');
    return;
  }

  const cities = await loadRoundCities(currentRound.id);

  calledCitiesContainer.innerHTML = '';
  knownCityIds = new Set();

  // отрисовываем только последние VISIBLE_CITIES_LIMIT городов —
  // более старые всё равно сразу будут обрезаны trimVisibleCities,
  // так что не тратим на них запросы к Wikipedia
  const citiesToRender = cities.slice(-VISIBLE_CITIES_LIMIT);

  for (const cityRow of citiesToRender) {
    knownCityIds.add(cityRow.id);
    renderCityCard(cityRow);
  }

  // все города raunda (включая невидимые) всё равно считаются известными,
  // чтобы поллинг не пытался их повторно отрисовать при следующей проверке
  for (const cityRow of cities) {
    knownCityIds.add(cityRow.id);
  }

  if (cities.length > 0) {
    lastCityLastLetter = cities[cities.length - 1].last_letter;
    lastCityUserId = cities[cities.length - 1].user_id;
  } else {
    lastCityLastLetter = null;
    lastCityUserId = null;
  }

  const session = sessionResult.data.session;
  if (session) {
    const myCities = cities.filter((c) => c.user_id === session.user.id);
    forbiddenLettersWindow = myCities.slice(-FORBIDDEN_WINDOW_SIZE).map((c) => c.last_letter);
  } else {
    forbiddenLettersWindow = [];
  }

  renderForbiddenLetters();
}

// ====== ПОЛЛИНГ НОВЫХ ГОРОДОВ ======

async function pollForNewCities() {
  if (!currentRound) return;

  if (new Date(currentRound.ends_at) <= new Date()) {
    await initGameState();
    return;
  }

  const cities = await loadRoundCities(currentRound.id);
  const newCities = cities.filter((c) => !knownCityIds.has(c.id));

  if (newCities.length === 0) return;

  for (const cityRow of newCities) {
    knownCityIds.add(cityRow.id);
    renderCityCard(cityRow);
  }

  lastCityLastLetter = cities[cities.length - 1].last_letter;
  lastCityUserId = cities[cities.length - 1].user_id;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const myCities = cities.filter((c) => c.user_id === session.user.id);
    forbiddenLettersWindow = myCities.slice(-FORBIDDEN_WINDOW_SIZE).map((c) => c.last_letter);
    renderForbiddenLetters();
  }
}

// ====== ОБРАБОТЧИК ОТПРАВКИ ГОРОДА ======

submitButton.addEventListener('click', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showToast('Чтобы называть города, нужно зарегистрироваться или войти.', 'error');
    return;
  }

  if (!currentRound) {
    showToast('Не удалось загрузить текущий раунд игры. Обновите страницу.', 'error');
    return;
  }

  if (new Date(currentRound.ends_at) <= new Date()) {
    await initGameState();
    showToast('Раунд завершён, начался новый! Список городов обновлён.', 'info');
    return;
  }

  // блокировка: если последний город в раунде назвал ТЕКУЩИЙ игрок — он должен ждать другого игрока
  if (lastCityUserId && lastCityUserId === session.user.id) {
    showToast('Вы уже назвали город. Дождитесь хода другого игрока.', 'error');
    return;
  }

  const rawCityName = cityInput.value.trim();
  if (!rawCityName) {
    showToast('Введите название населённого пункта.', 'error');
    return;
  }

  if (lastCityLastLetter) {
    const allowedLetters = getAllowedStartLetters(lastCityLastLetter);
    const firstLetter = rawCityName.toUpperCase().replace(/[^А-ЯЁ]/g, '')[0];

    if (!allowedLetters.includes(firstLetter)) {
      showToast(`Город должен начинаться на букву "${allowedLetters.join('" или "')}"`, 'error');
      return;
    }
  }

  const normalizedInput = normalizeForCompare(rawCityName);

  submitButton.disabled = true;
  submitButton.textContent = 'Проверка...';

  // запускаем проверку дубликата и поиск города ПАРАЛЛЕЛЬНО —
  // это два независимых запроса, нет смысла ждать их по очереди
  const [duplicateCheck, cityData] = await Promise.all([
    supabaseClient
      .from('cities')
      .select('id')
      .eq('round_id', currentRound.id)
      .eq('normalized_name', normalizedInput)
      .maybeSingle(),
    checkCityExists(rawCityName),
  ]);

  const { data: existing, error: existingError } = duplicateCheck;

  if (existingError) {
    console.error('Ошибка проверки повтора:', existingError.message);
  }

  if (existing) {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
    showToast('Этот город уже был назван в текущем раунде.', 'error');
    return;
  }

  if (!cityData) {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
    showToast('Такого населённого пункта не существует. Попробуйте другой.', 'error');
    return;
  }

  const normalizedFound = normalizeForCompare(cityData.foundName);
  if (normalizedFound !== normalizedInput) {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
    showToast(`Не удалось точно подтвердить населённый пункт "${rawCityName}". Проверьте название.`, 'error');
    return;
  }

  const newLastLetter = getEffectiveLastLetter(cityData.foundName);

  if (isLetterForbidden(newLastLetter)) {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
    showToast(`Вы назвали город на штрафную букву "${newLastLetter}".`, 'error');
    return;
  }

  const username = session.user.user_metadata?.username || session.user.email.split('@')[0];

  // записываем город сразу с тем, что уже есть (без population/region из getCityDetails) —
  // не блокируем сохранение ожиданием ещё одного запроса к GeoNames
  const { data: insertedCity, error: insertError } = await supabaseClient
    .from('cities')
    .insert({
      round_id: currentRound.id,
      user_id: session.user.id,
      username: username,
      city_name: cityData.foundName,
      country: cityData.country,
      region: cityData.region || null,
      population: null,
      last_letter: newLastLetter,
      normalized_name: normalizedInput,
    })
    .select()
    .single();

  submitButton.disabled = false;
  submitButton.textContent = 'Отправить';

  if (insertError) {
    console.error('Ошибка сохранения города:', insertError.message);
    showToast('Не удалось сохранить город. Попробуйте ещё раз.', 'error');
    return;
  }

  knownCityIds.add(insertedCity.id);
  lastCityLastLetter = newLastLetter;
  lastCityUserId = insertedCity.user_id;
  pushToForbiddenWindow(newLastLetter);
  renderForbiddenLetters();

  // карточка отрисовывается сразу, фото и население подгрузятся в фоне
  renderCityCard(insertedCity);

  showToast(`Город «${insertedCity.city_name}» засчитан!`, 'success');

  cityInput.value = '';
  cityInput.focus();

  // население досчитываем в фоне и тихо обновляем запись в базе (не блокируя пользователя)
  getCityDetails(cityData.geonameId).then((details) => {
    if (details?.population) {
      supabaseClient
        .from('cities')
        .update({ population: details.population })
        .eq('id', insertedCity.id)
        .then(() => {
          const metaEl = document.querySelector(`[data-city-id="${insertedCity.id}"] .city__meta`);
          if (metaEl) {
            metaEl.textContent = buildCityMeta(insertedCity.country, insertedCity.region, details.population);
          }
        });
    }
  });
});

// ====== СТАРТ ======

initGameState();
setInterval(pollForNewCities, POLLING_INTERVAL_MS);
