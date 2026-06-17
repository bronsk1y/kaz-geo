// ====== ВАЛИДАЦИЯ EMAIL ======

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

// ====== DOM ЭЛЕМЕНТЫ ======

const loginButton = document.querySelector('#login-button');
const emailInput = document.querySelector('#email-field');
const passwordInput = document.querySelector('#password-field');

// ====== ОБРАБОТЧИК ВХОДА ======

loginButton.addEventListener('click', async (event) => {
  event.preventDefault();

  const rawEmail = emailInput.value.trim();
  const password = passwordInput.value;

  if (!rawEmail || !password) {
    showToast('Пожалуйста, заполните все поля.', 'error');
    return;
  }

  if (!isValidEmail(rawEmail)) {
    showToast('Введите корректный email адрес.', 'error');
    return;
  }

  const cleanEmail = rawEmail.toLowerCase();

  loginButton.disabled = true;
  loginButton.textContent = 'Вход...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    });

    loginButton.disabled = false;
    loginButton.textContent = 'Войти';

    if (error) {
      showToast('Ошибка входа: ' + error.message, 'error');
      return;
    }

    showToast('Вход выполнен успешно!', 'success');

    setTimeout(() => {
      window.location.href = '../index.html';
    }, 1000);
  } catch (err) {
    // непойманная ошибка (сеть пропала, запрос прервался и т.д.) —
    // без этого блока кнопка молча "зависала" бы на тексте "Вход..." навсегда
    loginButton.disabled = false;
    loginButton.textContent = 'Войти';
    console.error('Непойманная ошибка входа:', err);
    showToast('Не удалось выполнить вход. Проверьте соединение и попробуйте снова.', 'error');
  }
});
