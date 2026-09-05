(function () {
  var backdrop = document.getElementById('login-backdrop');
  var closeBtn = document.getElementById('login-modal-close');
  var googleBtn = document.getElementById('login-google-btn');
  if (!backdrop) return;

  function openModal() { backdrop.classList.add('open'); window.galPushModal(closeModal); }
  function closeModal() { backdrop.classList.remove('open'); window.galPopModal(closeModal); }

  window.galOpenLoginModal = openModal;
  window.galCloseLoginModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });

  googleBtn.addEventListener('click', function () {
    window.galSignIn && window.galSignIn();
  });

  document.addEventListener('gal-auth-changed', function (e) {
    if (e.detail.realUser) closeModal();
  });
})();
