// 계정 단위 프로필(업로드 시 입력하는 스트리머 이름과 별개, 선택 입력) —
// rocket-game의 js/profile-modal.js를 그대로 참고. #open-login-btn 하나를
// 로그인 전엔 로그인 모달, 로그인 후엔 이 프로필 모달을 여는 버튼으로 이중 사용한다.
(function () {
  var openBtn = document.getElementById('open-login-btn');
  var backdrop = document.getElementById('profile-edit-backdrop');
  var closeBtn = document.getElementById('profile-edit-close');
  var nicknameInput = document.getElementById('profile-nickname');
  var soopIdInput = document.getElementById('profile-soopid');
  var previewImg = document.getElementById('profile-preview-img');
  var previewPlaceholder = document.getElementById('profile-preview-placeholder');
  var errorEl = document.getElementById('profile-error');
  var saveBtn = document.getElementById('profile-save-btn');
  var statusEl = document.getElementById('profile-status');
  if (!backdrop || !openBtn) return;

  var currentProfile = null;

  function computeAvatarSrc(soopId) {
    var folder = soopId.slice(0, 2);
    return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
  }

  // innerHTML 문자열 조립 대신 DOM API로 이미지를 넣어 XSS 위험 자체를 없앤다.
  function applyButtonState(nickname, avatarUrl) {
    openBtn.innerHTML = '';
    if (avatarUrl) {
      openBtn.classList.remove('avatar-login');
      var img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:2px;';
      openBtn.appendChild(img);
    } else {
      openBtn.classList.add('avatar-login');
      openBtn.textContent = nickname || '내 계정';
    }
  }

  var unsubscribeProfile = null;
  document.addEventListener('gal-auth-changed', function (e) {
    if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
    if (!e.detail.trusted) {
      currentProfile = null;
      openBtn.classList.add('avatar-login');
      openBtn.innerHTML = '';
      openBtn.textContent = '로그인';
      document.dispatchEvent(new CustomEvent('gal-profile-changed', { detail: null }));
      return;
    }
    var fb = window.galFirebase;
    var uid = e.detail.user.uid;
    unsubscribeProfile = fb.onValue(fb.ref(window.galDb, 'gallery/profiles/' + uid), function (snap) {
      var saved = snap.val();
      currentProfile = saved || { nickname: '', soopId: '', avatarUrl: '' };
      // 프로필을 아직 한 번도 저장한 적 없으면(닉네임도, 아바타도 없으면) 구글 실명 등을
      // 그대로 노출하는 대신 "OO 로그인 완료"를 보여준다.
      if (currentProfile.nickname || currentProfile.avatarUrl) {
        applyButtonState(currentProfile.nickname, currentProfile.avatarUrl);
      } else {
        applyButtonState((window.galLoginMethodLabel && window.galLoginMethodLabel()) || '로그인 완료', '');
      }
      document.dispatchEvent(new CustomEvent('gal-profile-changed', { detail: currentProfile }));
    });
  });

  function openModal() {
    if (!window.galTrusted) { window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    var p = currentProfile || {};
    nicknameInput.value = p.nickname || '';
    soopIdInput.value = p.soopId || '';
    if (p.avatarUrl) {
      previewImg.src = p.avatarUrl;
      previewImg.style.display = 'block';
      previewPlaceholder.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
    }
    errorEl.classList.remove('show');
    statusEl.classList.remove('show');
    saveBtn.disabled = false;
    backdrop.classList.add('open');
    nicknameInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }
  window.galOpenProfileModal = openModal;

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  soopIdInput.addEventListener('input', function () {
    var id = soopIdInput.value.trim();
    if (id.length < 2) {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
      return;
    }
    previewImg.onload = function () { previewImg.style.display = 'block'; previewPlaceholder.style.display = 'none'; };
    previewImg.onerror = function () { previewImg.style.display = 'none'; previewPlaceholder.style.display = ''; };
    previewImg.src = computeAvatarSrc(id);
  });

  saveBtn.addEventListener('click', function () {
    var name = nicknameInput.value.trim();
    if (name.length > 12 || /[<>\x00-\x1F\x7F]/.test(name)) {
      errorEl.textContent = '닉네임은 12자 이하, 사용할 수 없는 문자 없이 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    var soopId = soopIdInput.value.trim();
    if (soopId && !/^[a-z0-9]{2,20}$/.test(soopId)) {
      errorEl.textContent = 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    saveBtn.disabled = true;
    statusEl.classList.remove('show');

    window.galFirebase.httpsCallable('updateGalleryProfile')({ nickname: name, soopId: soopId })
      .then(function () {
        saveBtn.disabled = false;
        statusEl.textContent = '프로필이 저장됐습니다.';
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        errorEl.textContent = err.message || '저장 중 오류가 발생했습니다.';
        errorEl.classList.add('show');
      });
  });
})();
