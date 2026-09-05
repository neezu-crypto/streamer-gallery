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
  var deleteBtn = document.getElementById('detail-delete-btn');
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
    window.galPopModal(closeModal);
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
    var myUid = window.galUser && window.galUser.uid;
    commentsWrap.innerHTML = list.map(function (c) {
      var mine = myUid && c.uid === myUid;
      return (
        '<div class="detail-comment-row" data-comment-id="' + escapeHtml(c.id) + '">' +
          '<span class="detail-comment-text">' + escapeHtml(c.text) + '</span>' +
          (mine ? '<button class="text-link detail-comment-delete-btn" type="button">삭제</button>' : '') +
        '</div>'
      );
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

  // "최근에 확인함" 표시(2026-09-05 추가) — 계정 동기화가 필요 없는 브라우저 로컬
  // UX 힌트라 RTDB가 아니라 localStorage에 마지막 1개만 기록한다.
  function openModal(img) {
    currentImageId = img.id;
    localStorage.setItem('galLastViewedImageId', img.id);
    imageEl.src = img.imageUrl || img.thumbUrl || '';
    streamerEl.textContent = img.streamerName || '익명';
    categoryEl.textContent = (window.galCategoryLabels && window.galCategoryLabels[img.category]) || img.category || '';
    likeCountEl.textContent = img.likeCount || 0;
    deleteBtn.style.display = (window.galUser && img.uploaderUid === window.galUser.uid) ? '' : 'none';
    reportForm.style.display = 'none';
    reportReasonInput.value = '';
    reportStatus.textContent = '';
    commentInput.value = '';
    commentsWrap.innerHTML = '<p class="empty-msg">댓글을 불러오는 중...</p>';
    backdrop.classList.add('open');
    window.galPushModal(closeModal);
    refreshLikedState(img.id);
    subscribeComments(img.id);
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.gallery-card');
    if (!card) return;
    var id = card.dataset.imageId;
    var img = (window.galAllImages || []).find(function (i) { return i.id === id; });
    if (!img) return;
    // 스트리머별 업로드 잠금(2026-09-05 추가) — 잠긴 스트리머 이미지는 그리드엔
    // 나오지만(🔒 배지), 클릭하면 상세보기(좋아요/댓글) 대신 해금 신청 모달로 유도한다.
    if (window.galIsStreamerUnlocked && !window.galIsStreamerUnlocked(img.streamerId)) {
      window.galOpenUnlockModal && window.galOpenUnlockModal(img.streamerId, img.streamerName);
      return;
    }
    openModal(img);
  });

  imageEl.addEventListener('click', function () {
    if (currentImageId) window.galOpenImageView(imageEl.src);
  });

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });

  likeBtn.addEventListener('click', async function () {
    if (!currentImageId || likeBtn.disabled) return;
    if (!window.galTrusted) { closeModal(); window.galOpenLoginModal && window.galOpenLoginModal(); return; }

    // 낙관적 업데이트 — 서버 응답을 기다리지 않고 바로 화면에 반영, 실패하면
    // 원래 상태로 되돌린다(성공 시엔 서버가 확정한 진짜 값으로 다시 맞춘다 —
    // 동시에 여러 명이 좋아요를 눌러서 카운트가 낙관값과 다를 수 있어서).
    var wasLiked = likeBtn.classList.contains('active');
    var prevCount = parseInt(likeCountEl.textContent, 10) || 0;
    var optimisticLiked = !wasLiked;
    likeBtn.classList.toggle('active', optimisticLiked);
    likeCountEl.textContent = Math.max(0, prevCount + (optimisticLiked ? 1 : -1));

    likeBtn.disabled = true;
    try {
      var toggleFn = window.galFirebase.httpsCallable('toggleLike');
      var result = await toggleFn({ imageId: currentImageId });
      likeBtn.classList.toggle('active', result.data.liked);
      likeCountEl.textContent = result.data.likeCount;
    } catch (e) {
      likeBtn.classList.toggle('active', wasLiked);
      likeCountEl.textContent = prevCount;
      alert('좋아요 처리 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
    } finally {
      likeBtn.disabled = false;
    }
  });

  deleteBtn.addEventListener('click', async function () {
    if (!currentImageId) return;
    if (!confirm('이 이미지를 삭제할까요? 되돌릴 수 없어요.')) return;
    deleteBtn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('deleteOwnImage');
      await fn({ imageId: currentImageId });
      closeModal();
    } catch (e) {
      alert('이미지 삭제 중 오류: ' + (e && e.message ? e.message : e));
    } finally {
      deleteBtn.disabled = false;
    }
  });

  commentsWrap.addEventListener('click', async function (e) {
    var btn = e.target.closest('.detail-comment-delete-btn');
    if (!btn || !currentImageId) return;
    var row = e.target.closest('.detail-comment-row');
    if (!confirm('이 댓글을 삭제할까요?')) return;
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('deleteOwnComment');
      await fn({ imageId: currentImageId, commentId: row.dataset.commentId });
    } catch (e2) {
      alert('댓글 삭제 중 오류: ' + (e2 && e2.message ? e2.message : e2));
      btn.disabled = false;
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

    // 낙관적 업데이트 — 서버 응답을 기다리지 않고 목록에 바로 추가해 보여준다.
    // 성공하면 실시간 구독(subscribeComments)이 곧 서버 확정 목록으로 통째로
    // 다시 그려서 이 임시 항목을 자연스럽게 대체하므로 따로 정리할 필요 없다.
    // 실패하면 이 임시 항목만 지우고 입력 내용을 복구한다.
    if (commentsWrap.querySelector('.empty-msg')) commentsWrap.innerHTML = '';
    var tempRow = document.createElement('div');
    tempRow.className = 'detail-comment-row';
    tempRow.style.opacity = '0.55';
    var textSpan = document.createElement('span');
    textSpan.className = 'detail-comment-text';
    textSpan.textContent = text;
    tempRow.appendChild(textSpan);
    commentsWrap.appendChild(tempRow);
    commentInput.value = '';

    commentSubmitBtn.disabled = true;
    try {
      var postFn = window.galFirebase.httpsCallable('postComment');
      await postFn({ imageId: currentImageId, text: text });
    } catch (e) {
      if (tempRow.parentNode) tempRow.parentNode.removeChild(tempRow);
      commentInput.value = text;
      alert('댓글 등록 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
    } finally {
      commentSubmitBtn.disabled = false;
    }
  });
})();
