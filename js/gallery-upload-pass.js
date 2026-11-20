//  하루 업로드 한도 표시와 업로드 늘리기 이용권(2026-11-17).
//  업로드 창을 열 때 galleryUploadPass status를 1번 불러 "오늘 남은 업로드"를 보여 주고,
//  한도에 닿으면 이용권 창(30캐시·30일·하루 20장)으로 이어진다. 결제는 통합 캐시(서버가 차감·자동 환불).
(function () {
  'use strict';
  var backdrop = document.getElementById('upload-pass-backdrop');
  var quotaBox = document.getElementById('upload-quota');
  var quotaText = document.getElementById('upload-quota-text');
  var moreBtn = document.getElementById('upload-quota-more');
  if (!backdrop || !quotaBox) return;
  var closeBtn = document.getElementById('upload-pass-close');
  var todayEl = document.getElementById('upload-pass-today');
  var statusEl = document.getElementById('upload-pass-status');
  var buyBtn = document.getElementById('upload-pass-buy');
  var chargeLink = document.getElementById('upload-pass-charge');

  var state = null; // 마지막 status 응답
  var busy = false;
  var REQ_KEY = 'galUploadPassRequest';

  function call(data) { return window.galFirebase.httpsCallable('galleryUploadPass')(data); }
  function msg(err, fallback) {
    var t = err && err.message ? String(err.message) : '';
    return t && !/^FirebaseError:|^internal$/i.test(t) ? t : fallback;
  }
  function fmtDate(at) { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(at)); }
  function requestId() {
    try { var saved = sessionStorage.getItem(REQ_KEY); if (saved) return saved; } catch (_) {}
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    var id = 'gp_' + Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try { sessionStorage.setItem(REQ_KEY, id); } catch (_) {}
    return id;
  }
  function dropRequestId() { try { sessionStorage.removeItem(REQ_KEY); } catch (_) {} }
  function definiteFailure(err) {
    var code = String(err && err.code || '').replace(/^functions\//, '');
    return ['failed-precondition', 'invalid-argument', 'already-exists', 'not-found', 'permission-denied', 'resource-exhausted'].indexOf(code) >= 0;
  }

  // 남은 장수(관리자는 null = 제한 없음)
  function remaining() {
    if (!state) return null;
    if (state.unlimited) return Infinity;
    return Math.max(0, (Number(state.limitToday) || 0) - (Number(state.usedToday) || 0));
  }
  window.galUploadRemaining = remaining;
  // 용량 등급: 이용권·관리자 'paid', 그 밖 'free'(서버가 최종 판정)
  window.galUploadTier = function () { return state && (state.unlimited || Number(state.passUntil) > Date.now()) ? 'paid' : 'free'; };

  function renderQuota() {
    if (!state) { quotaBox.hidden = true; return; }
    quotaBox.hidden = false;
    if (state.unlimited) { quotaText.textContent = '관리자: 하루 업로드 제한 없음'; moreBtn.hidden = true; return; }
    var left = remaining();
    quotaText.textContent = '오늘 남은 업로드 ' + left + '/' + state.limitToday + '장' +
      (state.passUntil ? ' · 업로드 늘리기 이용 중(' + fmtDate(state.passUntil) + '까지)' : '');
    moreBtn.hidden = false;
    moreBtn.textContent = state.passUntil ? '이용권 연장' : '업로드 늘리기';
  }

  function refresh() {
    if (!window.galTrusted) { state = null; renderQuota(); return Promise.resolve(); }
    return call({ action: 'status' }).then(function (r) { state = r.data || null; renderQuota(); renderPass(); })
      .catch(function () { state = null; renderQuota(); });
  }
  window.galRefreshUploadQuota = refresh;
  // 업로드가 끝나면 서버에 다시 묻지 않고 화면 숫자만 줄인다(다음에 창을 열 때 서버 값으로 맞춤).
  window.galNoteUploaded = function (n) {
    if (state && !state.unlimited) { state.usedToday = (Number(state.usedToday) || 0) + n; renderQuota(); }
  };

  function renderPass() {
    if (!state) return;
    document.getElementById('upload-pass-price').textContent = state.priceCash;
    document.getElementById('upload-pass-limit').textContent = state.passLimit;
    document.getElementById('upload-pass-limit2').textContent = state.passLimit;
    document.getElementById('upload-pass-free').textContent = state.freeLimit;
    todayEl.textContent = state.unlimited ? '관리자는 업로드 제한이 없어요.'
      : '오늘 ' + state.usedToday + '/' + state.limitToday + '장 올렸어요.' + (state.passUntil ? ' 이용권은 ' + fmtDate(state.passUntil) + '까지예요.' : '');
    if (busy) return;
    var cash = Number(state.balanceCash) || 0;
    var enough = cash >= state.priceCash;
    statusEl.textContent = enough ? '현재 통합 캐시 ' + cash.toLocaleString('ko-KR') + '캐시'
      : '통합 캐시가 부족해요. (보유 ' + cash.toLocaleString('ko-KR') + '캐시 / 필요 ' + state.priceCash + '캐시) 충전하고 돌아오면 바로 반영돼요.';
    buyBtn.disabled = !enough;
    buyBtn.textContent = state.priceCash + '캐시로 ' + (state.passUntil ? '30일 연장' : '이용권 사기');
    chargeLink.hidden = enough;
  }

  function open() {
    if (!window.galTrusted) { window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    statusEl.textContent = '통합 캐시 잔액을 확인하고 있어요.';
    buyBtn.disabled = true;
    backdrop.classList.add('open');
    window.galPushModal(close);
    refresh();
  }
  function close() {
    if (busy) return;
    backdrop.classList.remove('open');
    window.galPopModal(close);
  }
  window.galOpenUploadPass = open;

  moreBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
  window.addEventListener('focus', function () { if (backdrop.classList.contains('open')) refresh(); });

  buyBtn.addEventListener('click', async function () {
    if (busy) return;
    busy = true; buyBtn.disabled = true; closeBtn.disabled = true; buyBtn.textContent = '결제 중…';
    try {
      var r = await call({ action: 'purchase', requestId: requestId() });
      dropRequestId();
      statusEl.textContent = '✅ 적용했어요! ' + fmtDate(r.data.passUntil) + '까지 하루 ' + (state ? state.passLimit : 50) + '장까지 올릴 수 있어요.';
      chargeLink.hidden = true;
      busy = false;
      await refresh();
      statusEl.textContent = '✅ 적용했어요! ' + fmtDate(r.data.passUntil) + '까지 하루 ' + (state ? state.passLimit : 50) + '장까지 올릴 수 있어요.';
    } catch (err) {
      if (definiteFailure(err)) dropRequestId();
      statusEl.textContent = msg(err, '결제하지 못했어요. 차감된 캐시는 자동으로 확인돼요.');
      buyBtn.disabled = false;
    } finally {
      busy = false; closeBtn.disabled = false;
    }
  });

  // 업로드 창이 열릴 때마다 한 번 확인한다.
  var uploadBackdrop = document.getElementById('upload-backdrop');
  if (uploadBackdrop) {
    new MutationObserver(function () {
      if (uploadBackdrop.classList.contains('open')) refresh();
    }).observe(uploadBackdrop, { attributes: true, attributeFilter: ['class'] });
  }
})();
