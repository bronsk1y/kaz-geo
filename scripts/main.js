const GEONAMES_USERNAME = 'Wujab';
const POLLING_INTERVAL_MS = 10000;

const cityInput = document.querySelector('#city-name');
const submitButton = document.querySelector('#submit-button');
const calledCitiesContainer = document.querySelector('#called-cities-container');
const forbiddenLettersEl = document.querySelector('.forbidden-letters');

let currentRound = null;
let lastCityLastLetter = null;
let lastCityUserId = null;
let knownCityIds = new Set();
let isPolling = false; // Предохранитель от параллельных запросов и дублирования

const FORBIDDEN_WINDOW_SIZE = 5;
let forbiddenLettersWindow = [];

const VISIBLE_CITIES_LIMIT = 15;

const EXCLUDED_LETTERS = ['Ы', 'Ь', 'Ъ'];

const ALTERNATIVE_LETTERS = {
  'Й': ['Й', 'И'],
  'И': ['И', 'Й'],
  'Ё': ['Ё', 'Е'],
  'Е': ['Е', 'Ё'],
};

let penaltyEndsAt = 0;
let penaltyTimerInterval = null;

(function injectCityNameStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .city__letter-first {
      text-decoration: underline dotted 2px;
      text-underline-offset: 4px;
    }
    .city__letter-last {
      color: lightgreen;
      text-decoration: underline solid 2px;
      text-underline-offset: 2px;
    }
    .city__letter-cross {
      position: relative;
      display: inline;
    }
    .city__letter-cross::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(
          to bottom right,
          transparent calc(50% - 1.5px),
          #ef4444 calc(50% - 1.5px),
          #ef4444 calc(50% + 1.5px),
          transparent calc(50% + 1.5px)
        ),
        linear-gradient(
          to bottom left,
          transparent calc(50% - 1.5px),
          #ef4444 calc(50% - 1.5px),
          #ef4444 calc(50% + 1.5px),
          transparent calc(50% + 1.5px)
        );
    }
  `;
  document.head.appendChild(style);
})();

function buildCityNameHTML(cityName) {
  const chars = [...cityName];

  const cyrillicPositions = [];
  for (let i = 0; i < chars.length; i++) {
    if (/[А-ЯЁа-яё]/.test(chars[i])) cyrillicPositions.push(i);
  }

  if (cyrillicPositions.length === 0) return cityName;

  const firstOrigIdx = cyrillicPositions[0];
  const lastOrigIdx = cyrillicPositions[cyrillicPositions.length - 1];

  let effPosIdx = cyrillicPositions.length - 1;
  while (effPosIdx > 0 && EXCLUDED_LETTERS.includes(chars[cyrillicPositions[effPosIdx]].toUpperCase())) {
    effPosIdx--;
  }
  const effectiveLastOrigIdx = cyrillicPositions[effPosIdx];

  const hasCross = effectiveLastOrigIdx !== lastOrigIdx;
  const crossStart = effectiveLastOrigIdx;
  const crossEnd = lastOrigIdx;

  let html = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isFirst = i === firstOrigIdx;
    const isEffLast = i === effectiveLastOrigIdx;
    const isCrossStart = hasCross && i === crossStart;
    const isCrossEnd = hasCross && i === crossEnd;

    if (isCrossStart) html += `<span class="city__letter-cross">`;

    if (isFirst && isEffLast) {
      html += `<span class="city__letter-first city__letter-last">${ch}</span>`;
    } else if (isFirst) {
      html += `<span class="city__letter-first">${ch}</span>`;
    } else if (isEffLast) {
      html += `<span class="city__letter-last">${ch}</span>`;
    } else {
      html += ch;
    }

    if (isCrossEnd) html += `</span>`;
  }

  return html;
}

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

function applyPenalty() {
  const now = Date.now();
  penaltyEndsAt = Math.max(penaltyEndsAt, now) + 60_000;
  startPenaltyTimer();
}

function startPenaltyTimer() {
  if (penaltyTimerInterval) return;

  submitButton.disabled = true;

  penaltyTimerInterval = setInterval(() => {
    const remaining = Math.ceil((penaltyEndsAt - Date.now()) / 1000);

    if (remaining <= 0) {
      clearInterval(penaltyTimerInterval);
      penaltyTimerInterval = null;
      submitButton.disabled = false;
      submitButton.textContent = 'Отправить';
      return;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const label = minutes > 0
      ? `${minutes}:${String(seconds).padStart(2, '0')}`
      : `${seconds} сек.`;

    submitButton.textContent = `Штраф: ${label}`;
  }, 500);
}

async function checkCityExists(cityName) {
  try {
    const response = await fetch(
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
    const response = await fetch(
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

async function getActiveRound() {
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

async function loadRoundCities(roundId) {
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
}

async function renderCityCard(cityRow) {
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
        <h3 class="city__name">${buildCityNameHTML(cityRow.city_name)}</h3>
      </div>
      <p class="city__meta">${metaText}</p>
    </div>
  `;

  calledCitiesContainer.prepend(cityEl);
  trimVisibleCities();

  const cityImage = await getCityImage(cityRow.city_name);
  if (cityImage) {
    cityEl.classList.remove('city--no-image');
    cityEl.style.backgroundImage = `url("${cityImage}")`;
  }
}

function trimVisibleCities() {
  const cards = calledCitiesContainer.children;
  while (cards.length > VISIBLE_CITIES_LIMIT) {
    calledCitiesContainer.removeChild(cards[cards.length - 1]);
  }
}

async function initGameState() {
  currentRound = await getActiveRound();

  if (!currentRound) {
    console.error('Не удалось получить активный раунд.');
    return;
  }

  const cities = await loadRoundCities(currentRound.id);

  calledCitiesContainer.innerHTML = '';
  knownCityIds = new Set();

  const citiesToRender = cities.slice(-VISIBLE_CITIES_LIMIT);

  for (const cityRow of citiesToRender) {
    knownCityIds.add(cityRow.id);
    await renderCityCard(cityRow);
  }

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

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const myCities = cities.filter((c) => c.user_id === session.user.id);
    forbiddenLettersWindow = myCities.slice(-FORBIDDEN_WINDOW_SIZE).map((c) => c.last_letter);
  } else {
    forbiddenLettersWindow = [];
  }

  renderForbiddenLetters();
}

async function pollForNewCities() {
  if (!currentRound) return;

  // Если прошлый запрос пуллинга ещё выполняется, игнорируем новый такт таймера
  if (isPolling) return;

  if (new Date(currentRound.ends_at) <= new Date()) {
    await initGameState();
    return;
  }

  try {
    isPolling = true;

    const cities = await loadRoundCities(currentRound.id);
    const newCities = cities.filter((c) => !knownCityIds.has(c.id));

    if (newCities.length === 0) return;

    // Шаг 1: Моментально регистрируем все новые ID городов в Set,
    // чтобы повторные вызовы pollForNewCities не посчитали их новыми.
    for (const cityRow of newCities) {
      knownCityIds.add(cityRow.id);
    }

    // Шаг 2: Асинхронно рендерим карточки (где внутри запрашивается Wikipedia API)
    for (const cityRow of newCities) {
      await renderCityCard(cityRow);
    }

    lastCityLastLetter = cities[cities.length - 1].last_letter;
    lastCityUserId = cities[cities.length - 1].user_id;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      const myCities = cities.filter((c) => c.user_id === session.user.id);
      forbiddenLettersWindow = myCities.slice(-FORBIDDEN_WINDOW_SIZE).map((c) => c.last_letter);
      renderForbiddenLetters();
    }
  } catch (err) {
    console.error('Ошибка во время пуллинга городов:', err);
  } finally {
    isPolling = false;
  }
}

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

  if (Date.now() < penaltyEndsAt) {
    const remaining = Math.ceil((penaltyEndsAt - Date.now()) / 1000);
    showToast(`Вы на штрафе. Подождите ещё ${remaining} сек.`, 'error');
    return;
  }

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

  const { data: existing, error: existingError } = await supabaseClient
    .from('cities')
    .select('id')
    .eq('round_id', currentRound.id)
    .eq('normalized_name', normalizedInput)
    .maybeSingle();

  if (existingError) {
    console.error('Ошибка проверки повтора:', existingError.message);
  }

  if (existing) {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
    showToast('Этот город уже был назван в текущем раунде.', 'error');
    return;
  }

  const cityData = await checkCityExists(rawCityName);

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
    applyPenalty();
    const stacks = Math.round((penaltyEndsAt - Date.now()) / 60_000);
    showToast(
      `Штрафная буква «${newLastLetter}»! Вы не можете писать ${stacks} мин.`,
      'error'
    );
    return;
  }

  const details = await getCityDetails(cityData.geonameId);

  const username = session.user.user_metadata?.username || session.user.email.split('@')[0];

  const { data: insertedCity, error: insertError } = await supabaseClient
    .from('cities')
    .insert({
      round_id: currentRound.id,
      user_id: session.user.id,
      username: username,
      city_name: cityData.foundName,
      country: cityData.country,
      region: details?.adminName1 || cityData.region || null,
      population: details?.population || null,
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

  await renderCityCard(insertedCity);

  showToast(`Город «${insertedCity.city_name}» засчитан!`, 'success');

  cityInput.value = '';
  cityInput.focus();
});

initGameState();
setInterval(pollForNewCities, POLLING_INTERVAL_MS);
