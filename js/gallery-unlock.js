// 스트리머별 업로드 잠금 해금 신청 모달(2026-09-05 추가) — 업로드 시도(js/gallery.js)나
// 잠긴 스트리머 이미지 클릭(js/gallery-detail.js) 시 window.galOpenUnlockModal로 열린다.
// 실제 후원 확인은 관리자가 수동으로 한다 — 이 모달은 신청 접수만 담당.
(function () {
  // soop-stock-market/StreamBet-Market 보물상자 후원과 동일한 관리자 SOOP 계정 후원 페이지 —
  // 이 사이트도 실제 후원은 관리자 본인 채널로 받고, 관리자가 방송에서 수동 확인 후 해금한다.
  var UNLOCK_DONATION_URL = 'https://st.sooplive.com/app/gift_starballoon.php?szBjId=skftodwocks2&szWork=BJ_STATION&sys_type=web&location=station';
  var backdrop = document.getElementById('unlock-backdrop');
  var closeBtn = document.getElementById('unlock-modal-close');
  var nameEl = document.getElementById('unlock-streamer-name');
  var nicknameInput = document.getElementById('unlock-nickname');
  var submitBtn = document.getElementById('unlock-submit-btn');
  var statusEl = document.getElementById('unlock-status');
  var cancelBtn = document.getElementById('unlock-cancel-btn');
  if (!backdrop) return;

  var currentStreamerId = null;
  var currentStreamerName = '';
  var currentPendingRequestId = null;

  function openModal(streamerId, streamerName) {
    if (!window.galTrusted) {
      window.galCloseLoginModal && window.galCloseLoginModal();
      window.galOpenLoginModal && window.galOpenLoginModal();
      return;
    }
    currentStreamerId = streamerId;
    currentStreamerName = streamerName;
    currentPendingRequestId = null;
    nameEl.textContent = streamerName;
    nicknameInput.value = '';
    statusEl.textContent = '';
    submitBtn.disabled = false;
    cancelBtn.style.display = 'none';
    backdrop.classList.add('open');
    window.galPushModal(closeModal);
  }
  function closeModal() { backdrop.classList.remove('open'); window.galPopModal(closeModal); }
  window.galOpenUnlockModal = openModal;
  window.galCloseUnlockModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });

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
      } else if (action === 'already-pending-mine') {
        statusEl.textContent = '⏳ 이미 대기 중인 내 해금 신청이 있어요. 후원창에서 별풍선을 보내주세요.';
        currentPendingRequestId = result.data.requestId;
        cancelBtn.style.display = '';
        window.open(UNLOCK_DONATION_URL, '_blank', 'noopener');
      } else if (action === 'already-pending') {
        statusEl.textContent = '⏳ 이미 대기 중인 해금 신청이 있어요. 후원창에서 별풍선을 보내주세요.';
        window.open(UNLOCK_DONATION_URL, '_blank', 'noopener');
      } else {
        statusEl.textContent = '✅ 해금 신청이 접수됐어요. 후원창에서 별풍선을 보내주시면 관리자가 확인 후 해금해드려요.';
        currentPendingRequestId = result.data.requestId;
        cancelBtn.style.display = '';
        window.open(UNLOCK_DONATION_URL, '_blank', 'noopener');
      }
    } catch (err) {
      console.error('해금 신청 실패', err);
      statusEl.textContent = '❌ 신청 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', async function () {
    if (!currentPendingRequestId) return;
    if (!confirm('해금 신청을 취소할까요?')) return;
    cancelBtn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('cancelStreamerUnlockRequest');
      await fn({ requestId: currentPendingRequestId });
      currentPendingRequestId = null;
      cancelBtn.style.display = 'none';
      statusEl.textContent = '신청을 취소했어요. 다시 신청할 수 있어요.';
    } catch (err) {
      alert('신청 취소 중 오류: ' + (err && err.message ? err.message : err));
    } finally {
      cancelBtn.disabled = false;
    }
  });
})();
