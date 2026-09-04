// 스트리머별 업로드 잠금 해금 신청 모달(2026-09-05 추가) — 업로드 시도(js/gallery.js)나
// 잠긴 스트리머 이미지 클릭(js/gallery-detail.js) 시 window.galOpenUnlockModal로 열린다.
// 실제 후원 확인은 관리자가 수동으로 한다 — 이 모달은 신청 접수만 담당.
(function () {
  var backdrop = document.getElementById('unlock-backdrop');
  var closeBtn = document.getElementById('unlock-modal-close');
  var nameEl = document.getElementById('unlock-streamer-name');
  var nicknameInput = document.getElementById('unlock-nickname');
  var submitBtn = document.getElementById('unlock-submit-btn');
  var statusEl = document.getElementById('unlock-status');
  if (!backdrop) return;

  var currentStreamerId = null;
  var currentStreamerName = '';

  function openModal(streamerId, streamerName) {
    if (!window.galTrusted) {
      window.galCloseLoginModal && window.galCloseLoginModal();
      window.galOpenLoginModal && window.galOpenLoginModal();
      return;
    }
    currentStreamerId = streamerId;
    currentStreamerName = streamerName;
    nameEl.textContent = streamerName;
    nicknameInput.value = '';
    statusEl.textContent = '';
    submitBtn.disabled = false;
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }
  window.galOpenUnlockModal = openModal;
  window.galCloseUnlockModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });

  submitBtn.addEventListener('click', async function () {
    if (!currentStreamerId) return;
    var nickname = nicknameInput.value.trim();
    if (!nickname) { statusEl.textContent = '⚠️ 후원할 때 쓸 닉네임을 입력해 주세요.'; return; }

    submitBtn.disabled = true;
    statusEl.textContent = '⏳ 신청 처리 중...';
    try {
      var fn = window.galFirebase.httpsCallable('requestStreamerUnlock');
      var result = await fn({ streamerId: currentStreamerId, streamerName: currentStreamerName, nickname: nickname });
      var action = result.data.action;
      if (action === 'already-unlocked') {
        statusEl.textContent = '✅ 이미 해금된 스트리머예요! 새로고침하면 반영돼요.';
      } else if (action === 'already-pending') {
        statusEl.textContent = '⏳ 이미 대기 중인 해금 신청이 있어요. 관리자 확인을 기다려 주세요.';
      } else {
        statusEl.textContent = '✅ 해금 신청이 접수됐어요. 관리자가 후원을 확인한 뒤 해금해드려요.';
      }
    } catch (err) {
      console.error('해금 신청 실패', err);
      statusEl.textContent = '❌ 신청 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
