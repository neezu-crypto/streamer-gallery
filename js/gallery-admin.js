// 관리자 전용 패널 — 신고 목록 처리(신고 무시/이미지 삭제) + 전체 이미지 관리(삭제).
// window.galIsAdmin은 서버(galleryCheckAdmin) 확인 결과로만 결정되고, 여기서 하는 건
// 버튼 노출 여부일 뿐 — 실제 삭제/무시는 각 Cloud Function이 서버에서 다시 관리자 여부를
// 검증하므로 클라이언트 쪽 숨김은 UX 편의일 뿐 보안 경계가 아니다.
(function () {
  var adminBtn = document.getElementById('open-admin-btn');
  var backdrop = document.getElementById('admin-backdrop');
  var closeBtn = document.getElementById('admin-modal-close');
  var tabsWrap = document.getElementById('admin-sidebar');
  var reportsPanel = document.getElementById('admin-reports-panel');
  var commentsPanel = document.getElementById('admin-comments-panel');
  var imagesPanel = document.getElementById('admin-images-panel');
  var unlocksPanel = document.getElementById('admin-unlocks-panel');
  var bansPanel = document.getElementById('admin-bans-panel');
  var linksPanel = document.getElementById('admin-links-panel');
  var adminSidebar = document.getElementById('admin-sidebar');
  var mobileMenuBtn = document.getElementById('admin-mobile-menu-btn');
  var adminSearch = document.getElementById('admin-global-search');
  var resultSummary = document.getElementById('admin-result-summary');
  var currentSectionEl = document.getElementById('admin-current-section');
  var contentGrid = document.querySelector('.admin-content-grid');
  var detailPanel = document.getElementById('admin-detail-panel');
  var detailBackBtn = document.getElementById('admin-detail-back');
  var detailContent = document.getElementById('admin-detail-content');
  var reportsCountEl = document.getElementById('admin-reports-count');
  var commentsCountEl = document.getElementById('admin-comments-count');
  var unlocksCountEl = document.getElementById('admin-unlocks-count');
  if (!backdrop) return;

  var reportsUnsub = null;
  var latestReports = [];
  var commentReportsUnsub = null;
  var latestCommentReports = [];
  var unlocksUnsub = null;
  var latestUnlockRequests = [];
  var bansUnsub = null;
  var latestBans = [];
  var verificationsUnsub = null;
  var accountLinksUnsub = null;
  var latestVerifications = [];
  var latestAccountLinks = {};
  var pendingCommentReportDeletes = {};
  var selectedDetail = null;
  var detailLoadToken = 0;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findImage(id) {
    return (window.galAllImages || []).find(function (i) { return i.id === id; });
  }

  function formatWhen(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleString('ko-KR') : '시간 정보 없음';
  }

  function getSelectedReport() {
    if (!selectedDetail) return null;
    var source = selectedDetail.kind === 'comment' ? latestCommentReports : latestReports;
    return source.find(function (r) { return r.id === selectedDetail.reportId; }) || selectedDetail.report;
  }

  function getDetailAuthorUid(report, image, kind) {
    return kind === 'comment' ? (report && report.commentAuthorUid) : (image && image.uploaderUid);
  }

  function getRecentAuthorReports(authorUid) {
    if (!authorUid) return [];
    var items = [];
    latestReports.forEach(function (r) {
      var img = findImage(r.imageId);
      if (img && img.uploaderUid === authorUid) {
        items.push({ type: '이미지 신고', reason: r.reason, createdAt: r.createdAt });
      }
    });
    latestCommentReports.forEach(function (r) {
      if (r.commentAuthorUid === authorUid) {
        items.push({ type: '댓글 신고', reason: r.reason, createdAt: r.createdAt });
      }
    });
    return items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5);
  }

  function clearDetail() {
    selectedDetail = null;
    detailLoadToken += 1;
    if (contentGrid) contentGrid.classList.remove('admin-detail-open');
    if (detailContent) {
      detailContent.innerHTML = '<span class="admin-detail-kicker">DETAIL</span><h2>상세 정보</h2><p>신고 목록에서 항목을 선택하면 이미지·댓글·작성자 정보가 표시됩니다.</p>';
    }
  }

  function renderDetailPanel() {
    if (!detailContent || !selectedDetail) return;
    var report = getSelectedReport();
    if (!report) { clearDetail(); return; }
    var image = selectedDetail.image || findImage(report.imageId);
    var kind = selectedDetail.kind;
    var authorUid = getDetailAuthorUid(report, image, kind);
    var ban = authorUid && latestBans.find(function (b) { return b.uid === authorUid; });
    var recentReports = getRecentAuthorReports(authorUid);
    var previewUrl = image && (image.thumbUrl || image.imageUrl);
    var fullUrl = image && (image.imageUrl || image.thumbUrl);
    var detailType = kind === 'comment' ? '댓글 신고' : '이미지 신고';
    var targetName = image && image.streamerName ? image.streamerName : '(이미지 정보 없음)';
    var reportText = kind === 'comment'
      ? '<div class="admin-detail-section"><h3>신고된 댓글</h3><p class="admin-detail-comment">' + (escapeHtml(report.commentText) || '(내용 없음)') + '</p></div>'
      : '';
    var recentHtml = recentReports.length
      ? '<ul class="admin-detail-report-list">' + recentReports.map(function (r) {
          return '<li class="admin-detail-report-item"><strong>' + escapeHtml(r.type) + '</strong> · ' + escapeHtml(formatWhen(r.createdAt)) + '<br>' + (escapeHtml(r.reason) || '(사유 없음)') + '</li>';
        }).join('') + '</ul>'
      : '<p>최근 신고 내역이 없습니다.</p>';
    var statusHtml = ban
      ? '<p class="admin-detail-status is-banned">🔒 갤러리 이용 정지 상태<br>' + escapeHtml(ban.reason || '(사유 없음)') + '<br>' + escapeHtml(formatWhen(ban.bannedAt)) + '</p>'
      : '<p class="admin-detail-status is-clear">✅ 현재 갤러리 정지 상태가 아닙니다.</p>';
    var canBan = authorUid && authorUid !== (window.galUser && window.galUser.uid);
    var actions = '<div class="admin-detail-actions">' +
      (canBan ? '<button class="text-link admin-detail-action" type="button" data-detail-action="ban" data-uid="' + escapeHtml(authorUid) + '">작성자 정지</button>' : '') +
      '<button class="text-link admin-detail-action" type="button" data-detail-action="dismiss" data-report-id="' + escapeHtml(report.id) + '">' + (kind === 'comment' ? '댓글 신고 무시' : '이미지 신고 무시') + '</button>' +
      (kind === 'comment'
        ? '<button class="text-link admin-detail-action admin-detail-danger" type="button" data-detail-action="delete-comment" data-image-id="' + escapeHtml(report.imageId) + '" data-comment-id="' + escapeHtml(report.commentId) + '">댓글 삭제</button>'
        : (image ? '<button class="text-link admin-detail-action admin-detail-danger" type="button" data-detail-action="delete-image" data-image-id="' + escapeHtml(report.imageId) + '">이미지 삭제</button>' : '')) +
      '</div>';

    detailContent.innerHTML =
      '<span class="admin-detail-kicker">DETAIL</span>' +
      '<h2>' + escapeHtml(detailType) + '</h2>' +
      (previewUrl
        ? '<button class="admin-detail-preview" type="button" data-detail-preview-url="' + escapeHtml(fullUrl) + '" title="클릭하면 크게 보기"><img src="' + escapeHtml(previewUrl) + '" alt=""></button>'
        : '<div class="admin-detail-preview admin-detail-preview-empty">이미지를 찾을 수 없습니다.</div>') +
      '<div class="admin-detail-meta">' +
        '<span><strong>이미지</strong> ' + escapeHtml(targetName) + '</span>' +
        '<span><strong>신고 접수</strong> ' + escapeHtml(formatWhen(report.createdAt)) + '</span>' +
        '<span><strong>신고자</strong> ' + escapeHtml(report.reporterUid || '(알 수 없음)') + '</span>' +
        '<span><strong>작성자 UID</strong> ' + escapeHtml(authorUid || '(알 수 없음)') + '</span>' +
      '</div>' +
      reportText +
      '<div class="admin-detail-section"><h3>작성자 정지 상태</h3>' + statusHtml + '</div>' +
      '<div class="admin-detail-section"><h3>작성자 최근 신고 · 최대 5건</h3>' + recentHtml + '</div>' +
      actions;
  }

  async function selectDetail(kind, report) {
    if (!report) return;
    selectedDetail = { kind: kind, reportId: report.id, report: report, image: findImage(report.imageId) };
    var token = ++detailLoadToken;
    if (contentGrid) contentGrid.classList.add('admin-detail-open');
    if (detailContent) detailContent.innerHTML = '<span class="admin-detail-kicker">DETAIL</span><h2>불러오는 중...</h2><p>신고 대상 정보를 확인하고 있어요.</p>';
    if (!selectedDetail.image && report.imageId && window.galFirebase && window.galDb) {
      try {
        var snap = await window.galFirebase.get(window.galFirebase.ref(window.galDb, 'gallery/images/' + report.imageId));
        if (snap.exists()) selectedDetail.image = Object.assign({ id: report.imageId }, snap.val());
      } catch (e) { console.error('관리자 상세 이미지 조회 실패', e); }
    }
    if (token !== detailLoadToken || !selectedDetail) return;
    renderDetailPanel();
  }

  function filterCurrentPanel() {
    var panels = [reportsPanel, commentsPanel, imagesPanel, unlocksPanel, bansPanel, linksPanel];
    var activePanel = panels.find(function (panel) { return panel && panel.style.display !== 'none'; });
    if (!activePanel) return;
    var query = (adminSearch && adminSearch.value || '').trim().toLocaleLowerCase();
    var rows = Array.from(activePanel.querySelectorAll('.admin-row'));
    var visible = 0;
    rows.forEach(function (row) {
      var matches = !query || row.textContent.toLocaleLowerCase().includes(query);
      row.style.display = matches ? '' : 'none';
      if (matches) visible += 1;
    });
    if (resultSummary) {
      resultSummary.textContent = rows.length
        ? (query ? (visible + '개 / ' + rows.length + '개 표시') : (rows.length + '개'))
        : '';
    }
  }

  function renderReports() {
    latestReports = latestReports.filter(function (r) { return !(window.galPendingImageDeletes && window.galPendingImageDeletes[r.imageId]); });
    if (selectedDetail && selectedDetail.kind === 'image' && !latestReports.some(function (r) { return r.id === selectedDetail.reportId; })) clearDetail();
    if (reportsCountEl) {
      reportsCountEl.textContent = latestReports.length > 99 ? '99+' : String(latestReports.length);
      reportsCountEl.hidden = latestReports.length === 0;
    }
    if (!latestReports.length) { reportsPanel.innerHTML = '<p class="empty-msg">접수된 신고가 없어요.</p>'; filterCurrentPanel(); return; }
    reportsPanel.innerHTML = latestReports.map(function (r) {
      var img = findImage(r.imageId);
      var thumb = img ? '<img src="' + escapeHtml(img.thumbUrl) + '" alt="">' : '';
      var when = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '';
      var banBtn = (img && img.uploaderUid && img.uploaderUid !== (window.galUser && window.galUser.uid))
        ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + escapeHtml(img.uploaderUid) + '">업로더 정지</button>'
        : '';
      return (
        '<div class="admin-row admin-row-selectable' + (selectedDetail && selectedDetail.kind === 'image' && selectedDetail.reportId === r.id ? ' is-selected' : '') + '" data-report-id="' + escapeHtml(r.id) + '" data-image-id="' + escapeHtml(r.imageId) + '">' +
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
    filterCurrentPanel();
    if (selectedDetail && selectedDetail.kind === 'image') renderDetailPanel();
  }

  function renderCommentReports() {
    if (selectedDetail && selectedDetail.kind === 'comment' && !latestCommentReports.some(function (r) { return r.id === selectedDetail.reportId; })) clearDetail();
    if (commentsCountEl) {
      commentsCountEl.textContent = latestCommentReports.length > 99 ? '99+' : String(latestCommentReports.length);
      commentsCountEl.hidden = latestCommentReports.length === 0;
    }
    if (!latestCommentReports.length) { commentsPanel.innerHTML = '<p class="empty-msg">접수된 댓글 신고가 없어요.</p>'; filterCurrentPanel(); return; }
    commentsPanel.innerHTML = latestCommentReports.map(function (r) {
      var img = findImage(r.imageId);
      var when = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '';
      var author = escapeHtml(r.commentAuthorUid || '(알 수 없음)');
      return (
        '<div class="admin-row admin-row-selectable admin-comment-report-row' + (selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.reportId === r.id ? ' is-selected' : '') + '" data-report-id="' + escapeHtml(r.id) + '" data-image-id="' + escapeHtml(r.imageId) + '" data-comment-id="' + escapeHtml(r.commentId) + '">' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">댓글 신고 · ' + escapeHtml((img && img.streamerName) || r.imageId || '(이미지 없음)') + ' · ' + when + '</div>' +
            '<div class="admin-row-reason"><strong>댓글:</strong> ' + (escapeHtml(r.commentText) || '(내용 없음)') + '</div>' +
            '<div class="admin-row-reason"><strong>작성자:</strong> ' + author + ' · <strong>신고자:</strong> ' + escapeHtml(r.reporterUid || '(알 수 없음)') + '</div>' +
            '<div class="admin-row-reason"><strong>사유:</strong> ' + (escapeHtml(r.reason) || '(사유 없음)') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (r.commentAuthorUid && r.commentAuthorUid !== (window.galUser && window.galUser.uid) ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + author + '">작성자 정지</button>' : '') +
            '<button class="text-link admin-dismiss-comment-btn" type="button">신고 무시</button>' +
            '<button class="text-link admin-delete-comment-btn" type="button">댓글 삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    filterCurrentPanel();
    if (selectedDetail && selectedDetail.kind === 'comment') renderDetailPanel();
  }

  function renderImages() {
    var images = window.galAllImages || [];
    var labels = window.galCategoryLabels || {};
    if (!images.length) { imagesPanel.innerHTML = '<p class="empty-msg">이미지가 없어요.</p>'; filterCurrentPanel(); return; }
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
    filterCurrentPanel();
    if (selectedDetail) renderDetailPanel();
  }

  function renderBans() {
    if (!latestBans.length) { bansPanel.innerHTML = '<p class="empty-msg">정지된 계정이 없어요.</p>'; filterCurrentPanel(); return; }
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
    filterCurrentPanel();
    if (selectedDetail) renderDetailPanel();
  }

  // 인증 스트리머 계정 ↔ 스트리머ID 수동 연결(2026-09-06 추가) — deleteOwnImage의
  // 이름 자동 대조가 표기 차이(오타·띄어쓰기 등)로 실패하는 경우를 관리자가 직접
  // 보정한다. streamerVerifications는 공개 노드라 여기서도 그대로 읽을 수 있다.
  function renderLinks() {
    if (!latestVerifications.length) { linksPanel.innerHTML = '<p class="empty-msg">인증된 스트리머가 없어요.</p>'; filterCurrentPanel(); return; }
    linksPanel.innerHTML = latestVerifications.map(function (v) {
      var link = latestAccountLinks[v.uid];
      var statusText = link
        ? ('✅ 연결됨: ' + escapeHtml(link.streamerName))
        : '⚠️ 미연결(이름 자동 대조만 적용)';
      return (
        '<div class="admin-row" data-uid="' + escapeHtml(v.uid) + '" style="flex-direction:column; align-items:stretch;">' +
          '<div style="display:flex; align-items:center; gap:12px;">' +
            '<div class="admin-row-body">' +
              '<div class="admin-row-meta">' + escapeHtml(v.nickname) + ' · ' + escapeHtml(v.soopId) + '</div>' +
              '<div class="admin-row-reason">' + statusText + '</div>' +
            '</div>' +
            '<div class="admin-row-actions">' +
              '<button class="text-link admin-link-btn" type="button">' + (link ? '변경' : '연결') + '</button>' +
              (link ? '<button class="text-link admin-unlink-btn" type="button">연결 해제</button>' : '') +
            '</div>' +
          '</div>' +
          '<div class="admin-link-search" style="display:none; margin-top:10px;">' +
            '<input type="text" class="admin-link-search-input" placeholder="스트리머 이름으로 검색">' +
            '<div class="streamer-search-results admin-link-search-results"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    filterCurrentPanel();
  }

  function subscribeVerifications() {
    if (verificationsUnsub) return;
    var vRef = window.galFirebase.ref(window.galDb, 'streamerVerifications');
    verificationsUnsub = window.galFirebase.onValue(vRef, function (snap) {
      var data = snap.val() || {};
      latestVerifications = Object.keys(data).map(function (id) { return data[id]; })
        .sort(function (a, b) { return (b.verifiedAt || 0) - (a.verifiedAt || 0); });
      renderLinks();
    }, function (err) {
      console.error('인증 스트리머 목록 구독 실패', err);
      linksPanel.innerHTML = '<p class="empty-msg">인증 스트리머 목록을 불러오지 못했어요.</p>';
    });
  }

  function subscribeAccountLinks() {
    if (accountLinksUnsub) return;
    var lRef = window.galFirebase.ref(window.galDb, 'gallery/streamerAccountLinks');
    accountLinksUnsub = window.galFirebase.onValue(lRef, function (snap) {
      latestAccountLinks = snap.val() || {};
      renderLinks();
    }, function (err) {
      console.error('스트리머 연결 목록 구독 실패', err);
    });
  }

  function renderUnlocks() {
    var pending = latestUnlockRequests.filter(function (r) { return r.status === 'pending'; });
    if (unlocksCountEl) {
      unlocksCountEl.textContent = pending.length > 99 ? '99+' : String(pending.length);
      unlocksCountEl.hidden = pending.length === 0;
    }
    if (!pending.length) { unlocksPanel.innerHTML = '<p class="empty-msg">대기 중인 해금 신청이 없어요.</p>'; filterCurrentPanel(); return; }
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
    filterCurrentPanel();
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
        .filter(function (r) { return !(window.galPendingImageDeletes && window.galPendingImageDeletes[r.imageId]); })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderReports();
    }, function (err) {
      console.error('신고 목록 구독 실패', err);
      reportsPanel.innerHTML = '<p class="empty-msg">신고 목록을 불러오지 못했어요.</p>';
    });
  }

  function subscribeCommentReports() {
    if (commentReportsUnsub) return;
    var reportsRef = window.galFirebase.query(
      window.galFirebase.ref(window.galDb, 'gallery/commentReports'),
      window.galFirebase.limitToLast(500)
    );
    commentReportsUnsub = window.galFirebase.onValue(reportsRef, function (snap) {
      var data = snap.val() || {};
      latestCommentReports = Object.keys(data).map(function (id) { return Object.assign({ id: id }, data[id]); })
        .filter(function (r) { return !pendingCommentReportDeletes[r.id]; })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderCommentReports();
    }, function (err) {
      console.error('댓글 신고 목록 구독 실패', err);
      commentsPanel.innerHTML = '<p class="empty-msg">댓글 신고 목록을 불러오지 못했어요.</p>';
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
    if (e.detail.isAdmin) { subscribeReports(); subscribeCommentReports(); subscribeUnlockRequests(); subscribeBans(); subscribeVerifications(); subscribeAccountLinks(); }
  });
  document.addEventListener('gal-images-updated', function () {
    if (backdrop.classList.contains('open')) { renderReports(); renderCommentReports(); renderImages(); }
  });

  function closeAdminPanel() {
    backdrop.classList.remove('open');
    if (adminSidebar) adminSidebar.classList.remove('open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
    clearDetail();
    window.galPopModal(closeAdminPanel);
  }

  adminBtn.addEventListener('click', function () {
    backdrop.classList.add('open');
    window.galPushModal(closeAdminPanel);
    clearDetail();
    if (adminSearch) adminSearch.value = '';
    renderReports();
    renderCommentReports();
    renderImages();
    renderUnlocks();
    renderBans();
    renderLinks();
  });
  closeBtn.addEventListener('click', closeAdminPanel);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeAdminPanel(); });

  tabsWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-nav-item');
    if (!btn) return;
    if (btn.disabled) return;
    clearDetail();
    tabsWrap.querySelectorAll('.admin-nav-item').forEach(function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    var tab = btn.dataset.adminTab;
    reportsPanel.style.display = tab === 'reports' ? '' : 'none';
    commentsPanel.style.display = tab === 'comments' ? '' : 'none';
    imagesPanel.style.display = tab === 'images' ? '' : 'none';
    unlocksPanel.style.display = tab === 'unlocks' ? '' : 'none';
    bansPanel.style.display = tab === 'bans' ? '' : 'none';
    linksPanel.style.display = tab === 'links' ? '' : 'none';
    var names = { reports: '신고 목록', comments: '댓글 검수', images: '전체 이미지', unlocks: '해금 신청', bans: '정지 관리', links: '스트리머 연결' };
    if (currentSectionEl) currentSectionEl.textContent = names[tab] || '관리자';
    filterCurrentPanel();
    if (adminSidebar) adminSidebar.classList.remove('open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
  });

  if (adminSearch) adminSearch.addEventListener('input', filterCurrentPanel);
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', function () {
    var isOpen = adminSidebar && adminSidebar.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  async function banUploader(uid, btn) {
    var reason = prompt('정지 사유를 입력해 주세요.');
    if (reason === null) return;
    if (!reason.trim()) { alert('정지 사유를 입력해야 해요.'); return; }
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('banGalleryAccount');
      await fn({ uid: uid, reason: reason.trim() });
      window.galSound && window.galSound.adminAction();
      alert('✅ 정지 처리했어요.');
    } catch (e) {
      window.galSound && window.galSound.error(e);
      alert('정지 처리 중 오류: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteImage(imageId, btn) {
    if (!confirm('이 이미지를 삭제할까요? 되돌릴 수 없어요.')) return;
    var deletionToken = window.galBeginImageDelete && window.galBeginImageDelete(imageId);
    var previousReports = latestReports.slice();
    var removedReports = previousReports.filter(function (r) { return r.imageId === imageId; });
    latestReports = latestReports.filter(function (r) { return r.imageId !== imageId; });
    // 신고 목록·전체 이미지 목록·상세 패널을 서버 응답 전에 바로 갱신한다.
    renderReports();
    renderImages();
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDeleteImage');
      await fn({ imageId: imageId });
      window.galConfirmImageDelete && window.galConfirmImageDelete(imageId);
      window.galSound && window.galSound.adminAction();
    } catch (e) {
      window.galRollbackImageDelete && window.galRollbackImageDelete(deletionToken);
      removedReports.forEach(function (report) {
        if (!latestReports.some(function (current) { return current.id === report.id; })) latestReports.push(report);
      });
      latestReports.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderReports();
      renderImages();
      window.galSound && window.galSound.error(e);
      alert('이미지 삭제 중 오류: ' + (e && e.message ? e.message : e));
      btn.disabled = false;
    }
  }

  async function deleteComment(imageId, commentId, btn) {
    if (!confirm('이 댓글을 삭제할까요? 신고 항목도 함께 처리됩니다.')) return;
    var targetReport = latestCommentReports.find(function (r) { return r.imageId === imageId && r.commentId === commentId; });
    if (!targetReport && selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.report && selectedDetail.report.imageId === imageId && selectedDetail.report.commentId === commentId) {
      targetReport = selectedDetail.report;
    }
    var previousReports = latestCommentReports.slice();
    var selectedBefore = selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.reportId === (targetReport && targetReport.id) ? selectedDetail : null;
    if (targetReport) {
      pendingCommentReportDeletes[targetReport.id] = true;
      latestCommentReports = latestCommentReports.filter(function (r) { return r.id !== targetReport.id; });
      renderCommentReports();
    } else if (btn) {
      btn.disabled = true;
    }
    try {
      var fn = window.galFirebase.httpsCallable('adminDeleteComment');
      var result = await fn({ imageId: imageId, commentId: commentId });
      if (targetReport) delete pendingCommentReportDeletes[targetReport.id];
      if (result && result.data && typeof result.data.commentCount === 'number') {
        window.galPatchImageCommentCount && window.galPatchImageCommentCount(imageId, result.data.commentCount);
      }
      window.galSound && window.galSound.adminAction();
      if (selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.report && selectedDetail.report.commentId === commentId) clearDetail();
    } catch (e) {
      if (targetReport) {
        delete pendingCommentReportDeletes[targetReport.id];
        latestCommentReports = previousReports;
        renderCommentReports();
        if (selectedBefore) selectDetail(selectedBefore.kind, selectedBefore.report);
      }
      window.galSound && window.galSound.error(e);
      alert('댓글 삭제 중 오류: ' + (e && e.message ? e.message : e));
      if (!targetReport && btn) btn.disabled = false;
    }
  }

  async function dismissImageReport(reportId, btn) {
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDismissImageReport');
      await fn({ reportId: reportId });
      window.galSound && window.galSound.adminAction();
      if (selectedDetail && selectedDetail.kind === 'image' && selectedDetail.reportId === reportId) clearDetail();
    } catch (err) {
      window.galSound && window.galSound.error(err);
      alert('신고 무시 처리 중 오류: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
    }
  }

  async function dismissCommentReport(reportId, btn) {
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDismissCommentReport');
      await fn({ reportId: reportId });
      window.galSound && window.galSound.adminAction();
      if (selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.reportId === reportId) clearDetail();
    } catch (err) {
      window.galSound && window.galSound.error(err);
      alert('댓글 신고 무시 처리 중 오류: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
    }
  }

  if (detailBackBtn) detailBackBtn.addEventListener('click', clearDetail);
  if (detailPanel) detailPanel.addEventListener('click', function (e) {
    var preview = e.target.closest('.admin-detail-preview[data-detail-preview-url]');
    if (preview) {
      window.galOpenImageView && window.galOpenImageView(preview.dataset.detailPreviewUrl);
      return;
    }
    var btn = e.target.closest('.admin-detail-action');
    if (!btn) return;
    var action = btn.dataset.detailAction;
    if (action === 'ban') {
      banUploader(btn.dataset.uid, btn);
    } else if (action === 'dismiss') {
      if (selectedDetail && selectedDetail.kind === 'comment') dismissCommentReport(btn.dataset.reportId, btn);
      else dismissImageReport(btn.dataset.reportId, btn);
    } else if (action === 'delete-image') {
      deleteImage(btn.dataset.imageId, btn);
    } else if (action === 'delete-comment') {
      deleteComment(btn.dataset.imageId, btn.dataset.commentId, btn);
    }
  });

  reportsPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    if (e.target.closest('.admin-row-thumb.clickable')) {
      var reportedImg = findImage(row.dataset.imageId);
      var report = latestReports.find(function (r) { return r.id === row.dataset.reportId; });
      if (report) selectDetail('image', report);
      if (reportedImg) window.galOpenImageView(reportedImg.imageUrl || reportedImg.thumbUrl);
      return;
    }
    if (e.target.closest('.admin-ban-btn')) {
      banUploader(e.target.dataset.uid, e.target);
    } else if (e.target.closest('.admin-dismiss-btn')) {
      dismissImageReport(row.dataset.reportId, e.target);
    } else if (e.target.closest('.admin-delete-btn')) {
      deleteImage(row.dataset.imageId, e.target);
    } else {
      var report = latestReports.find(function (r) { return r.id === row.dataset.reportId; });
      if (report) selectDetail('image', report);
    }
  });

  commentsPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-comment-report-row');
    if (!row) return;
    if (e.target.closest('.admin-ban-btn')) {
      banUploader(e.target.dataset.uid, e.target);
      return;
    }
    if (e.target.closest('.admin-dismiss-comment-btn')) {
      dismissCommentReport(row.dataset.reportId, e.target);
      return;
    }
    if (e.target.closest('.admin-delete-comment-btn')) {
      deleteComment(row.dataset.imageId, row.dataset.commentId, e.target);
      return;
    }
    var report = latestCommentReports.find(function (r) { return r.id === row.dataset.reportId; });
    if (report) selectDetail('comment', report);
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
        window.galSound && window.galSound.adminAction();
      } catch (err) {
        window.galSound && window.galSound.error(err);
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
        window.galSound && window.galSound.adminAction();
      } catch (err) {
        window.galSound && window.galSound.error(err);
        alert('해금 승인 중 오류: ' + (err && err.message ? err.message : err));
        approveBtn.disabled = false;
      }
    } else if (e.target.closest('.admin-reject-unlock-btn')) {
      var rejectBtn = e.target;
      rejectBtn.disabled = true;
      try {
        var rejectFn = window.galFirebase.httpsCallable('adminRejectStreamerUnlock');
        await rejectFn({ requestId: requestId });
        window.galSound && window.galSound.adminAction();
      } catch (err) {
        window.galSound && window.galSound.error(err);
        alert('해금 거절 중 오류: ' + (err && err.message ? err.message : err));
        rejectBtn.disabled = false;
      }
    }
  });

  linksPanel.addEventListener('click', async function (e) {
    var row = e.target.closest('.admin-row');
    if (!row) return;
    var uid = row.dataset.uid;

    if (e.target.closest('.admin-link-btn')) {
      var searchBox = row.querySelector('.admin-link-search');
      var isOpen = searchBox.style.display !== 'none';
      searchBox.style.display = isOpen ? 'none' : '';
      if (!isOpen) row.querySelector('.admin-link-search-input').focus();
      return;
    }

    if (e.target.closest('.admin-unlink-btn')) {
      if (!confirm('이 계정의 스트리머 연결을 해제할까요?')) return;
      var unlinkBtn = e.target;
      unlinkBtn.disabled = true;
      try {
        var unlinkFn = window.galFirebase.httpsCallable('adminUnlinkStreamerAccount');
        await unlinkFn({ uid: uid });
        window.galSound && window.galSound.adminAction();
      } catch (err) {
        window.galSound && window.galSound.error(err);
        alert('연결 해제 중 오류: ' + (err && err.message ? err.message : err));
        unlinkBtn.disabled = false;
      }
      return;
    }

    var pickedRow = e.target.closest('.streamer-row');
    if (pickedRow) {
      try {
        var linkFn = window.galFirebase.httpsCallable('adminLinkStreamerAccount');
        await linkFn({ uid: uid, streamerId: pickedRow.dataset.streamerId, streamerName: pickedRow.dataset.streamerName });
        window.galSound && window.galSound.adminAction();
      } catch (err) {
        window.galSound && window.galSound.error(err);
        alert('스트리머 연결 중 오류: ' + (err && err.message ? err.message : err));
      }
    }
  });

  linksPanel.addEventListener('input', function (e) {
    if (!e.target.classList.contains('admin-link-search-input')) return;
    var row = e.target.closest('.admin-row');
    var resultsEl = row.querySelector('.admin-link-search-results');
    var q = e.target.value.trim();
    resultsEl.innerHTML = '';
    if (!q) return;
    var matches = (window.galAllStreamers || []).filter(function (s) { return s.name.includes(q); }).slice(0, 12);
    if (!matches.length) { resultsEl.innerHTML = '<p class="empty-msg">일치하는 스트리머가 없어요.</p>'; return; }
    resultsEl.innerHTML = matches.map(function (s) {
      return '<div class="streamer-row" data-streamer-id="' + escapeHtml(s.id) + '" data-streamer-name="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</div>';
    }).join('');
  });
})();
