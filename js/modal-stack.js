// 공용 모달 스택(2026-09-05 추가) — Esc 키를 눌렀을 때 열려있는 모달/오버레이가
// 여러 개(예: 상세보기 위에 풀이미지 뷰어가 뜬 경우)라도 항상 "가장 나중에
// 열린(=가장 위에 보이는) 것" 하나만 닫히게 한다. 이전엔 파일마다 Esc 리스너를
// 따로 두고 서로를 알아야만(galIsImageViewOpen() 같은) 순서를 지킬 수 있었는데,
// 그 방식은 새 모달이 추가될 때마다 기존 모달들이 그 존재를 알아야 하는 문제가
// 있었다 — 이제 각 모달은 열 때 galPushModal(자기 close 함수), 닫을 때
// galPopModal(같은 함수)만 호출하면 되고, 서로의 존재를 몰라도 된다.
//
// 배경 스크롤 잠금(2026-09-05 추가) — 모달이 하나라도 열려있는 동안(스택이
// 비어있지 않은 동안) html에 클래스를 붙여 메인 페이지 스크롤을 막는다.
// 특정 모달 하나만 처리하지 않고 이 공용 스택에 붙여서, 상세보기든 업로드든
// 관리자 패널이든 로그인이든 전부 동일하게 적용된다.
// 뒤로가기 방지(2026-09-06 추가) — 모바일에서 모달이 열려있는 동안 기기
// 뒤로가기(제스처/버튼)를 누르면 모달만 닫히는 게 아니라 브라우저가 실제로
// 갤러리 페이지 자체를 벗어나 버리는 문제가 있었다. 모달을 열 때마다
// history에 상태를 하나 쌓아두고, 뒤로가기로 그 상태가 빠지면(popstate)
// 페이지 이동 대신 가장 위 모달만 닫는다. X버튼 등으로 모달을 먼저 닫은
// 경우엔 쌓아뒀던 history 상태가 그대로 남아 다음 뒤로가기가 엉뚱하게
// 동작하므로 history.back()으로 직접 소비하되, 그때 뒤따라오는 popstate는
// 진짜 사용자의 뒤로가기가 아니므로 suppressPopCount로 무시한다.
(function () {
  var stack = [];
  var handlingPopstate = false;
  var suppressPopCount = 0;
  var savedScrollY = 0;

  // 상세 패널을 닫으면 스크롤이 맨 위로 튀는 버그(2026-09-08 제보). 원인 두 가지가
  // 겹친 것으로 보임: (1) pushState로 쌓은 가짜 히스토리 엔트리를 history.back()으로
  // 소비할 때, URL이 안 바뀌는 pushState+back() 조합에서는 브라우저 기본 스크롤
  // 복원이 크로스브라우저로 신뢰할 수 없음(0으로 복원되거나 아예 복원 안 되는
  // 경우가 흔함) - scrollRestoration을 manual로 바꿔서 브라우저 자체 복원 시도를
  // 끄고 우리가 직접 처리한다. (2) 배경 스크롤 잠금을 overflow:hidden만으로 하면
  // 일부 브라우저(특히 iOS Safari)가 html+body에 동시에 overflow:hidden을 걸 때
  // 실제 스크롤 오프셋 자체를 잃어버리는 경우가 있음 - body를 position:fixed로
  // 그 자리에 고정시키는(스크롤 위치를 top 음수값으로 시각적으로만 유지) 더
  // 확실한 방식으로 바꿨다. 헤드리스 크롬 테스트에서는 원래 방식도 재현이 안 돼서
  // (이 버그 자체가 브라우저별 편차가 큰 종류라) 실제 재현 환경 없이도 안전하게
  // 통하는 이 업계 표준 기법으로 교체.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function syncScrollLock() {
    var wasLocked = document.documentElement.classList.contains('gal-modal-open');
    var willLock = stack.length > 0;
    if (willLock && !wasLocked) {
      savedScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + savedScrollY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.documentElement.classList.add('gal-modal-open');
    } else if (!willLock && wasLocked) {
      document.documentElement.classList.remove('gal-modal-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      window.scrollTo(0, savedScrollY);
    }
  }

  window.galPushModal = function (closeFn) {
    stack.push(closeFn);
    syncScrollLock();
    history.pushState({ galModal: true }, '', location.href);
    window.galSound && window.galSound.modalOpen();
  };
  window.galPopModal = function (closeFn) {
    var idx = stack.lastIndexOf(closeFn);
    if (idx === -1) return;
    stack.splice(idx, 1);
    syncScrollLock();
    if (!handlingPopstate) {
      suppressPopCount++;
      history.back();
    }
    window.galSound && window.galSound.modalClose();
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !stack.length) return;
    stack[stack.length - 1]();
  });

  window.addEventListener('popstate', function () {
    if (suppressPopCount > 0) { suppressPopCount--; return; }
    if (!stack.length) return;
    handlingPopstate = true;
    stack[stack.length - 1]();
    handlingPopstate = false;
  });
})();
