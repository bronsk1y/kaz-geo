const citiesContainer = document.querySelector('#called-cities-container');

if (citiesContainer) {
  citiesContainer.addEventListener('mouseover', (event) => {
    const city = event.target.closest('.city');
    if (!city) return;

    if (city.contains(event.relatedTarget)) return;

    gsap.to(city, {
      borderRadius: '0px',
      duration: 0.5,
    });
  });

  citiesContainer.addEventListener('mouseout', (event) => {
    const city = event.target.closest('.city');
    if (!city) return;

    if (city.contains(event.relatedTarget)) return;

    gsap.to(city, {
      borderRadius: '20px',
      duration: 0.5,
    });
  });
}

const cityModal = document.createElement('div');
cityModal.className = 'city-modal';
cityModal.innerHTML = `
  <img class="city-modal__image" src="" alt="Увеличенное фото города" />
`;
document.body.appendChild(cityModal);

const cityModalImage = cityModal.querySelector('.city-modal__image');

function openCityModal(backgroundImageUrl) {
  if (!backgroundImageUrl) return;

  cityModalImage.src = backgroundImageUrl;
  cityModal.classList.add('is-open');
  document.body.style.overflow = 'hidden'; 
}

function closeCityModal() {
  cityModal.classList.remove('is-open');
  document.body.style.overflow = '';
}

if (citiesContainer) {
  citiesContainer.addEventListener('click', (event) => {
    const city = event.target.closest('.city');
    if (!city) return;

    if (city.classList.contains('city--no-image')) return;

    const bgImage = city.style.backgroundImage; // вида: url("https://...")
    const match = bgImage.match(/url\(["']?(.+?)["']?\)/);
    const imageUrl = match ? match[1] : null;

    openCityModal(imageUrl);
  });
}

cityModal.addEventListener('click', closeCityModal);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && cityModal.classList.contains('is-open')) {
    closeCityModal();
  }
});
