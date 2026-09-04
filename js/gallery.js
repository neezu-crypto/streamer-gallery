// 갤러리 그리드 렌더링 + 검색/카테고리 필터 + 업로드(requestImageUpload로 presigned URL
// 발급 → R2에 직접 PUT → registerImage로 메타데이터 등록, 3단계).
// gallery/images 노드 읽기는 이미 database.rules.json에 반영돼 있어 지금부터도 동작한다.
//
// 스트리머별 업로드 잠금(2026-09-05 추가) — 스트리머 이름은 자유 텍스트가 아니라
// streamer-names.json(정적 목록)에서 검색해서 선택하는 방식으로 바꿨다. 오타/띄어쓰기
// 차이로 같은 스트리머가 다르게 취급되면 해금 여부 판별 자체가 무의미해지기 때문.
(function () {
  var grid = document.getElementById('gallery-grid');
  var chipsWrap = document.getElementById('gallery-category-chips');
  var searchInput = document.getElementById('gallery-filter-streamer');
  var uploadBackdrop = document.getElementById('upload-backdrop');
  var uploadCloseBtn = document.getElementById('upload-modal-close');
  var uploadOpenBtn = document.getElementById('open-upload-btn');
  var uploadSubmitBtn = document.getElementById('upload-submit-btn');
  var uploadStatus = document.getElementById('upload-status');
  var uploadStreamerSearch = document.getElementById('upload-streamer-search');
  var uploadStreamerResults = document.getElementById('upload-streamer-results');
  var uploadStreamerSelected = document.getElementById('upload-streamer-selected');

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
  var allStreamers = [];
  var selectedStreamerId = null;
  var selectedStreamerName = '';

  fetch('./streamer-names.json').then(function (res) { return res.json(); }).then(function (data) {
    allStreamers = data;
  }).catch(function (e) { console.error('스트리머 이름 목록을 불러오지 못했습니다:', e); });

  window.galUnlockedStreamers = {};
  function subscribeUnlockedStreamers() {
    if (!window.galFirebase || !window.galDb) { setTimeout(subscribeUnlockedStreamers, 200); return; }
    window.galFirebase.onValue(window.galFirebase.ref(window.galDb, 'gallery/unlockedStreamers'), function (snap) {
      window.galUnlockedStreamers = snap.val() || {};
      renderGrid();
      document.dispatchEvent(new CustomEvent('gal-unlocked-updated'));
    }, function (err) { console.error('해금된 스트리머 목록 구독 실패', err); });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isStreamerUnlocked(streamerId) {
    return !!(streamerId && window.galUnlockedStreamers && window.galUnlockedStreamers[streamerId] === true);
  }
  window.galIsStreamerUnlocked = isStreamerUnlocked;

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
      var locked = !isStreamerUnlocked(img.streamerId);
      return (
        '<div class="gallery-card" data-image-id="' + escapeHtml(img.id) + '">' +
          '<div class="gallery-card-thumb">' +
            (img.thumbUrl ? '<img src="' + escapeHtml(img.thumbUrl) + '" alt="" loading="lazy">' : '') +
            (locked ? '<span class="gallery-lock-badge" title="해금 필요">🔒</span>' : '') +
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

  function resetStreamerPicker() {
    selectedStreamerId = null;
    selectedStreamerName = '';
    uploadStreamerSearch.value = '';
    uploadStreamerResults.innerHTML = '';
    uploadStreamerSelected.style.display = 'none';
    uploadStreamerSelected.textContent = '';
  }

  function pickStreamer(name, id) {
    selectedStreamerId = id;
    selectedStreamerName = name;
    uploadStreamerResults.innerHTML = '';
    uploadStreamerSearch.value = '';
    var unlocked = isStreamerUnlocked(id);
    uploadStreamerSelected.style.display = '';
    uploadStreamerSelected.textContent = (unlocked ? '✅ ' : '🔒 ') + '선택됨: ' + name + (unlocked ? '' : ' (아직 잠긴 스트리머예요 — 업로드 시도하면 해금 신청으로 안내돼요)');
  }

  if (uploadStreamerSearch) {
    uploadStreamerSearch.addEventListener('input', function () {
      var q = uploadStreamerSearch.value.trim();
      uploadStreamerResults.innerHTML = '';
      if (!q) return;
      var matches = allStreamers.filter(function (s) { return s.name.includes(q); }).slice(0, 12);
      if (!matches.length) {
        uploadStreamerResults.innerHTML = '<p class="empty-msg">일치하는 스트리머가 없어요.</p>';
        return;
      }
      matches.forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'streamer-row';
        row.textContent = (isStreamerUnlocked(s.id) ? '✅ ' : '🔒 ') + s.name;
        row.addEventListener('click', function () { pickStreamer(s.name, s.id); });
        uploadStreamerResults.appendChild(row);
      });
    });
  }

  function openUploadModal() {
    if (!window.galTrusted) {
      window.galCloseLoginModal && window.galCloseLoginModal();
      window.galOpenLoginModal && window.galOpenLoginModal();
      return;
    }
    if (uploadStatus) uploadStatus.textContent = '';
    resetStreamerPicker();
    uploadBackdrop.classList.add('open');
  }
  function closeUploadModal() { uploadBackdrop.classList.remove('open'); }
  window.galCloseUploadModal = closeUploadModal;

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
      var categorySelect = document.getElementById('upload-category');
      var fileInput = document.getElementById('upload-file');
      var category = categorySelect.value;
      var file = fileInput.files && fileInput.files[0];

      if (!selectedStreamerId) { uploadStatus.textContent = '⚠️ 검색해서 스트리머를 선택해 주세요.'; return; }
      if (!file) { uploadStatus.textContent = '⚠️ 이미지 파일을 선택해 주세요.'; return; }
      if (!ALLOWED_CONTENT_TYPES.has(file.type)) { uploadStatus.textContent = '⚠️ jpg/png/webp/gif 이미지만 업로드할 수 있어요.'; return; }
      if (file.size > MAX_UPLOAD_BYTES) { uploadStatus.textContent = '⚠️ 이미지 용량은 15MB 이하여야 해요.'; return; }

      // 스트리머별 업로드 잠금 — 클라이언트 쪽 확인은 UX용이고, 서버(registerImage)가
      // 다시 한 번 검증한다. 잠겨있으면 업로드 모달을 닫고 해금 신청 모달로 유도.
      if (!isStreamerUnlocked(selectedStreamerId)) {
        closeUploadModal();
        window.galOpenUnlockModal && window.galOpenUnlockModal(selectedStreamerId, selectedStreamerName);
        return;
      }

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
        await registerFn({ imageId: imageId, key: key, streamerId: selectedStreamerId, streamerName: selectedStreamerName, category: category });

        uploadStatus.textContent = '✅ 업로드 완료!';
        resetStreamerPicker();
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
  subscribeUnlockedStreamers();
})();
