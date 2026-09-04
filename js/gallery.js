// 갤러리 그리드 렌더링 + 검색/카테고리 필터 + 업로드(requestImageUpload로 presigned URL
// 발급 → R2에 직접 PUT → registerImage로 메타데이터 등록, 3단계).
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
  window.galCategoryLabels = CATEGORY_LABELS;

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
        '<div class="gallery-card" data-image-id="' + escapeHtml(img.id) + '">' +
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
      window.galAllImages = allImages;
      renderGrid();
      document.dispatchEvent(new CustomEvent('gal-images-updated', { detail: { images: allImages } }));
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
  var ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  var MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

  if (uploadSubmitBtn) {
    uploadSubmitBtn.addEventListener('click', async function () {
      var streamerInput = document.getElementById('upload-streamer');
      var categorySelect = document.getElementById('upload-category');
      var fileInput = document.getElementById('upload-file');
      var streamerName = (streamerInput.value || '').trim();
      var category = categorySelect.value;
      var file = fileInput.files && fileInput.files[0];

      if (!streamerName) { uploadStatus.textContent = '⚠️ 스트리머 이름을 입력해 주세요.'; return; }
      if (!file) { uploadStatus.textContent = '⚠️ 이미지 파일을 선택해 주세요.'; return; }
      if (!ALLOWED_CONTENT_TYPES.has(file.type)) { uploadStatus.textContent = '⚠️ jpg/png/webp/gif 이미지만 업로드할 수 있어요.'; return; }
      if (file.size > MAX_UPLOAD_BYTES) { uploadStatus.textContent = '⚠️ 이미지 용량은 15MB 이하여야 해요.'; return; }

      uploadSubmitBtn.disabled = true;
      uploadStatus.textContent = '⏳ 업로드 준비 중...';
      try {
        var requestUploadFn = window.galFirebase.httpsCallable('requestImageUpload');
        var prepared = await requestUploadFn({ contentType: file.type, fileSize: file.size });
        var uploadUrl = prepared.data.uploadUrl, imageId = prepared.data.imageId, key = prepared.data.key;

        uploadStatus.textContent = '⏳ 이미지 업로드 중...';
        var putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!putRes.ok) throw new Error('R2 업로드 실패 (status ' + putRes.status + ')');

        uploadStatus.textContent = '⏳ 등록 중...';
        var registerFn = window.galFirebase.httpsCallable('registerImage');
        await registerFn({ imageId: imageId, key: key, streamerName: streamerName, category: category });

        uploadStatus.textContent = '✅ 업로드 완료!';
        streamerInput.value = '';
        fileInput.value = '';
        setTimeout(closeUploadModal, 700);
      } catch (err) {
        console.error('이미지 업로드 실패', err);
        uploadStatus.textContent = '❌ 업로드 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err);
      } finally {
        uploadSubmitBtn.disabled = false;
      }
    });
  }

  // #open-login-btn 클릭 처리는 js/profile-modal.js가 전담한다(로그인 전엔 로그인
  // 모달, 로그인 후엔 프로필 모달을 여는 이중 역할 — 여기서 별도로 열면 두 핸들러가
  // 경합해서 로그인 후에도 항상 로그인 모달만 뜨는 버그가 생긴다).

  subscribeImages();
})();
