// 이미지 상세 모달 — 좋아요 토글 + 댓글 목록/작성 + 신고. 그리드(js/gallery.js)가
// window.galAllImages에 최신 목록을 유지하므로 별도로 이미지 하나만 다시 읽지 않고
// 그 캐시에서 찾아 쓴다(읽기 횟수 최소화).
(function () {
  var backdrop = document.getElementById('detail-backdrop');
  var closeBtn = document.getElementById('detail-modal-close');
  var imageEl = document.getElementById('detail-image');
  var streamerEl = document.getElementById('detail-streamer');
  var categoryEl = document.getElementById('detail-category');
  var likeBtn = document.getElementById('detail-like-btn');
  var likeCountEl = document.getElementById('detail-like-count');
  var reportBtn = document.getElementById('detail-report-btn');
  var reportForm = document.getElementById('detail-report-form');
  var reportReasonInput = document.getElementById('detail-report-reason');
  var reportSubmitBtn = document.getElementById('detail-report-submit');
  var reportStatus = document.getElementById('detail-report-status');
  var commentsWrap = document.getElementById('detail-comments');
  var commentInput = document.getElementById('detail-comment-input');
  var commentSubmitBtn = document.getElementById('detail-comment-submit');
  if (!backdrop) return;

  var currentImageId = null;
  var commentsUnsub = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function closeModal() {
    backdrop.classList.remove('open');
    if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
    currentImageId = null;
  }

  async function refreshLikedState(imageId) {
    likeBtn.classList.remove('active');
    if (!window.galUser || !window.galTrusted) return;
    try {
      var snap = await window.galFirebase.get(window.galFirebase.ref(window.galDb, 'gallery/userLikes/' + window.galUser.uid + '/' + imageId));
      likeBtn.classList.toggle('active', snap.exists());
    } catch (e) { console.error('좋아요 상태 확인 실패', e); }
  }

  function renderComments(list) {
    if (!list.length) { commentsWrap.innerHTML = '<p class="empty-msg">아직 댓글이 없어요. 첫 댓글을 남겨보세요!</p>'; return; }
    commentsWrap.innerHTML = list.map(function (c) {
      return '<div class="detail-comment-row"><span class="detail-comment-text">' + escapeHtml(c.text) + '</span></div>';
    }).join('');
  }

  function subscribeComments(imageId) {
    var commentsRef = window.galFirebase.ref(window.galDb, 'gallery/comments/' + imageId);
    commentsUnsub = window.galFirebase.onValue(commentsRef, function (snap) {
      var data = snap.val() || {};
      var list = Object.keys(data).map(function (id) { return Object.assign({ id: id }, data[id]); })
        .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      renderComments(list);
    });
  }

  function openModal(img) {
    currentImageId = img.id;
    imageEl.src = img.imageUrl || img.thumbUrl || '';
    streamerEl.textContent = img.streamerName || '익명';
    categoryEl.textContent = (window.galCategoryLabels && window.galCategoryLabels[img.category]) || img.category || '';
    likeCountEl.textContent = img.likeCount || 0;
    reportForm.style.display = 'none';
    reportReasonInput.value = '';
    reportStatus.textContent = '';
    commentInput.value = '';
    commentsWrap.innerHTML = '<p class="empty-msg">댓글을 불러오는 중...</p>';
    backdrop.classList.add('open');
    refreshLikedState(img.id);
    subscribeComments(img.id);
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.gallery-card');
    if (!card) return;
    var id = card.dataset.imageId;
    var img = (window.galAllImages || []).find(function (i) { return i.id === id; });
    if (img) openModal(img);
  });

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });

  likeBtn.addEventListener('click', async function () {
    if (!currentImageId) return;
    if (!window.galTrusted) { closeModal(); window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    likeBtn.disabled = true;
    try {
      var toggleFn = window.galFirebase.httpsCallable('toggleLike');
      var result = await toggleFn({ imageId: currentImageId });
      likeBtn.classList.toggle('active', result.data.liked);
      likeCountEl.textContent = result.data.likeCount;
    } catch (e) {
      alert('좋아요 처리 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
    } finally {
      likeBtn.disabled = false;
    }
  });

  reportBtn.addEventListener('click', function () {
    if (!window.galTrusted) { closeModal(); window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    reportForm.style.display = reportForm.style.display === 'none' ? '' : 'none';
  });

  reportSubmitBtn.addEventListener('click', async function () {
    if (!currentImageId) return;
    reportSubmitBtn.disabled = true;
    reportStatus.textContent = '⏳ 신고 접수 중...';
    try {
      var reportFn = window.galFirebase.httpsCallable('reportImage');
      await reportFn({ imageId: currentImageId, reason: reportReasonInput.value });
      reportStatus.textContent = '✅ 신고가 접수됐어요. 검토 후 조치할게요.';
      setTimeout(function () { reportForm.style.display = 'none'; }, 1200);
    } catch (e) {
      reportStatus.textContent = '❌ 신고 처리 중 오류: ' + (e && e.message ? e.message : e);
    } finally {
      reportSubmitBtn.disabled = false;
    }
  });

  commentSubmitBtn.addEventListener('click', async function () {
    if (!currentImageId) return;
    if (!window.galTrusted) { closeModal(); window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    var text = commentInput.value.trim();
    if (!text) return;
    commentSubmitBtn.disabled = true;
    try {
      var postFn = window.galFirebase.httpsCallable('postComment');
      await postFn({ imageId: currentImageId, text: text });
      commentInput.value = '';
    } catch (e) {
      alert('댓글 등록 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
    } finally {
      commentSubmitBtn.disabled = false;
    }
  });
})();
