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

    if (!newUsername) {
      showToast('Имя не может быть пустым.', 'error');
      return;
    }

    if (newUsername.length > 30) {
      showToast('Имя слишком длинное (максимум 30 символов).', 'error');
      return;
    }

    saveUsernameButton.disabled = true;

    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        data: { username: newUsername },
      });

      saveUsernameButton.disabled = false;

      if (error) {
        showToast('Не удалось сохранить имя: ' + error.message, 'error');
        return;
      }

      // обновляем отображаемое имя в кнопке хедера
      const authLink = document.querySelector('#auth-link');
      if (authLink) authLink.textContent = newUsername;

      showToast('Имя успешно обновлено!', 'success');
    } catch (err) {
      saveUsernameButton.disabled = false;
      console.error('Непойманная ошибка смены имени:', err);
      showToast('Не удалось сохранить имя. Проверьте соединение и попробуйте снова.', 'error');
    }
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
