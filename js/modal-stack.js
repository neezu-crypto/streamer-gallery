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

  function syncScrollLock() {
    document.documentElement.classList.toggle('gal-modal-open', stack.length > 0);
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
