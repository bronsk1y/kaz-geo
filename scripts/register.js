const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

const registerButton = document.querySelector('#register-button');
const emailInput = document.querySelector('#email-field');
const passwordInput = document.querySelector('#password-field');

registerButton.addEventListener('click', async () => {
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

  if (password.length < 6) {
    showToast('Пароль должен содержать минимум 6 символов.', 'error');
    return;
  }

  const cleanEmail = rawEmail.toLowerCase();

  const defaultUsername = cleanEmail.split('@')[0];

  registerButton.disabled = true;
  registerButton.textContent = 'Регистрация...';

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        data: {
          username: defaultUsername,
        },
      },
    });

    registerButton.disabled = false;
    registerButton.textContent = 'Зарегистрироваться';

    if (error) {
      showToast('Ошибка регистрации: ' + error.message, 'error');
      return;
    }

    showToast('Регистрация прошла успешно!', 'success');

    setTimeout(() => {
      window.location.href = '../index.html';
    }, 1200);
  } catch (err) {
    registerButton.disabled = false;
    registerButton.textContent = 'Зарегистрироваться';
    console.error('Непойманная ошибка регистрации:', err);
    showToast('Не удалось зарегистрироваться. Проверьте соединение и попробуйте снова.', 'error');
  }
});
