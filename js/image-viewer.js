// 풀이미지 뷰어(공용) — 관리자 신고/전체이미지 목록 썸네일과 메인페이지 상세보기 모달
// 양쪽에서 재사용한다. window.galOpenImageView(url)를 부르면 뜬다.
// 데스크톱(2026-09-05 개편): 클릭하면 닫힘, 휠로 마우스 좌표 기준 확대/축소,
// 확대된 상태에서 드래그로 이동. 모바일(720px 이하)은 처음부터 항상 화면
// 전체(CSS)라 확대/드래그 개념이 없고, 탭하면 그냥 닫힌다.
(function () {
  var backdrop = document.getElementById('image-view-backdrop');
  var img = document.getElementById('image-view-img');
  var closeBtn = document.getElementById('image-view-close');
  if (!backdrop) return;

  function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }

  var MIN_SCALE = 1, MAX_SCALE = 6, WHEEL_STEP = 0.2;
  var scale = 1, translateX = 0, translateY = 0;
  var isDragging = false, dragMoved = false;
  var dragStartX = 0, dragStartY = 0, dragStartTranslateX = 0, dragStartTranslateY = 0;

  function applyTransform() {
    img.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
    img.style.cursor = scale > MIN_SCALE ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in';
  }
  function resetTransform() {
    scale = 1; translateX = 0; translateY = 0;
    img.style.transformOrigin = '50% 50%';
    applyTransform();
  }

  function open(url) {
    resetTransform();
    img.src = url;
    backdrop.classList.add('open');
    window.galPushModal(close);
  }
  function close() {
    backdrop.classList.remove('open');
    img.src = '';
    resetTransform();
    window.galPopModal(close);
  }
  window.galOpenImageView = open;
  window.galCloseImageView = close;
  window.galIsImageViewOpen = function () { return backdrop.classList.contains('open'); };

  // 클릭하면 닫힘 — 단, 드래그(이동)로 끝난 경우엔 닫지 않는다(mouseup 후에도
  // click 이벤트가 그대로 발생하므로 dragMoved로 구분).
  img.addEventListener('click', function () {
    if (dragMoved) { dragMoved = false; return; }
    close();
  });

  // 휠 = 마우스 좌표 기준 확대/축소(데스크톱 전용) — transform-origin을 매번
  // 현재 커서 위치로 옮긴 뒤 scale만 바꿔서, 그 지점이 화면상 고정된 채로 확대된다.
  img.addEventListener('wheel', function (e) {
    if (isMobile()) return;
    e.preventDefault();
    var rect = img.getBoundingClientRect();
    var originX = ((e.clientX - rect.left) / rect.width) * 100;
    var originY = ((e.clientY - rect.top) / rect.height) * 100;
    img.style.transformOrigin = originX + '% ' + originY + '%';
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)));
    if (scale === MIN_SCALE) { translateX = 0; translateY = 0; }
    applyTransform();
  }, { passive: false });

  // 드래그 = 이동(확대된 상태에서만, 데스크톱 전용).
  img.addEventListener('mousedown', function (e) {
    if (isMobile() || scale <= MIN_SCALE) return;
    e.preventDefault();
    isDragging = true;
    dragMoved = false;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragStartTranslateX = translateX; dragStartTranslateY = translateY;
    applyTransform();
  });
  document.addEventListener('mousemove', function (e) {
    if (!isDragging) return;
    var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    translateX = dragStartTranslateX + dx;
    translateY = dragStartTranslateY + dy;
    applyTransform();
  });
  document.addEventListener('mouseup', function () {
    if (!isDragging) return;
    isDragging = false;
    applyTransform();
  });

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
})();
