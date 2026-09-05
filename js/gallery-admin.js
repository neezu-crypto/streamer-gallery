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
  var unlocksPanel = document.getElementById('admin-unlocks-panel');
  var bansPanel = document.getElementById('admin-bans-panel');
  if (!backdrop) return;

  var reportsUnsub = null;
  var latestReports = [];
  var unlocksUnsub = null;
  var latestUnlockRequests = [];
  var bansUnsub = null;
  var latestBans = [];

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
      var banBtn = (img && img.uploaderUid && img.uploaderUid !== (window.galUser && window.galUser.uid))
        ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + escapeHtml(img.uploaderUid) + '">업로더 정지</button>'
        : '';
      return (
        '<div class="admin-row" data-report-id="' + escapeHtml(r.id) + '" data-image-id="' + escapeHtml(r.imageId) + '">' +
          '<div class="admin-row-thumb' + (img ? ' clickable' : '') + '" title="' + (img ? '클릭하면 풀이미지로 열어요' : '') + '">' + thumb + '</div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml((img && img.streamerName) || '(삭제된 이미지)') + ' · ' + when + '</div>' +
            '<div class="admin-row-reason">' + (escapeHtml(r.reason) || '(사유 없음)') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            banBtn +
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
          '<div class="admin-row-thumb clickable" title="클릭하면 풀이미지로 열어요"><img src="' + escapeHtml(img.thumbUrl) + '" alt=""></div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(img.streamerName || '익명') + ' · ' + escapeHtml(labels[img.category] || img.category || '') + '</div>' +
            '<div class="admin-row-reason">♥ ' + (img.likeCount || 0) + ' · 💬 ' + (img.commentCount || 0) + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (img.uploaderUid && img.uploaderUid !== (window.galUser && window.galUser.uid) ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + escapeHtml(img.uploaderUid) + '">업로더 정지</button>' : '') +
            '<button class="text-link admin-delete-btn" type="button">삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderBans() {
    if (!latestBans.length) { bansPanel.innerHTML = '<p class="empty-msg">정지된 계정이 없어요.</p>'; return; }
    bansPanel.innerHTML = latestBans.map(function (b) {
      var when = b.bannedAt ? new Date(b.bannedAt).toLocaleString('ko-KR') : '';
      return (
        '<div class="admin-row" data-uid="' + escapeHtml(b.uid) + '">' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(b.uid) + ' · ' + when + '</div>' +
            '<div class="admin-row-reason">' + (escapeHtml(b.reason) || '(사유 없음)') + ' · 처리자: ' + escapeHtml(b.bannedByName || '') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            '<button class="text-link admin-unban-btn" type="button">정지 해제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderUnlocks() {
    var pending = latestUnlockRequests.filter(function (r) { return r.status === 'pending'; });
    if (!pending.length) { unlocksPanel.innerHTML = '<p class="empty-msg">대기 중인 해금 신청이 없어요.</p>'; return; }
    unlocksPanel.innerHTML = pending.map(function (r) {
      var when = r.requestedAt ? new Date(r.requestedAt).toLocaleString('ko-KR') : '';
      return (
        '<div class="admin-row" data-request-id="' + escapeHtml(r.id) + '">' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(r.streamerName) + ' · ' + when + '</div>' +
            '<div class="admin-row-reason">후원자 닉네임: ' + escapeHtml(r.nickname) + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            '<button class="text-link admin-reject-unlock-btn" type="button">거절</button>' +
            '<button class="text-link admin-approve-unlock-btn" type="button">해금 승인</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function subscribeUnlockRequests() {
    if (unlocksUnsub) return;
    // 승인/거절되면 바로 목록에서 빠지는 큐라 자연스럽게 작게 유지되지만,
    // 방어적으로 최근 200건까지만 구독한다.
    var reqRef = window.galFirebase.query(
      window.galFirebase.ref(window.galDb, 'gallery/unlockRequests'),
      window.galFirebase.limitToLast(200)
    );
    unlocksUnsub = window.galFirebase.onValue(reqRef, function (snap) {
      var data = snap.val() || {};
      latestUnlockRequests = Object.keys(data).map(function (id) { return Object.assign({ id: id }, data[id]); })
        .sort(function (a, b) { return (b.requestedAt || 0) - (a.requestedAt || 0); });
      renderUnlocks();
    }, function (err) {
      console.error('해금 신청 목록 구독 실패', err);
      unlocksPanel.innerHTML = '<p class="empty-msg">해금 신청 목록을 불러오지 못했어요.</p>';
    });
  }

  function subscribeReports() {
    if (reportsUnsub) return;
    // reportImage가 이미 유저당-이미지당 1건+전체 500건 상한을 걸어두지만,
    // 관리자 목록 구독도 방어적으로 같은 상한을 둔다.
    var reportsRef = window.galFirebase.query(
      window.galFirebase.ref(window.galDb, 'gallery/imageReports'),
      window.galFirebase.limitToLast(500)
    );
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

  // bannedAccounts는 게임 전체가 공유하는 루트 노드라 정지 사유에 다른 게임 것도 섞여
  // 올 수 있다 — games.gallery가 있는 것만 걸러서 보여준다(정지 자체는 게임별이라
  // 실제 효력엔 문제없음, 목록에 다른 게임 정지 건이 안 보이게 필터링만 하는 것).
  function subscribeBans() {
    if (bansUnsub) return;
    var bansRef = window.galFirebase.ref(window.galDb, 'bannedAccounts');
    bansUnsub = window.galFirebase.onValue(bansRef, function (snap) {
      var data = snap.val() || {};
      latestBans = Object.keys(data)
        .filter(function (uid) { return data[uid] && data[uid].games && data[uid].games.gallery; })
        .map(function (uid) { return Object.assign({ uid: uid }, data[uid].games.gallery); })
        .sort(function (a, b) { return (b.bannedAt || 0) - (a.bannedAt || 0); });
      renderBans();
    }, function (err) {
      console.error('정지 계정 목록 구독 실패', err);
      bansPanel.innerHTML = '<p class="empty-msg">정지 계정 목록을 불러오지 못했어요.</p>';
    });
  }

  document.addEventListener('gal-auth-changed', function (e) {
    adminBtn.style.display = e.detail.isAdmin ? '' : 'none';
    if (e.detail.isAdmin) { subscribeReports(); subscribeUnlockRequests(); subscribeBans(); }
  });
  document.addEventListener('gal-images-updated', function () {
    if (backdrop.classList.contains('open')) { renderReports(); renderImages(); }
  });

  function closeAdminPanel() { backdrop.classList.remove('open'); window.galPopModal(closeAdminPanel); }

  adminBtn.addEventListener('click', function () {
    backdrop.classList.add('open');
    window.galPushModal(closeAdminPanel);
    renderReports();
    renderImages();
    renderUnlocks();
    renderBans();
  });
  closeBtn.addEventListener('click', closeAdminPanel);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeAdminPanel(); });

  tabsWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    tabsWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    var tab = btn.dataset.adminTab;
    reportsPanel.style.display = tab === 'reports' ? '' : 'none';
    imagesPanel.style.display = tab === 'images' ? '' : 'none';
    unlocksPanel.style.display = tab === 'unlocks' ? '' : 'none';
    bansPanel.style.display = tab === 'bans' ? '' : 'none';
  });

  async function banUploader(uid, btn) {
    var reason = prompt('정지 사유를 입력해 주세요.');
    if (reason === null) return;
    if (!reason.trim()) { alert('정지 사유를 입력해야 해요.'); return; }
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('banGalleryAccount');
      await fn({ uid: uid, reason: reason.trim() });
      alert('✅ 정지 처리했어요.');
    } catch (e) {
      alert('정지 처리 중 오류: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

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
    if (e.target.closest('.admin-row-thumb.clickable')) {
      var reportedImg = findImage(row.dataset.imageId);
      if (reportedImg) window.galOpenImageView(reportedImg.imageUrl || reportedImg.thumbUrl);
      return;
    }
    if (e.target.closest('.admin-ban-btn')) {
      banUploader(e.target.dataset.uid, e.target);
    } else if (e.target.closest('.admin-dismiss-btn')) {
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
    if (e.target.closest('.admin-row-thumb.clickable')) {
      var img = findImage(row.dataset.imageId);
      if (img) window.galOpenImageView(img.imageUrl || img.thumbUrl);
      return;
    }
    if (e.target.closest('.admin-ban-btn')) {
      banUploader(e.target.dataset.uid, e.target);
    } else if (e.target.closest('.admin-delete-btn')) {
      deleteImage(row.dataset.imageId, e.target);
    }
  });

  bansPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    if (e.target.closest('.admin-unban-btn')) {
      var btn = e.target;
      btn.disabled = true;
      try {
        var fn = window.galFirebase.httpsCallable('unbanGalleryAccount');
        await fn({ uid: row.dataset.uid });
      } catch (err) {
        alert('정지 해제 중 오류: ' + (err && err.message ? err.message : err));
        btn.disabled = false;
      }
    }
  });

  unlocksPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    var requestId = row.dataset.requestId;
    if (e.target.closest('.admin-approve-unlock-btn')) {
      var approveBtn = e.target;
      approveBtn.disabled = true;
      try {
        var approveFn = window.galFirebase.httpsCallable('adminApproveStreamerUnlock');
        await approveFn({ requestId: requestId });
      } catch (err) {
        alert('해금 승인 중 오류: ' + (err && err.message ? err.message : err));
        approveBtn.disabled = false;
      }
    } else if (e.target.closest('.admin-reject-unlock-btn')) {
      var rejectBtn = e.target;
      rejectBtn.disabled = true;
      try {
        var rejectFn = window.galFirebase.httpsCallable('adminRejectStreamerUnlock');
        await rejectFn({ requestId: requestId });
      } catch (err) {
        alert('해금 거절 중 오류: ' + (err && err.message ? err.message : err));
        rejectBtn.disabled = false;
      }
    }
  });
})();
