// 모바일 하단 탭바(2026-09-05 추가, 720px 이하에서만 CSS로 보임) — 홈/업로드/
// 내갤러리/관리자는 자체 로직 없이 데스크톱 사이드바의 같은 버튼을 그대로
// .click()으로 위임한다(이미 완결된 핸들러가 있으므로 중복 구현하지 않음).
// 카테고리만 예외 — 손가락을 떼지 않고 드래그해서 고르는 제스처가 필요해서
// 새로 구현한다.
(function () {
  var chipFan = document.getElementById('mtab-chip-fan');
  var categoryBtn = document.getElementById('mtab-category-btn');
  var categoryIndicator = document.getElementById('mtab-category-indicator');
  var adminBtn = document.getElementById('mtab-admin-btn');
  if (!chipFan || !categoryBtn) return;

  function proxyClick(targetId) {
    return function () {
      var el = document.getElementById(targetId);
      if (el) el.click();
    };
  }
  [
    ['mtab-home-btn', 'sidebar-home-btn'],
    ['mtab-upload-btn', 'open-upload-btn'],
    ['mtab-mygallery-btn', 'open-mygallery-btn'],
    ['mtab-admin-btn', 'open-admin-btn'],
  ].forEach(function (pair) {
    var btn = document.getElementById(pair[0]);
    if (btn) btn.addEventListener('click', proxyClick(pair[1]));
  });

  // 관리자 탭 노출 여부는 데스크톱 사이드바(#open-admin-btn)와 동일한 판정 결과를
  // 그대로 따라간다 — gallery-admin.js가 이미 이 이벤트로 그쪽 버튼을 토글한다.
  if (adminBtn) {
    document.addEventListener('gal-auth-changed', function (e) {
      adminBtn.style.display = e.detail.isAdmin ? '' : 'none';
    });
  }

  var CATEGORY_LABELS_SHORT = { all: '전체', screenshot: 'SS', selfie: '방셀', 'ai-art': 'AI', 'fan-art': '팬', meme: '밈', etc: '기타' };

  var fanOpen = false;

  // 버튼이 화면 왼쪽/가운데/오른쪽 중 어디에 있는지에 따라 칩 정렬 기준을 바꿔서
  // 화면 밖으로 삐져나가지 않게 한다.
  function positionFan() {
    var rect = categoryBtn.getBoundingClientRect();
    var chipWidth = 52;
    var centerX = rect.left + rect.width / 2;
    var vw = window.innerWidth;
    var left;
    if (centerX < vw / 3) left = rect.left;
    else if (centerX > (vw * 2) / 3) left = rect.right - chipWidth;
    else left = centerX - chipWidth / 2;
    left = Math.max(8, Math.min(left, vw - chipWidth - 8));
    chipFan.style.left = left + 'px';
    chipFan.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  }

  function openFan() {
    positionFan();
    fanOpen = true;
    chipFan.classList.add('open');
  }
  function closeFan() {
    fanOpen = false;
    chipFan.classList.remove('open');
    chipFan.querySelectorAll('.mtab-chip').forEach(function (c) { c.classList.remove('drag-hover'); });
  }

  categoryBtn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    openFan();
  }, { passive: false });

  categoryBtn.addEventListener('touchmove', function (e) {
    if (!fanOpen) return;
    e.preventDefault(); // 제스처 진행 중에만 스크롤 잠금 — 평소엔 이 리스너가 아무것도 안 함
    var t = e.touches[0];
    var el = document.elementFromPoint(t.clientX, t.clientY);
    chipFan.querySelectorAll('.mtab-chip').forEach(function (c) { c.classList.toggle('drag-hover', c === el); });
  }, { passive: false });

  categoryBtn.addEventListener('touchend', function (e) {
    if (!fanOpen) return;
    var t = e.changedTouches[0];
    var el = document.elementFromPoint(t.clientX, t.clientY);
    if (el && el.classList.contains('mtab-chip')) {
      var category = el.dataset.category;
      el.classList.remove('drag-hover');
      el.classList.add('confirm-pulse');
      setTimeout(function () {
        closeFan();
        window.galSetCategory && window.galSetCategory(category);
        categoryIndicator.textContent = CATEGORY_LABELS_SHORT[category] || category;
      }, 180);
    } else {
      // 제자리(원래 버튼) 또는 칩이 아닌 곳에서 손을 뗀 경우 — 필터 변경 없이 취소.
      closeFan();
    }
  });

  categoryBtn.addEventListener('touchcancel', closeFan);
})();
