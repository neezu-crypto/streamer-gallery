// 갤러리 그리드 렌더링 + 검색/카테고리 필터 + 업로드(requestImageUpload로 presigned URL
// 발급 → R2에 직접 PUT → registerImage로 메타데이터 등록, 3단계).
// gallery/images 노드 읽기는 이미 database.rules.json에 반영돼 있어 지금부터도 동작한다.
//
// 스트리머별 업로드 잠금(2026-09-05 추가) — 스트리머 이름은 자유 텍스트가 아니라
// streamer-names.json(정적 목록)에서 검색해서 선택하는 방식으로 바꿨다. 오타/띄어쓰기
// 차이로 같은 스트리머가 다르게 취급되면 해금 여부 판별 자체가 무의미해지기 때문.
(function () {
  var grid = document.getElementById('gallery-grid');
  var myGalleryBanner = document.getElementById('mygallery-banner');
  var loadMoreBtn = document.getElementById('gallery-load-more-btn');
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

  var IMAGES_PAGE_SIZE = 60;
  var imagesLimit = IMAGES_PAGE_SIZE;
  var imagesUnsub = null;
  var hasMoreImages = false;
  var allImages = [];
  var activeCategory = 'all';
  var myGalleryOnly = false;
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

  // 썸네일 숨기기(2026-09-05 추가) — 다른 사람에겐 영향 없이 이 계정의 메인
  // 그리드에서만 안 보이게 하는 개인 취향 필터. userLikes와 동일한 패턴으로
  // 로그인 상태가 바뀔 때마다 다시 구독한다(로그아웃하면 목록을 비움).
  window.galHiddenImages = {};
  var hiddenImagesUnsub = null;
  document.addEventListener('gal-auth-changed', function (e) {
    if (hiddenImagesUnsub) { hiddenImagesUnsub(); hiddenImagesUnsub = null; }
    if (!e.detail.trusted || !e.detail.user) {
      window.galHiddenImages = {};
      renderGrid();
      return;
    }
    hiddenImagesUnsub = window.galFirebase.onValue(
      window.galFirebase.ref(window.galDb, 'gallery/hiddenImages/' + e.detail.user.uid),
      function (snap) { window.galHiddenImages = snap.val() || {}; renderGrid(); },
      function (err) { console.error('숨긴 이미지 목록 구독 실패', err); }
    );
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isStreamerUnlocked(streamerId) {
    return !!(streamerId && window.galUnlockedStreamers && window.galUnlockedStreamers[streamerId] === true);
  }
  window.galIsStreamerUnlocked = isStreamerUnlocked;

  // 매소너리 계산 — styles.css의 .gallery-grid { grid-auto-rows:4px; gap:16px }와
  // 반드시 같은 값이어야 한다(둘 중 하나만 바꾸면 span 계산이 어긋난다).
  var MASONRY_ROW_UNIT = 4;
  var MASONRY_GAP = 16;
  var DEFAULT_ASPECT_RATIO = 4 / 3; // width/height — 비율 정보 없는(마이그레이션 이전) 이미지용 기본값

  // 카드 너비(반응형이라 컬럼 수에 따라 바뀜)는 실제 DOM에 붙은 뒤에만 알 수 있어서,
  // grid.innerHTML을 채운 직후 한 번 읽어(reflow 1회) 각 카드의 grid-row-end span을
  // 계산해 넣는다. 이미지의 실제 로드를 기다리지 않아도 되는 게 핵심 — width/height를
  // 업로드 시점에 이미 저장해뒀기 때문에(registerImage) 레이아웃이 튀지 않는다.
  function applyMasonrySpans() {
    grid.querySelectorAll('.gallery-card').forEach(function (card) {
      var w = card.offsetWidth;
      if (!w) return;
      var ratio = parseFloat(card.dataset.ratio) || DEFAULT_ASPECT_RATIO;
      var h = w / ratio;
      var span = Math.max(1, Math.ceil((h + MASONRY_GAP) / (MASONRY_ROW_UNIT + MASONRY_GAP)));
      card.style.gridRowEnd = 'span ' + span;
    });
  }

  function renderGrid() {
    if (!grid) return;
    // 내 갤러리 필터는 같은 그리드를 그대로 걸러서 보여주는 것뿐이라("다른 탭으로
    // 이동"이 아님), 헷갈리지 않게 켜져 있는 동안 그리드 위에 안내 띠를 띄운다.
    // renderGrid()가 상태 변경마다 항상 호출되는 지점이라 여기서 동기화하면
    // 켜고 끄는 모든 경로(버튼 토글, 홈 버튼 리셋)를 따로 챙기지 않아도 된다.
    if (myGalleryBanner) myGalleryBanner.style.display = myGalleryOnly ? '' : 'none';
    var streamerQuery = (searchInput && searchInput.value || '').trim().toLowerCase();
    var filtered = allImages.filter(function (img) {
      if (window.galHiddenImages && window.galHiddenImages[img.id]) return false;
      if (myGalleryOnly && (!window.galUser || img.uploaderUid !== window.galUser.uid)) return false;
      if (activeCategory !== 'all' && img.category !== activeCategory) return false;
      if (streamerQuery && !(img.streamerName || '').toLowerCase().includes(streamerQuery)) return false;
      return true;
    });

    // 더 보기는 "내 갤러리" 모드에선 의미 없다 — uploaderUid 필터링은 클라이언트에서
    // 하는데, 서버 페이지네이션(limitToLast)은 필터와 무관하게 최근 N개를 이미
    // 끊어서 가져오므로 "더 보기"를 눌러 페이지를 늘리는 흐름 자체는 그대로 유효하다.
    if (loadMoreBtn) loadMoreBtn.style.display = hasMoreImages ? '' : 'none';

    if (!filtered.length) {
      var emptyMsg = myGalleryOnly ? '아직 업로드한 이미지가 없어요.' : (allImages.length ? '조건에 맞는 이미지가 없어요.' : '아직 업로드된 이미지가 없어요. 첫 이미지를 올려보세요!');
      grid.innerHTML = '<p class="empty-msg">' + emptyMsg + '</p>';
      return;
    }

    // 핀터레스트식 매소너리 — 평소엔 이미지만, 마우스를 올리면 좋아요 수가
    // 어두운 그라데이션과 함께 드러난다(호버 리빌). 스트리머명/카테고리는 여전히
    // 클릭해서 상세보기로만 확인 — 그리드에 상시 노출하지 않는다.
    // "최근에 확인함" 배지(2026-09-05 추가)는 호버와 무관하게 상시 노출 — 스크롤
    // 하다가 바로 눈에 띄어야 하는 용도라서. localStorage에 마지막 1개만 기록.
    var lastViewedId = localStorage.getItem('galLastViewedImageId');
    grid.innerHTML = filtered.map(function (img) {
      var locked = !isStreamerUnlocked(img.streamerId);
      var ratio = (img.width && img.height) ? (img.width / img.height) : '';
      return (
        '<div class="gallery-card" data-image-id="' + escapeHtml(img.id) + '" data-ratio="' + ratio + '">' +
          (img.thumbUrl ? '<img src="' + escapeHtml(img.thumbUrl) + '" alt="" loading="lazy">' : '') +
          (locked ? '<span class="gallery-lock-badge" title="해금 필요">🔒</span>' : '') +
          (img.id === lastViewedId ? '<span class="gallery-recent-badge">최근에 확인함</span>' : '') +
          '<span class="gallery-card-hover-likes">♥ ' + (img.likeCount || 0) + '</span>' +
          '<button class="gallery-card-hide-btn" type="button" data-image-id="' + escapeHtml(img.id) + '" title="이 이미지 숨기기">✕</button>' +
        '</div>'
      );
    }).join('');
    applyMasonrySpans();
  }

  var masonryResizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(masonryResizeTimer);
    masonryResizeTimer = setTimeout(applyMasonrySpans, 150);
  });

  function subscribeImages() {
    if (!window.galFirebase || !window.galDb) { setTimeout(subscribeImages, 200); return; }
    if (imagesUnsub) { imagesUnsub(); imagesUnsub = null; }
    var imagesRef = window.galFirebase.query(
      window.galFirebase.ref(window.galDb, 'gallery/images'),
      window.galFirebase.limitToLast(imagesLimit)
    );
    imagesUnsub = window.galFirebase.onValue(imagesRef, function (snap) {
      var data = snap.val() || {};
      var keys = Object.keys(data);
      hasMoreImages = keys.length >= imagesLimit;
      allImages = keys.map(function (id) {
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

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      imagesLimit += IMAGES_PAGE_SIZE;
      subscribeImages();
    });
  }

  // 숨기기 버튼 — 카드 안에 있어서 클릭이 버블링되면 상세보기(gallery-detail.js의
  // document 클릭 리스너)까지 열려버리므로 stopPropagation으로 막는다. 확인창은
  // 이 코드베이스에서 이미지/댓글 삭제 때 쓰던 것과 동일하게 네이티브 confirm() 사용.
  if (grid) {
    grid.addEventListener('click', function (e) {
      var hideBtn = e.target.closest('.gallery-card-hide-btn');
      if (!hideBtn) return;
      e.stopPropagation();
      if (!window.galTrusted) {
        window.galCloseLoginModal && window.galCloseLoginModal();
        window.galOpenLoginModal && window.galOpenLoginModal();
        return;
      }
      if (!confirm('이 이미지를 숨길까요? 나에게만 안 보이게 돼요.')) return;
      var imageId = hideBtn.dataset.imageId;
      hideBtn.disabled = true;
      window.galFirebase.httpsCallable('hideImage')({ imageId: imageId }).catch(function (err) {
        alert('숨기기 처리 중 오류: ' + (err && err.message ? err.message : err));
        hideBtn.disabled = false;
      });
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

  // 모바일 하단 탭바(js/gallery-mobile-nav.js)의 카테고리 제스처가 이 클로저 밖에서
  // 필터를 바꿀 수 있게 노출하는 창구 — 데스크톱 카테고리 원형 배지와 동일하게
  // activeCategory를 갱신하고 그 배지의 active 표시도 같이 맞춰준다.
  window.galSetCategory = function (category) {
    activeCategory = category;
    if (chipsWrap) {
      chipsWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('active', c.dataset.category === category); });
    }
    renderGrid();
  };

  var myGalleryBtn = document.getElementById('open-mygallery-btn');

  // 홈 버튼 — 검색어/카테고리/내 갤러리 필터를 전부 초기 상태로 되돌린다.
  var sidebarHomeBtn = document.getElementById('sidebar-home-btn');
  if (sidebarHomeBtn) {
    sidebarHomeBtn.addEventListener('click', function () {
      if (searchInput) searchInput.value = '';
      activeCategory = 'all';
      myGalleryOnly = false;
      if (myGalleryBtn) myGalleryBtn.classList.remove('active');
      if (chipsWrap) {
        chipsWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        var allChip = chipsWrap.querySelector('[data-category="all"]');
        if (allChip) allChip.classList.add('active');
      }
      renderGrid();
    });
  }

  // 내 갤러리 버튼 — 로그인 안 돼있으면 로그인 유도, 돼있으면 uploaderUid로
  // 그리드를 필터링하는 토글(다시 누르면 해제).
  if (myGalleryBtn) {
    myGalleryBtn.addEventListener('click', function () {
      if (!window.galTrusted) {
        window.galCloseLoginModal && window.galCloseLoginModal();
        window.galOpenLoginModal && window.galOpenLoginModal();
        return;
      }
      myGalleryOnly = !myGalleryOnly;
      myGalleryBtn.classList.toggle('active', myGalleryOnly);
      renderGrid();
    });
  }

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
    window.galPushModal(closeUploadModal);
  }
  function closeUploadModal() { uploadBackdrop.classList.remove('open'); window.galPopModal(closeUploadModal); }
  window.galCloseUploadModal = closeUploadModal;

  if (uploadOpenBtn) uploadOpenBtn.addEventListener('click', openUploadModal);
  if (uploadCloseBtn) uploadCloseBtn.addEventListener('click', closeUploadModal);
  if (uploadBackdrop) {
    uploadBackdrop.addEventListener('click', function (e) { if (e.target === uploadBackdrop) closeUploadModal(); });
  }
  var ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  var MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
  var THUMB_MAX_DIMENSION = 480;

  // 실제 리사이즈된 썸네일 생성(2026-09-05 추가) — 원본을 그대로 썸네일로 쓰면
  // 그리드/관리자 목록 로딩마다 원본 용량을 통째로 내려받아야 해서, canvas로
  // 축소한 JPEG을 별도 파일로 만들어 같이 올린다. GIF도 canvas에 그리면 첫 프레임만
  // 나오는데, 썸네일은 정지 이미지로 충분하고 원본(imageUrl)은 애니메이션 그대로다.
  // 이 김에 원본 실제 크기(width/height)도 같이 얻어서 매소너리 그리드가 이미지
  // 로드를 기다리지 않고 바로 비율대로 배치할 수 있게 registerImage에 같이 넘긴다.
  function makeThumbnailBlob(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, THUMB_MAX_DIMENSION / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('썸네일 생성에 실패했어요.')); return; }
          resolve({ blob: blob, width: w, height: h });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
      img.src = url;
    });
  }

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
      uploadStatus.textContent = '⏳ 썸네일 생성 중...';
      try {
        var thumb = await makeThumbnailBlob(file);

        uploadStatus.textContent = '⏳ 업로드 준비 중...';
        var requestUploadFn = window.galFirebase.httpsCallable('requestImageUpload');
        var prepared = await requestUploadFn({ contentType: file.type, fileSize: file.size, thumbFileSize: thumb.blob.size });
        var uploadUrl = prepared.data.uploadUrl, thumbUploadUrl = prepared.data.thumbUploadUrl;
        var imageId = prepared.data.imageId, key = prepared.data.key, thumbKey = prepared.data.thumbKey;

        uploadStatus.textContent = '⏳ 이미지 업로드 중...';
        var putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!putRes.ok) throw new Error('R2 업로드 실패 (status ' + putRes.status + ')');
        var thumbPutRes = await fetch(thumbUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumb.blob });
        if (!thumbPutRes.ok) throw new Error('썸네일 업로드 실패 (status ' + thumbPutRes.status + ')');

        uploadStatus.textContent = '⏳ 등록 중...';
        var registerFn = window.galFirebase.httpsCallable('registerImage');
        await registerFn({
          imageId: imageId, key: key, thumbKey: thumbKey,
          streamerId: selectedStreamerId, streamerName: selectedStreamerName, category: category,
          width: thumb.width, height: thumb.height,
        });

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
