(function () {
  var backdrop = document.getElementById('login-backdrop');
  var closeBtn = document.getElementById('login-modal-close');
  var googleBtn = document.getElementById('login-google-btn');
  if (!backdrop) return;

  function openModal() { backdrop.classList.add('open'); }
  function closeModal() { backdrop.classList.remove('open'); }

  window.galOpenLoginModal = openModal;
  window.galCloseLoginModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  googleBtn.addEventListener('click', function () {
    window.galSignIn && window.galSignIn();
  });

  document.addEventListener('gal-auth-changed', function (e) {
    if (e.detail.realUser) closeModal();
  });
})();
