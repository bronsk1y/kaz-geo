const POLLING_INTERVAL_MS = 20000;

const cityInput = document.querySelector('#city-name');
const submitButton = document.querySelector('#submit-button');
const calledCitiesContainer = document.querySelector('#called-cities-container');
const forbiddenLettersEl = document.querySelector('.forbidden-letters');

let currentRound = null;
let lastCityLastLetter = null;
let lastCityUserId = null;
let knownCityIds = new Set();

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

async function checkCityExists(cityName) {
  const normalized = normalizeForCompare(cityName);

  try {
    const { data, error } = await supabaseClient
      .from('ru_cities')
      .select('*')
      .eq('normalized_name', normalized)
      .limit(5);

    if (error) {
      console.error('Ошибка проверки города:', error.message);
    }

    if (data && data.length > 0) {
      const best = data[0];

      return {
        foundName: best.name,
        country: 'Россия',
        region: best.region_name || null,
        population: null,
      };
    }
  } catch (err) {
    console.error('Сетевая ошибка при проверке города в ru_cities:', err);
  }

  // город не найден в строгом российском реестре — пробуем Nominatim
  // как резервный источник (покрывает зарубежные и редкие города)
  return await checkCityViaNominatim(cityName);
}

async function checkCityViaNominatim(cityName) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=5&accept-language=ru&addressdetails=1`
    );

    if (!response.ok) return null;

    const results = await response.json();
    if (!results || results.length === 0) return null;

    const validTypes = ['city', 'town', 'village', 'hamlet', 'administrative'];
    const best = results.find(
      (r) => validTypes.includes(r.type) || validTypes.includes(r.addresstype)
    );

    if (!best) return null;

    return {
      foundName: best.display_name.split(',')[0],
      country: best.address?.country || best.display_name.split(',').pop().trim(),
      region: best.address?.state || best.address?.region || null,
      population: null,
    };
  } catch (err) {
    console.error('Сетевая ошибка при проверке города в Nominatim:', err);
    return null;
  }
}

async function fetchPopulationFromNominatim(cityName) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1&extratags=1&accept-language=ru`
    );

    if (!response.ok) return null;

    const results = await response.json();
    if (!results || results.length === 0) return null;

    const population = results[0]?.extratags?.population;
    return population ? parseInt(population, 10) : null;
  } catch (err) {
    console.error('Ошибка загрузки населения:', err);
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

function renderCityCard(cityRow) {
  const cityEl = document.createElement('div');
  cityEl.className = 'city city--no-image';
  cityEl.dataset.cityId = cityRow.id;

  const metaText = buildCityMeta(cityRow.country, cityRow.region, cityRow.population);

  cityEl.innerHTML = `
    <div class="city__overlay"></div>
    <div class="city__content">
      <div class="city__header">
        <span class="city__label">Игрок назвал</span>
        <span class="city__player">${cityRow.username}</span>
      </div>
      <div class="city__title-row">
        <h3 class="city__name">${cityRow.city_name}</h3>
      </div>
      <p class="city__meta">${metaText}</p>
    </div>
  `;

  calledCitiesContainer.prepend(cityEl);
  trimVisibleCities();

  getCityImage(cityRow.city_name).then((cityImage) => {
    if (cityImage && cityEl.isConnected) {
      cityEl.classList.remove('city--no-image');
      cityEl.style.backgroundImage = `url("${cityImage}")`;
    }
  });
}

function trimVisibleCities() {
  const cards = calledCitiesContainer.children;
  while (cards.length > VISIBLE_CITIES_LIMIT) {
    calledCitiesContainer.removeChild(cards[cards.length - 1]);
  }
}

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

  const citiesToRender = cities.slice(-VISIBLE_CITIES_LIMIT);

  for (const cityRow of citiesToRender) {
    knownCityIds.add(cityRow.id);
    renderCityCard(cityRow);
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

  const session = sessionResult.data.session;
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

  // всегда проверяем актуальное состояние раунда из базы,
  // а не доверяем currentRound в памяти — он мог устареть
  // если страница открыта дольше 3 дней без перезагрузки
  const freshRound = await getActiveRound();

  if (!freshRound) return;

  // если раунд сменился — полностью переинициализируем состояние
  if (freshRound.id !== currentRound.id) {
    await initGameState();
    showToast('Начался новый раунд! Список городов обновлён.', 'info');
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

function resetSubmitButton(button, originalText) {
  button.disabled = false;
  button.classList.remove('is-loading');
  button.textContent = originalText;
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
  submitButton.classList.add('is-loading');
  const originalButtonText = submitButton.textContent;
  submitButton.innerHTML = '<span class="button-spinner"></span>';

  const cityData = await checkCityExists(rawCityName);

  if (!cityData) {
    resetSubmitButton(submitButton, originalButtonText);
    showToast('Такого населённого пункта не существует. Попробуйте другой.', 'error');
    return;
  }

  const normalizedFound = normalizeForCompare(cityData.foundName);
  if (normalizedFound !== normalizedInput) {
    resetSubmitButton(submitButton, originalButtonText);
    showToast(`Не удалось точно подтвердить населённый пункт "${rawCityName}". Проверьте название.`, 'error');
    return;
  }

  const newLastLetter = getEffectiveLastLetter(cityData.foundName);
  const username = session.user.user_metadata?.username || session.user.email.split('@')[0];

  const allowedStartLetters = lastCityLastLetter
    ? getAllowedStartLetters(lastCityLastLetter)
    : null;

  const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('submit_city', {
    p_round_id: currentRound.id,
    p_user_id: session.user.id,
    p_username: username,
    p_city_name: cityData.foundName,
    p_country: cityData.country,
    p_region: cityData.region || null,
    p_population: null,
    p_last_letter: newLastLetter,
    p_normalized_name: normalizedInput,
    p_allowed_start_letters: allowedStartLetters,
  });

  console.log('DEBUG submit_city params:', {
    p_round_id: currentRound.id,
    p_user_id: session.user.id,
    p_city_name: cityData.foundName,
    p_last_letter: newLastLetter,
    p_normalized_name: normalizedInput,
    p_allowed_start_letters: allowedStartLetters,
  });
  console.log('DEBUG rpcError:', rpcError);
  console.log('DEBUG rpcResult:', rpcResult);

  resetSubmitButton(submitButton, originalButtonText);

  if (rpcError) {
    console.error('Ошибка отправки города:', rpcError.message, rpcError);
    showToast('Не удалось сохранить город. Попробуйте ещё раз.', 'error');
    return;
  }

  const { result_status, inserted_city } = rpcResult[0];

  if (result_status === 'duplicate') {
    showToast('Этот город уже был назван в текущем раунде.', 'error');
    return;
  }

  if (result_status === 'wrong_letter') {
    showToast(`Город должен начинаться на правильную букву — кто-то опередил вас с ходом.`, 'error');
    await pollForNewCities();
    return;
  }

  if (result_status === 'not_your_turn') {
    showToast('Сейчас не ваша очередь — кто-то уже сходил перед вами.', 'error');
    await pollForNewCities();
    return;
  }

  if (result_status === 'forbidden_letter') {
    showToast(`Вы назвали город на штрафную букву "${newLastLetter}".`, 'error');
    return;
  }

  if (result_status === 'round_expired') {
    await initGameState();
    showToast('Раунд завершён, начался новый! Список городов обновлён.', 'info');
    return;
  }

  if (result_status !== 'success' || !inserted_city) {
    showToast('Не удалось сохранить город. Попробуйте ещё раз.', 'error');
    return;
  }

  const insertedCity = inserted_city;

  knownCityIds.add(insertedCity.id);
  lastCityLastLetter = newLastLetter;
  lastCityUserId = insertedCity.user_id;
  pushToForbiddenWindow(newLastLetter);
  renderForbiddenLetters();

  renderCityCard(insertedCity);

  showToast(`Город «${insertedCity.city_name}» засчитан!`, 'success');

  cityInput.value = '';
  cityInput.focus();

  fetchPopulationFromNominatim(insertedCity.city_name).then((population) => {
    if (!population) return;

    supabaseClient
      .from('cities')
      .update({ population })
      .eq('id', insertedCity.id)
      .then(() => {
        const cityEl = calledCitiesContainer.querySelector(`[data-city-id="${insertedCity.id}"]`);
        if (cityEl) {
          const metaEl = cityEl.querySelector('.city__meta');
          if (metaEl) {
            metaEl.textContent = buildCityMeta(insertedCity.country, insertedCity.region, population);
          }
        }
      });
  });
});

initGameState();
setInterval(pollForNewCities, POLLING_INTERVAL_MS);
