// 스트리머 상세보기 열람 연장 모달 — 업로드 시도(js/gallery.js)나 잠긴 스트리머 이미지 클릭(js/gallery-detail.js) 시
// window.galOpenUnlockModal로 열린다. 2026-11-13부터 통합 캐시 결제만 받는다(galleryStreamerUnlockPurchase).
// 결제가 끝나면 서버가 gallery/streamerUnlockedUntil을 늘리고, 화면은 그 값을 실시간으로 받아 잠금을 푼다.
(function () {
  var backdrop = document.getElementById('unlock-backdrop');
  var closeBtn = document.getElementById('unlock-modal-close');
  var nameEl = document.getElementById('unlock-streamer-name');
  var priceEl = document.getElementById('unlock-cash-price');
  var statusEl = document.getElementById('unlock-status');
  var payBtn = document.getElementById('unlock-pay-btn');
  var chargeLink = document.getElementById('unlock-charge-link');
  if (!backdrop) return;

  var currentStreamerId = '';
  var priceCash = 10;
  var busy = false;
  var checking = false;
  var timer = 0;

  function callPurchase(data) { return window.galFirebase.httpsCallable('galleryStreamerUnlockPurchase')(data); }
  function message(err, fallback) {
    var text = err && err.message ? String(err.message) : '';
    return text && !/^FirebaseError:|^internal$/i.test(text) ? text : fallback;
  }
  function formatDate(at) {
    return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  }
  function payLabel() { payBtn.textContent = priceCash + '캐시로 열기'; }

  // 결과를 모르는 채로 끊긴 결제는 같은 요청 번호로 다시 보내 이중 차감을 막는다.
  function requestKey(streamerId) { return 'galUnlockRequest:' + streamerId; }
  function requestId(streamerId) {
    try {
      var saved = sessionStorage.getItem(requestKey(streamerId));
      if (saved) return saved;
    } catch (_) { /* 무시 */ }
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    var id = 'gu_' + Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try { sessionStorage.setItem(requestKey(streamerId), id); } catch (_) { /* 무시 */ }
    return id;
  }
  function dropRequestId(streamerId) { try { sessionStorage.removeItem(requestKey(streamerId)); } catch (_) { /* 무시 */ } }
  // 확정 실패(잔액 부족·이미 환불됨 등)면 다음 시도는 새 번호로, 결과 불명(네트워크 등)이면 같은 번호를 유지한다.
  function definiteFailure(err) {
    var code = String(err && err.code || '').replace(/^functions\//, '');
    return ['failed-precondition', 'invalid-argument', 'already-exists', 'not-found', 'permission-denied', 'resource-exhausted'].indexOf(code) >= 0;
  }

  function refreshStatus() {
    if (checking || busy || !currentStreamerId || !backdrop.classList.contains('open')) return;
    checking = true;
    var streamerId = currentStreamerId;
    callPurchase({ action: 'status', streamerId: streamerId }).then(function (res) {
      if (busy || streamerId !== currentStreamerId) return;
      var data = res.data || {};
      priceCash = Number(data.priceCash) || priceCash;
      priceEl.textContent = String(priceCash); payLabel();
      var cash = Number(data.balanceCash) || 0;
      var enough = cash >= priceCash;
      statusEl.textContent = enough
        ? '현재 통합 캐시 ' + cash.toLocaleString('ko-KR') + '캐시'
        : '통합 캐시가 부족해요. (보유 ' + cash.toLocaleString('ko-KR') + '캐시 / 필요 ' + priceCash + '캐시) 충전하면 이 창에 바로 반영돼요.';
      payBtn.disabled = !enough;
      chargeLink.hidden = enough;
    }).catch(function (err) {
      if (streamerId === currentStreamerId) statusEl.textContent = message(err, '잔액을 확인하지 못했어요.');
    }).finally(function () { checking = false; });
  }

  function openModal(streamerId, streamerName) {
    if (!window.galTrusted) {
      window.galCloseLoginModal && window.galCloseLoginModal();
      window.galOpenLoginModal && window.galOpenLoginModal();
      return;
    }
    currentStreamerId = String(streamerId || '');
    nameEl.textContent = streamerName || currentStreamerId;
    statusEl.textContent = '통합 캐시 잔액을 확인하고 있어요.';
    payBtn.disabled = true; payLabel();
    chargeLink.hidden = true;
    backdrop.classList.add('open');
    window.galPushModal(closeModal);
    refreshStatus();
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) refreshStatus(); }, 15000);
  }
  function closeModal() {
    if (busy) return;
    clearInterval(timer);
    backdrop.classList.remove('open');
    window.galPopModal(closeModal);
  }
  window.galOpenUnlockModal = openModal;
  window.galCloseUnlockModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  // 충전 탭에서 돌아오면 잔액을 바로 다시 확인한다.
  window.addEventListener('focus', refreshStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshStatus(); });

  payBtn.addEventListener('click', async function () {
    if (busy || !currentStreamerId) return;
    var streamerId = currentStreamerId;
    busy = true; payBtn.disabled = true; closeBtn.disabled = true; payBtn.textContent = '결제 중…';
    try {
      var res = await callPurchase({ action: 'purchase', streamerId: streamerId, requestId: requestId(streamerId) });
      dropRequestId(streamerId);
      var data = res.data || {};
      statusEl.textContent = '✅ 열었어요! ' + (data.unlockedUntil ? formatDate(data.unlockedUntil) + '까지 모두 볼 수 있어요.' : '');
      chargeLink.hidden = true;
    } catch (err) {
      if (definiteFailure(err)) dropRequestId(streamerId);
      statusEl.textContent = message(err, '결제하지 못했어요. 차감된 캐시는 자동으로 확인돼요.');
      payBtn.disabled = false;
    } finally {
      busy = false; closeBtn.disabled = false; payLabel();
    }
  });
})();
