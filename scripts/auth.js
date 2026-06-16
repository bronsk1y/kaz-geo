async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const authLink = document.querySelector('#auth-link');
  const profilePicture = document.querySelector('#profile-picture');
  const dropdown = document.querySelector('#profile-dropdown');
  const dropdownUsernameInput = document.querySelector('#dropdown-username');

  if (session) {
    const username = session.user.user_metadata?.username || session.user.email.split('@')[0];

    authLink.textContent = username;
    authLink.removeAttribute('href');
    authLink.style.cursor = 'pointer';
    profilePicture.style.display = 'block';
    dropdownUsernameInput.value = username;

    const toggleDropdown = (e) => {
      e.preventDefault();
      dropdown.classList.toggle('is-open');
    };

    authLink.addEventListener('click', toggleDropdown);
    profilePicture.addEventListener('click', toggleDropdown);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#auth-link-item')) {
        dropdown.classList.remove('is-open');
      }
    });
  } else {
    authLink.textContent = 'Зарегистрироваться';
    authLink.href = 'register/index.html';
  }
}

// ====== ИЗМЕНЕНИЕ ИМЕНИ ПОЛЬЗОВАТЕЛЯ ======

const saveUsernameButton = document.querySelector('#save-username-button');
const dropdownUsernameInput = document.querySelector('#dropdown-username');

if (saveUsernameButton && dropdownUsernameInput) {
  saveUsernameButton.addEventListener('click', async (event) => {
    event.stopPropagation(); // не закрывать меню кликом по кнопке сохранения

    const newUsername = dropdownUsernameInput.value.trim();
    const authLink = document.querySelector('#auth-link');
    
    // Запоминаем старое имя на случай, если сервер вернет ошибку
    const oldUsername = authLink ? authLink.textContent : '';

    if (!newUsername) {
      showToast('Имя не может быть пустым.', 'error');
      return;
    }

    if (newUsername.length > 30) {
      showToast('Имя слишком длинное (максимум 30 символов).', 'error');
      return;
    }

    // === ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ UI ===
    // Меняем имя в шапке мгновенно, до запроса к БД
    if (authLink) {
      authLink.textContent = newUsername;
    }

    // Даем визуальный отклик на кнопке
    saveUsernameButton.disabled = true;
    const originalButtonText = saveUsernameButton.textContent;
    saveUsernameButton.textContent = 'Сохраняем...'; 

    // Отправляем запрос на сервер
    const { data, error } = await supabaseClient.auth.updateUser({
      data: { username: newUsername },
    });

    // Возвращаем кнопку в исходное состояние
    saveUsernameButton.disabled = false;
    saveUsernameButton.textContent = originalButtonText;

    if (error) {
      // Если произошла ошибка сети или базы данных — откатываем имя обратно
      if (authLink) {
        authLink.textContent = oldUsername;
      }
      showToast('Не удалось сохранить имя: ' + error.message, 'error');
      return;
    }

    showToast('Имя успешно обновлено!', 'success');
  });

  // не закрывать выпадающее меню при клике/вводе текста в само поле
  dropdownUsernameInput.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

document.querySelector('#logout-button')?.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.reload();
});

checkAuth();
