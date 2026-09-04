// 갤러리 그리드 렌더링 + 검색/카테고리 필터 + 업로드 모달 뼈대.
// 실제 이미지 업로드(R2 presigned URL 발급 → 직접 업로드 → 메타데이터 등록)를 처리하는
// Cloud Function은 아직 없다 — 업로드 버튼은 지금은 안내 문구만 띄우는 스텁이다.
// gallery/images 노드 읽기는 이미 database.rules.json에 반영돼 있어 지금부터도 동작한다.
(function () {
  var grid = document.getElementById('gallery-grid');
  var chipsWrap = document.getElementById('gallery-category-chips');
  var searchInput = document.getElementById('gallery-filter-streamer');
  var uploadBackdrop = document.getElementById('upload-backdrop');
  var uploadCloseBtn = document.getElementById('upload-modal-close');
  var uploadOpenBtn = document.getElementById('open-upload-btn');
  var uploadSubmitBtn = document.getElementById('upload-submit-btn');
  var uploadStatus = document.getElementById('upload-status');

  var CATEGORY_LABELS = {
    screenshot: '스크린샷',
    'ai-art': 'AI 일러스트',
    'fan-art': '팬아트',
    meme: '밈',
    etc: '기타',
  };

  var allImages = [];
  var activeCategory = 'all';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderGrid() {
    if (!grid) return;
    var streamerQuery = (searchInput && searchInput.value || '').trim().toLowerCase();
    var filtered = allImages.filter(function (img) {
      if (activeCategory !== 'all' && img.category !== activeCategory) return false;
      if (streamerQuery && !(img.streamerName || '').toLowerCase().includes(streamerQuery)) return false;
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<p class="empty-msg">' + (allImages.length ? '조건에 맞는 이미지가 없어요.' : '아직 업로드된 이미지가 없어요. 첫 이미지를 올려보세요!') + '</p>';
      return;
    }

    grid.innerHTML = filtered.map(function (img) {
      var label = CATEGORY_LABELS[img.category] || img.category || '';
      return (
        '<div class="gallery-card">' +
          '<div class="gallery-card-thumb">' +
            (img.thumbUrl ? '<img src="' + escapeHtml(img.thumbUrl) + '" alt="" loading="lazy">' : '') +
          '</div>' +
          '<div class="gallery-card-body">' +
            '<div class="gallery-card-head">' +
              '<span class="gallery-card-streamer">' + escapeHtml(img.streamerName || '익명') + '</span>' +
              '<span class="gallery-badge">' + escapeHtml(label) + '</span>' +
            '</div>' +
            '<div class="gallery-card-meta">' +
              '<span class="liked">♥ ' + (img.likeCount || 0) + '</span>' +
              '<span>💬 ' + (img.commentCount || 0) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function subscribeImages() {
    if (!window.galFirebase || !window.galDb) { setTimeout(subscribeImages, 200); return; }
    var imagesRef = window.galFirebase.ref(window.galDb, 'gallery/images');
    window.galFirebase.onValue(imagesRef, function (snap) {
      var data = snap.val() || {};
      allImages = Object.keys(data).map(function (id) {
        return Object.assign({ id: id }, data[id]);
      }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderGrid();
    }, function (err) {
      console.error('갤러리 목록 구독 실패', err);
      grid.innerHTML = '<p class="empty-msg">이미지를 불러오지 못했어요. 새로고침해 주세요.</p>';
    });
  }

  if (chipsWrap) {
    chipsWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      chipsWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderGrid();
    });
  }
  if (searchInput) searchInput.addEventListener('input', renderGrid);

  function openUploadModal() {
    if (!window.galTrusted) {
      window.galCloseLoginModal && window.galCloseLoginModal();
      window.galOpenLoginModal && window.galOpenLoginModal();
      return;
    }
    if (uploadStatus) uploadStatus.textContent = '';
    uploadBackdrop.classList.add('open');
  }
  function closeUploadModal() { uploadBackdrop.classList.remove('open'); }

  if (uploadOpenBtn) uploadOpenBtn.addEventListener('click', openUploadModal);
  if (uploadCloseBtn) uploadCloseBtn.addEventListener('click', closeUploadModal);
  if (uploadBackdrop) {
    uploadBackdrop.addEventListener('click', function (e) { if (e.target === uploadBackdrop) closeUploadModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && uploadBackdrop.classList.contains('open')) closeUploadModal(); });
  }
  if (uploadSubmitBtn) {
    uploadSubmitBtn.addEventListener('click', function () {
      if (uploadStatus) uploadStatus.textContent = '⏳ 업로드 기능은 곧 추가될 예정이에요. 조금만 기다려 주세요!';
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#open-login-btn')) {
      window.galOpenLoginModal && window.galOpenLoginModal();
    }
  });

  subscribeImages();
})();
