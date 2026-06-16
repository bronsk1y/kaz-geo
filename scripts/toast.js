// ====== УНИВЕРСАЛЬНАЯ СИСТЕМА TOAST-УВЕДОМЛЕНИЙ ======
// Подключите этот файл раньше main.js и cities-animations.js,
// чтобы функция showToast была доступна в них.

const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

/**
 * Показывает выпадающее снизу уведомление.
 * @param {string} message - текст уведомления
 * @param {'info'|'error'|'success'} type - тип уведомления (влияет на цвет)
 * @param {number} duration - сколько мс показывать перед скрытием
 */
function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // небольшая задержка перед добавлением класса анимации, чтобы transition сработал
  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}