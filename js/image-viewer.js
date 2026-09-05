// 풀이미지 뷰어(공용) — 관리자 신고/전체이미지 목록 썸네일과 메인페이지 상세보기 모달
// 양쪽에서 재사용한다. window.galOpenImageView(url)를 부르면 뜨고, 데스크톱에선
// 뜬 이미지를 한 번 더 클릭하면 전체화면까지 확대된다(zoomed 클래스 토글).
// 모바일(720px 이하)은 처음부터 항상 화면 전체(CSS)라 확대 개념이 없고, 탭하면
// 그냥 닫힌다(2026-09-05 추가).
(function () {
  var backdrop = document.getElementById('image-view-backdrop');
  var img = document.getElementById('image-view-img');
  var closeBtn = document.getElementById('image-view-close');
  if (!backdrop) return;

  function open(url) {
    img.classList.remove('zoomed');
    img.src = url;
    backdrop.classList.add('open');
    window.galPushModal(close);
  }
  function close() {
    backdrop.classList.remove('open');
    img.src = '';
    window.galPopModal(close);
  }
  window.galOpenImageView = open;
  window.galCloseImageView = close;
  window.galIsImageViewOpen = function () { return backdrop.classList.contains('open'); };

  img.addEventListener('click', function () {
    if (window.matchMedia('(max-width: 720px)').matches) { close(); return; }
    img.classList.toggle('zoomed');
  });
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
})();
