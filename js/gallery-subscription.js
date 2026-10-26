// 갤러리 잠금 모달 안에서 고점체크와 동일한 통합 구독 신청을 처리한다. 신청 원장과
// 승인 로직은 공유 callable(streamerFanPageViewerSubscription)이 유일한 기준이다.
(function () {
  var backdrop = document.getElementById('unlock-backdrop');
  var purchase = document.getElementById('gallery-subscription-purchase');
  var soopIdInput = document.getElementById('gallery-subscription-soop-id');
  var submitBtn = document.getElementById('gallery-subscription-submit');
  var codeStep = document.getElementById('gallery-subscription-code-step');
  var codeEl = document.getElementById('gallery-subscription-code');
  var copyBtn = document.getElementById('gallery-subscription-copy');
  var renewBtn = document.getElementById('gallery-subscription-renew');
  var loginBtn = document.getElementById('gallery-subscription-login');
  var refreshBtn = document.getElementById('gallery-subscription-refresh');
  var cancelBtn = document.getElementById('gallery-subscription-cancel');
  var statusEl = document.getElementById('gallery-subscription-status');
  if (!backdrop || !purchase) return;

  var state = {};
  var verificationCode = '';
  var refreshing = false;
  var lastRefreshAt = 0;

  function callableMessage(error, fallback) {
    var message = error && error.message ? String(error.message) : '';
    if (message && !/^FirebaseError:/i.test(message)) return message;
    return fallback;
  }

  async function callSubscription(data) {
    for (var attempt = 0; attempt < 50; attempt += 1) {
      if (window.galCallViewerSubscription) return window.galCallViewerSubscription(data);
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    throw new Error('구독 서비스를 준비하지 못했어요. 페이지를 새로고침해 주세요.');
  }

  function formatDate(value) {
    var timestamp = Number(value) || 0;
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp));
  }

  function setBusy(button, busy, busyText, idleText) {
    if (!button) return;
    button.disabled = busy;
    if (busyText && idleText) button.textContent = busy ? busyText : idleText;
  }

  function render(message) {
    var pending = !!(state.pending && state.pendingRequestId);
    var codeRequest = pending && state.pendingVerificationMethod === 'subscriber-comment-code';
    var processing = codeRequest && state.pendingRequestStatus === 'processing' && !state.pendingCanRenewCode;
    var active = state.isAdmin || state.subscribed;

    purchase.hidden = active || !state.accountProtected || pending;
    codeStep.hidden = active || !state.accountProtected || !codeRequest || processing;
    cancelBtn.hidden = active || !pending || processing;
    loginBtn.hidden = active || !!state.accountProtected;
    renewBtn.hidden = !codeRequest || !state.pendingCanRenewCode;
    copyBtn.hidden = !verificationCode || !codeRequest || processing;
    codeEl.textContent = verificationCode || '새 코드를 발급해 주세요';

    if (message) {
      statusEl.textContent = message;
    } else if (state.isAdmin) {
      statusEl.textContent = '관리자 권한으로 갤러리의 모든 구독 콘텐츠를 이용할 수 있어요.';
    } else if (state.subscribed) {
      statusEl.textContent = formatDate(state.expiresAt) + '까지 스트리머 시리즈 통합 구독 중이에요.';
    } else if (!state.accountProtected) {
      statusEl.textContent = 'Google·Kakao 로그인 또는 스트리머 인증을 완료한 계정에서 신청할 수 있어요.';
    } else if (pending && codeRequest) {
      if (processing) {
        statusEl.textContent = '관리자가 구독 인증 신청을 확인 중이에요.';
      } else if (Number(state.pendingCodeExpiresAt) > 0 && Number(state.pendingCodeExpiresAt) <= Date.now()) {
        statusEl.textContent = '신청은 유지 중이지만 코드가 만료됐어요. 새 코드를 발급해 댓글을 수정해 주세요.';
      } else {
        var expires = formatDate(state.pendingCodeExpiresAt);
        statusEl.textContent = (state.pendingSoopId || '입력한') + ' SOOP 아이디로 인증 대기 중이에요.' + (expires ? ' 코드 만료: ' + expires : '');
      }
    } else if (pending) {
      statusEl.textContent = '기존 별풍선 방식 구독 신청이 관리자 확인 대기 중이에요.';
    } else {
      statusEl.textContent = '본인 SOOP 아이디로 인증 코드를 발급해 주세요.';
    }
  }

  async function refreshStatus(message) {
    if (refreshing) return;
    refreshing = true;
    setBusy(refreshBtn, true, '확인 중…', '상태 새로고침');
    if (!message) statusEl.textContent = '구독 상태를 확인하고 있어요.';
    try {
      var response = await callSubscription({ action: 'status' });
      state = response.data || {};
      lastRefreshAt = Date.now();
      if (state.subscribed || state.isAdmin) {
        if (window.galRefreshUnifiedSubscriptionStatus) await window.galRefreshUnifiedSubscriptionStatus();
      }
      render(message || '');
    } catch (error) {
      render(callableMessage(error, '구독 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      refreshing = false;
      setBusy(refreshBtn, false, '확인 중…', '상태 새로고침');
    }
  }

  document.addEventListener('gal-unlock-opened', function () {
    verificationCode = '';
    state = {};
    soopIdInput.value = '';
    render('구독 상태를 확인하고 있어요.');
    refreshStatus();
  });

  submitBtn.addEventListener('click', async function () {
    var soopId = soopIdInput.value.trim().toLowerCase();
    if (!/^[a-z0-9]{2,20}$/.test(soopId)) {
      render('본인 SOOP 방송국 아이디를 영문 소문자·숫자 2~20자로 입력해 주세요.');
      soopIdInput.focus();
      return;
    }
    setBusy(submitBtn, true, '코드 발급 중…', '인증 코드 발급');
    render('구독 인증 신청을 등록하고 있어요.');
    try {
      var response = await callSubscription({ action: 'request', soopId: soopId });
      var result = response.data || {};
      verificationCode = result.action === 'pending' ? String(result.code || '') : '';
      soopIdInput.value = '';
      await refreshStatus(result.action === 'already-pending'
        ? '이미 대기 중인 신청이 있어요. 필요하면 새 코드를 발급해 주세요.'
        : '인증 코드를 발급했어요. 구독자 전용 인증 게시글에 댓글로 남겨 주세요.');
    } catch (error) {
      render(callableMessage(error, '구독 신청을 접수하지 못했어요.'));
    } finally {
      setBusy(submitBtn, false, '코드 발급 중…', '인증 코드 발급');
    }
  });

  copyBtn.addEventListener('click', async function () {
    if (!verificationCode) return;
    try {
      await navigator.clipboard.writeText(verificationCode);
      render('인증 코드를 복사했어요. 인증 게시글 댓글에 붙여 넣어 주세요.');
    } catch (_) {
      render('코드를 복사하지 못했어요. 직접 선택해 복사해 주세요.');
    }
  });

  renewBtn.addEventListener('click', async function () {
    if (!state.pendingRequestId) return;
    setBusy(renewBtn, true, '발급 중…', '새 코드 발급');
    try {
      var response = await callSubscription({ action: 'renewCode', requestId: state.pendingRequestId });
      verificationCode = String(response.data && response.data.code || '');
      await refreshStatus('새 코드를 발급했어요. 이전 코드 댓글을 새 코드로 수정해 주세요.');
    } catch (error) {
      await refreshStatus(callableMessage(error, '새 코드를 발급하지 못했어요.'));
    } finally {
      setBusy(renewBtn, false, '발급 중…', '새 코드 발급');
    }
  });

  refreshBtn.addEventListener('click', function () { refreshStatus(); });

  loginBtn.addEventListener('click', function () {
    window.galCloseUnlockModal && window.galCloseUnlockModal();
    window.galOpenLoginModal && window.galOpenLoginModal();
  });

  cancelBtn.addEventListener('click', async function () {
    if (!state.pendingRequestId || !confirm('구독 인증 신청과 발급 코드를 취소할까요?')) return;
    setBusy(cancelBtn, true, '취소 중…', '대기 신청 취소');
    try {
      await callSubscription({ action: 'cancel', requestId: state.pendingRequestId });
      verificationCode = '';
      await refreshStatus('구독 인증 신청을 취소했어요.');
    } catch (error) {
      await refreshStatus(callableMessage(error, '신청을 취소하지 못했어요.'));
    } finally {
      setBusy(cancelBtn, false, '취소 중…', '대기 신청 취소');
    }
  });

  window.addEventListener('focus', function () {
    if (!backdrop.classList.contains('open') || Date.now() - lastRefreshAt < 5000) return;
    refreshStatus();
  });
})();
