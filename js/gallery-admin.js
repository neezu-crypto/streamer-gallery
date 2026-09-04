// 관리자 전용 패널 — 신고 목록 처리(신고 무시/이미지 삭제) + 전체 이미지 관리(삭제).
// window.galIsAdmin은 서버(galleryCheckAdmin) 확인 결과로만 결정되고, 여기서 하는 건
// 버튼 노출 여부일 뿐 — 실제 삭제/무시는 각 Cloud Function이 서버에서 다시 관리자 여부를
// 검증하므로 클라이언트 쪽 숨김은 UX 편의일 뿐 보안 경계가 아니다.
(function () {
  var adminBtn = document.getElementById('open-admin-btn');
  var backdrop = document.getElementById('admin-backdrop');
  var closeBtn = document.getElementById('admin-modal-close');
  var tabsWrap = document.getElementById('admin-tabs');
  var reportsPanel = document.getElementById('admin-reports-panel');
  var imagesPanel = document.getElementById('admin-images-panel');
  if (!backdrop) return;

  var reportsUnsub = null;
  var latestReports = [];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findImage(id) {
    return (window.galAllImages || []).find(function (i) { return i.id === id; });
  }

  function renderReports() {
    if (!latestReports.length) { reportsPanel.innerHTML = '<p class="empty-msg">접수된 신고가 없어요.</p>'; return; }
    reportsPanel.innerHTML = latestReports.map(function (r) {
      var img = findImage(r.imageId);
      var thumb = img ? '<img src="' + escapeHtml(img.thumbUrl) + '" alt="">' : '';
      var when = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '';
      return (
        '<div class="admin-row" data-report-id="' + escapeHtml(r.id) + '" data-image-id="' + escapeHtml(r.imageId) + '">' +
          '<div class="admin-row-thumb">' + thumb + '</div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml((img && img.streamerName) || '(삭제된 이미지)') + ' · ' + when + '</div>' +
            '<div class="admin-row-reason">' + (escapeHtml(r.reason) || '(사유 없음)') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            '<button class="text-link admin-dismiss-btn" type="button">신고 무시</button>' +
            '<button class="text-link admin-delete-btn" type="button">이미지 삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderImages() {
    var images = window.galAllImages || [];
    var labels = window.galCategoryLabels || {};
    if (!images.length) { imagesPanel.innerHTML = '<p class="empty-msg">이미지가 없어요.</p>'; return; }
    imagesPanel.innerHTML = images.map(function (img) {
      return (
        '<div class="admin-row" data-image-id="' + escapeHtml(img.id) + '">' +
          '<div class="admin-row-thumb"><img src="' + escapeHtml(img.thumbUrl) + '" alt=""></div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(img.streamerName || '익명') + ' · ' + escapeHtml(labels[img.category] || img.category || '') + '</div>' +
            '<div class="admin-row-reason">♥ ' + (img.likeCount || 0) + ' · 💬 ' + (img.commentCount || 0) + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            '<button class="text-link admin-delete-btn" type="button">삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function subscribeReports() {
    if (reportsUnsub) return;
    var reportsRef = window.galFirebase.ref(window.galDb, 'gallery/imageReports');
    reportsUnsub = window.galFirebase.onValue(reportsRef, function (snap) {
      var data = snap.val() || {};
      latestReports = Object.keys(data).map(function (id) { return Object.assign({ id: id }, data[id]); })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderReports();
    }, function (err) {
      console.error('신고 목록 구독 실패', err);
      reportsPanel.innerHTML = '<p class="empty-msg">신고 목록을 불러오지 못했어요.</p>';
    });
  }

  document.addEventListener('gal-auth-changed', function (e) {
    adminBtn.style.display = e.detail.isAdmin ? '' : 'none';
    if (e.detail.isAdmin) subscribeReports();
  });
  document.addEventListener('gal-images-updated', function () {
    if (backdrop.classList.contains('open')) { renderReports(); renderImages(); }
  });

  adminBtn.addEventListener('click', function () {
    backdrop.classList.add('open');
    renderReports();
    renderImages();
  });
  closeBtn.addEventListener('click', function () { backdrop.classList.remove('open'); });
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.classList.remove('open'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && backdrop.classList.contains('open')) backdrop.classList.remove('open'); });

  tabsWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    tabsWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    var tab = btn.dataset.adminTab;
    reportsPanel.style.display = tab === 'reports' ? '' : 'none';
    imagesPanel.style.display = tab === 'images' ? '' : 'none';
  });

  async function deleteImage(imageId, btn) {
    if (!confirm('이 이미지를 삭제할까요? 되돌릴 수 없어요.')) return;
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDeleteImage');
      await fn({ imageId: imageId });
    } catch (e) {
      alert('이미지 삭제 중 오류: ' + (e && e.message ? e.message : e));
      btn.disabled = false;
    }
  }

  reportsPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    if (e.target.closest('.admin-dismiss-btn')) {
      var btn = e.target;
      btn.disabled = true;
      try {
        var fn = window.galFirebase.httpsCallable('adminDismissImageReport');
        await fn({ reportId: row.dataset.reportId });
      } catch (err) {
        alert('신고 무시 처리 중 오류: ' + (err && err.message ? err.message : err));
        btn.disabled = false;
      }
    } else if (e.target.closest('.admin-delete-btn')) {
      deleteImage(row.dataset.imageId, e.target);
    }
  });

  imagesPanel.addEventListener('click', function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    if (e.target.closest('.admin-delete-btn')) {
      deleteImage(row.dataset.imageId, e.target);
    }
  });
})();
