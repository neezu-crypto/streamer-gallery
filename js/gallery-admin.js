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
  var usersPanel = document.getElementById('admin-users-panel');
  var auditPanel = document.getElementById('admin-audit-panel');
  var auditList = document.getElementById('admin-audit-list');
  var auditActionField = document.getElementById('admin-audit-action-field');
  var auditActionFilter = document.getElementById('admin-audit-action-filter');
  var storagePanel = document.getElementById('admin-storage-panel');
  var storageScanBtn = document.getElementById('admin-storage-scan-btn');
  var storageDeleteBtn = document.getElementById('admin-storage-delete-btn');
  var storageSelectAll = document.getElementById('admin-storage-select-all');
  var storageStatus = document.getElementById('admin-storage-status');
  var storageSummary = document.getElementById('admin-storage-summary');
  var storageOrphans = document.getElementById('admin-storage-orphans');
  var storageMissing = document.getElementById('admin-storage-missing');
  var statsPanel = document.getElementById('admin-stats-panel');
  var statsDaysSelect = document.getElementById('admin-stats-days');
  var statsRefreshBtn = document.getElementById('admin-stats-refresh-btn');
  var statsStatus = document.getElementById('admin-stats-status');
  var statsTotals = document.getElementById('admin-stats-totals');
  var statsTimeseries = document.getElementById('admin-stats-timeseries');
  var statsCategories = document.getElementById('admin-stats-categories');
  var statsStreamers = document.getElementById('admin-stats-streamers');
  var statsModeration = document.getElementById('admin-stats-moderation');
  var usersSearchInput = document.getElementById('admin-users-search-input');
  var usersSearchBtn = document.getElementById('admin-users-search-btn');
  var usersSearchStatus = document.getElementById('admin-users-search-status');
  var usersResults = document.getElementById('admin-users-results');
  var adminSidebar = document.getElementById('admin-sidebar');
  var mobileMenuBtn = document.getElementById('admin-mobile-menu-btn');
  var adminSearch = document.getElementById('admin-global-search');
  var typeFilter = document.getElementById('admin-type-filter');
  var statusFilter = document.getElementById('admin-status-filter');
  var fromFilter = document.getElementById('admin-from-filter');
  var toFilter = document.getElementById('admin-to-filter');
  var sortFilter = document.getElementById('admin-sort-filter');
  var filterResetBtn = document.getElementById('admin-filter-reset');
  var bulkToolbar = document.getElementById('admin-bulk-toolbar');
  var selectAllCheckbox = document.getElementById('admin-select-all');
  var selectedCountEl = document.getElementById('admin-selected-count');
  var bulkActionSelect = document.getElementById('admin-bulk-action');
  var bulkApplyBtn = document.getElementById('admin-bulk-apply');
  var selectionClearBtn = document.getElementById('admin-selection-clear');
  var pagination = document.getElementById('admin-pagination');
  var pagePrevBtn = document.getElementById('admin-page-prev');
  var pageNextBtn = document.getElementById('admin-page-next');
  var pageSummary = document.getElementById('admin-page-summary');
  var toastContainer = document.getElementById('admin-toast-container');
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
  var activeTab = 'reports';
  var pageCursor = null;
  var pageNextCursor = null;
  var pageHistory = [];
  var pageHasMore = false;
  var pageTotal = 0;
  var pageLoading = false;
  var pageRequestToken = 0;
  var pageSize = 50;
  var selectedItems = {};
  var pageImages = {};
  var pageItems = [];
  var storageOrphanItems = [];
  var storageSelectedKeys = {};

  var TAB_CONFIG = {
    reports: { label: '신고 목록', types: [['all', '전체'], ['image', '이미지 신고']], statuses: [['pending', '대기'], ['dismissed', '무시 처리'], ['deleted', '삭제 처리'], ['all', '전체']], actions: [['dismiss', '신고 무시'], ['delete-image', '이미지 삭제']] },
    comments: { label: '댓글 검수', types: [['all', '전체'], ['comment', '댓글 신고']], statuses: [['pending', '대기'], ['dismissed', '무시 처리'], ['deleted', '삭제 처리'], ['all', '전체']], actions: [['dismiss', '신고 무시'], ['delete-comment', '댓글 삭제']] },
    images: { label: '전체 이미지', types: [['all', '전체'], ['screenshot', '스크린샷'], ['ai-art', 'AI 일러스트'], ['fan-art', '팬아트'], ['meme', '밈'], ['etc', '기타']], statuses: [['active', '게시 중'], ['all', '전체']], actions: [['delete-image', '이미지 삭제']] },
    unlocks: { label: '해금 신청', types: [['all', '전체']], statuses: [['pending', '대기'], ['approved', '승인'], ['rejected', '거절'], ['all', '전체']], actions: [['approve', '해금 승인'], ['reject', '거절']] },
    bans: { label: '정지 관리', types: [['all', '전체']], statuses: [['banned', '정지 중'], ['all', '전체']], actions: [['unban', '정지 해제']] },
    links: { label: '스트리머 연결', types: [['all', '전체']], statuses: [['linked', '연결됨'], ['unlinked', '미연결'], ['all', '전체']], actions: [['unlink', '연결 해제']] },
    users: { label: '사용자 검색', types: [['all', '전체']], statuses: [['all', '전체']], actions: [['lookup', '조회']] },
    audit: { label: '감사 로그', types: [['all', '전체']], statuses: [['all', '전체']], actions: [['lookup', '조회']] },
    storage: { label: 'R2 파일 점검', types: [['all', '전체']], statuses: [['all', '전체']], actions: [['lookup', '조회']] },
    stats: { label: '운영 통계', types: [['all', '전체']], statuses: [['all', '전체']], actions: [['lookup', '조회']] },
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findImage(id) {
    return (window.galAllImages || []).find(function (i) { return i.id === id; }) || pageImages[id] || null;
  }

  function showToast(message, isError, duration) {
    if (!toastContainer) return;
    var toast = document.createElement('div');
    toast.className = 'admin-toast' + (isError ? ' is-error' : '');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, duration || (isError ? 7000 : 3500));
  }

  function currentConfig() { return TAB_CONFIG[activeTab] || TAB_CONFIG.reports; }

  function optionHtml(options, selected) {
    return options.map(function (item) { return '<option value="' + escapeHtml(item[0]) + '"' + (item[0] === selected ? ' selected' : '') + '>' + escapeHtml(item[1]) + '</option>'; }).join('');
  }

  function configureFilters() {
    var config = currentConfig();
    var previousType = typeFilter && typeFilter.value;
    var previousStatus = statusFilter && statusFilter.value;
    if (typeFilter) typeFilter.innerHTML = optionHtml(config.types, config.types.some(function (i) { return i[0] === previousType; }) ? previousType : config.types[0][0]);
    if (statusFilter) statusFilter.innerHTML = optionHtml(config.statuses, config.statuses.some(function (i) { return i[0] === previousStatus; }) ? previousStatus : config.statuses[0][0]);
    if (bulkActionSelect) bulkActionSelect.innerHTML = optionHtml(config.actions, config.actions[0][0]);
  }

  function getFilters() {
    var from = fromFilter && fromFilter.value ? new Date(fromFilter.value + 'T00:00:00+09:00').getTime() : 0;
    var to = toFilter && toFilter.value ? new Date(toFilter.value + 'T23:59:59.999+09:00').getTime() : 0;
    return {
      search: adminSearch ? adminSearch.value.trim() : '',
      type: typeFilter ? typeFilter.value : 'all',
      status: statusFilter ? statusFilter.value : 'pending',
      from: from,
      to: to,
      sort: sortFilter ? sortFilter.value : 'latest',
    };
  }

  function itemKey(item) { return activeTab + ':' + item.id; }

  function clearSelection() {
    selectedItems = {};
    updateSelectionUi();
  }

  function updateSelectionUi() {
    var keys = Object.keys(selectedItems);
    if (bulkToolbar) bulkToolbar.hidden = keys.length === 0;
    if (selectedCountEl) selectedCountEl.textContent = keys.length + '개 선택';
    if (bulkApplyBtn) bulkApplyBtn.disabled = keys.length === 0 || pageLoading;
    if (selectAllCheckbox) {
      var rows = document.querySelectorAll('#admin-' + (activeTab === 'reports' ? 'reports' : activeTab) + '-panel .admin-select-checkbox');
      selectAllCheckbox.checked = rows.length > 0 && Array.from(rows).every(function (checkbox) { return checkbox.checked; });
      selectAllCheckbox.indeterminate = rows.length > 0 && !selectAllCheckbox.checked && Array.from(rows).some(function (checkbox) { return checkbox.checked; });
    }
  }

  function selectedForCurrentPage() {
    var source = activeTab === 'reports' ? latestReports : activeTab === 'comments' ? latestCommentReports : activeTab === 'images' ? pageItems : activeTab === 'unlocks' ? latestUnlockRequests : activeTab === 'bans' ? latestBans : latestVerifications;
    return source.filter(function (item) { return selectedItems[itemKey(item)]; });
  }

  function removeCurrentItem(id) {
    if (activeTab === 'reports') latestReports = latestReports.filter(function (item) { return item.id !== id; });
    else if (activeTab === 'comments') latestCommentReports = latestCommentReports.filter(function (item) { return item.id !== id; });
    else if (activeTab === 'unlocks') latestUnlockRequests = latestUnlockRequests.filter(function (item) { return item.id !== id; });
    else if (activeTab === 'bans') latestBans = latestBans.filter(function (item) { return item.id !== id; });
    else if (activeTab === 'links') latestVerifications = latestVerifications.filter(function (item) { return item.id !== id; });
    else if (activeTab === 'images') pageItems = pageItems.filter(function (item) { return item.id !== id; });
    delete selectedItems[activeTab + ':' + id];
  }

  function renderActivePanel() {
    if (activeTab === 'reports') renderReports();
    else if (activeTab === 'comments') renderCommentReports();
    else if (activeTab === 'images') renderImages();
    else if (activeTab === 'unlocks') renderUnlocks();
    else if (activeTab === 'bans') renderBans();
    else if (activeTab === 'links') renderLinks();
    updateSelectionUi();
  }

  function setUsersMode(isUsers) {
    if (filterResetBtn) filterResetBtn.hidden = !!isUsers;
    if (typeFilter && typeFilter.closest('.admin-filter-field')) typeFilter.closest('.admin-filter-field').hidden = !!isUsers;
    if (statusFilter && statusFilter.closest('.admin-filter-field')) statusFilter.closest('.admin-filter-field').hidden = !!isUsers;
    if (fromFilter && fromFilter.closest('.admin-filter-field')) fromFilter.closest('.admin-filter-field').hidden = !!isUsers;
    if (toFilter && toFilter.closest('.admin-filter-field')) toFilter.closest('.admin-filter-field').hidden = !!isUsers;
    if (sortFilter && sortFilter.closest('.admin-filter-field')) sortFilter.closest('.admin-filter-field').hidden = !!isUsers;
    if (adminSearch && adminSearch.closest('.admin-search')) adminSearch.closest('.admin-search').hidden = !!isUsers;
    if (bulkToolbar) bulkToolbar.hidden = !!isUsers || Object.keys(selectedItems).length === 0;
    if (pagination) pagination.hidden = !!isUsers || !(pageHistory.length || pageHasMore);
  }

  function setAuditMode(isAudit) {
    if (auditActionField) auditActionField.hidden = !isAudit;
    var hideQueueFilters = !!isAudit || activeTab === 'users';
    if (typeFilter && typeFilter.closest('.admin-filter-field')) typeFilter.closest('.admin-filter-field').hidden = hideQueueFilters;
    if (statusFilter && statusFilter.closest('.admin-filter-field')) statusFilter.closest('.admin-filter-field').hidden = hideQueueFilters;
  }

  function setStorageMode(isStorage) {
    if (!isStorage) return;
    if (adminSearch && adminSearch.closest('.admin-search')) adminSearch.closest('.admin-search').hidden = !!isStorage;
    if (filterResetBtn) filterResetBtn.hidden = !!isStorage;
    [typeFilter, statusFilter, fromFilter, toFilter, sortFilter].forEach(function (field) {
      if (field && field.closest('.admin-filter-field')) field.closest('.admin-filter-field').hidden = !!isStorage;
    });
    if (auditActionField) auditActionField.hidden = true;
    if (bulkToolbar) bulkToolbar.hidden = true;
    if (pagination) pagination.hidden = true;
  }

  function setStatsMode(isStats) {
    if (!isStats) return;
    if (adminSearch && adminSearch.closest('.admin-search')) adminSearch.closest('.admin-search').hidden = true;
    if (filterResetBtn) filterResetBtn.hidden = true;
    [typeFilter, statusFilter, fromFilter, toFilter, sortFilter].forEach(function (field) {
      if (field && field.closest('.admin-filter-field')) field.closest('.admin-filter-field').hidden = true;
    });
    if (auditActionField) auditActionField.hidden = true;
    if (bulkToolbar) bulkToolbar.hidden = true;
    if (pagination) pagination.hidden = true;
  }

  function formatCount(value) { return Number(value || 0).toLocaleString('ko-KR'); }

  function renderUserResults(results) {
    if (!usersResults) return;
    if (!results.length) {
      usersResults.innerHTML = '<p class="empty-msg">일치하는 사용자가 없습니다.</p>';
      return;
    }
    usersResults.innerHTML = results.map(function (user) {
      var profile = user.profile || {};
      var summary = user.summary || {};
      var ban = user.ban && user.ban.status === 'banned';
      var verification = user.verifiedStreamer ? '<span class="admin-user-badge is-verified">인증 스트리머</span>' : '<span class="admin-user-badge">일반 사용자</span>';
      var banBadge = ban ? '<span class="admin-user-badge is-banned">갤러리 정지</span>' : '';
      var avatar = profile.avatarUrl ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="" loading="lazy">' : '<span class="admin-user-avatar-placeholder">USER</span>';
      var images = (user.images || []).map(function (item) {
        return '<li><span>' + escapeHtml(item.streamerName || '이미지') + '</span><time>' + escapeHtml(formatWhen(item.createdAt)) + '</time></li>';
      }).join('');
      var comments = (user.comments || []).map(function (item) {
        return '<li><span>' + escapeHtml(item.text || '(내용 없음)') + '</span><time>' + escapeHtml(formatWhen(item.createdAt)) + '</time></li>';
      }).join('');
      var reports = [];
      (user.reports && user.reports.submitted || []).forEach(function (item) { reports.push(Object.assign({ relation: '제출' }, item)); });
      (user.reports && user.reports.received || []).forEach(function (item) { reports.push(Object.assign({ relation: '대상' }, item)); });
      var reportHtml = reports.slice(0, 10).map(function (item) {
        return '<li><span>' + escapeHtml(item.relation + ' · ' + (item.kind === 'comment' ? '댓글' : '이미지')) + '</span><small>' + escapeHtml(item.status || '대기') + ' · ' + escapeHtml(formatWhen(item.createdAt)) + '</small></li>';
      }).join('');
      return '<article class="admin-user-card">' +
        '<div class="admin-user-card-header"><div class="admin-user-avatar">' + avatar + '</div><div class="admin-user-identity"><h3>' + escapeHtml(profile.nickname || '닉네임 없음') + '</h3><p>' + escapeHtml(profile.soopId ? '@' + profile.soopId : 'SOOP ID 없음') + '</p><p class="admin-user-public-id">' + escapeHtml(user.publicId || '') + '</p></div><div class="admin-user-badges">' + verification + banBadge + '</div></div>' +
        '<div class="admin-user-summary"><span>이미지 <strong>' + formatCount(summary.imageCount) + '</strong></span><span>댓글 <strong>' + formatCount(summary.commentCount) + '</strong></span><span>좋아요 받은 수 <strong>' + formatCount(summary.totalLikes) + '</strong></span><span>좋아요 누른 수 <strong>' + formatCount(summary.likedImageCount) + '</strong></span><span>받은 신고 <strong>' + formatCount(summary.receivedReportCount) + '</strong></span><span>제출 신고 <strong>' + formatCount(summary.submittedReportCount) + '</strong></span></div>' +
        '<div class="admin-user-sections">' +
          '<section><h4>업로드 이미지 <em>' + formatCount(summary.imageCount) + '</em></h4>' + (images ? '<ul>' + images + '</ul>' : '<p>업로드 이미지가 없습니다.</p>') + '</section>' +
          '<section><h4>댓글 <em>' + formatCount(summary.commentCount) + '</em></h4>' + (comments ? '<ul>' + comments + '</ul>' : '<p>댓글이 없습니다.</p>') + '</section>' +
          '<section><h4>신고 이력 <em>' + formatCount((summary.submittedReportCount || 0) + (summary.receivedReportCount || 0)) + '</em></h4>' + (reportHtml ? '<ul>' + reportHtml + '</ul>' : '<p>신고 이력이 없습니다.</p>') + '</section>' +
        '</div>' +
        (ban ? '<p class="admin-user-ban-note">정지 사유: ' + escapeHtml(user.ban.reason || '(사유 없음)') + ' · ' + escapeHtml(formatWhen(user.ban.bannedAt)) + '</p>' : '') +
      '</article>';
    }).join('');
  }

  function renderAuditLogs() {
    if (!auditList) return;
    var items = pageItems || [];
    if (!items.length) {
      auditList.innerHTML = '<p class="empty-msg">조건에 맞는 감사 로그가 없습니다.</p>';
      return;
    }
    auditList.innerHTML = items.map(function (item) {
      return '<article class="admin-audit-row"><div class="admin-audit-row-main"><div><strong>' + escapeHtml(item.action || '기타') + '</strong><span class="admin-audit-actor">' + escapeHtml(item.actorName || '알 수 없음') + '</span></div><time>' + escapeHtml(formatWhen(item.at)) + '</time></div>' + (item.detail ? '<p>' + escapeHtml(item.detail) + '</p>' : '') + '<span class="admin-audit-id">기록 ID · ' + escapeHtml(item.id) + '</span></article>';
    }).join('');
  }

  function setAuditActionOptions(actions) {
    if (!auditActionFilter) return;
    var selected = auditActionFilter.value || 'all';
    var options = ['<option value="all">전체</option>'].concat((actions || []).map(function (action) {
      return '<option value="' + escapeHtml(action) + '">' + escapeHtml(action) + '</option>';
    }));
    auditActionFilter.innerHTML = options.join('');
    auditActionFilter.value = (actions || []).indexOf(selected) >= 0 ? selected : 'all';
  }

  async function searchUsers() {
    if (!usersSearchInput || !window.galFirebase) return;
    var query = usersSearchInput.value.trim();
    if (query.length < 2) {
      if (usersSearchStatus) usersSearchStatus.textContent = '두 글자 이상 입력해 주세요.';
      if (usersResults) usersResults.innerHTML = '<p class="empty-msg">검색어를 입력하면 사용자 활동 요약이 표시됩니다.</p>';
      return;
    }
    if (usersSearchBtn) usersSearchBtn.disabled = true;
    if (usersSearchStatus) usersSearchStatus.textContent = '서버에서 검색 중...';
    if (usersResults) usersResults.innerHTML = '<p class="empty-msg">사용자 활동을 확인하는 중...</p>';
    try {
      var fn = window.galFirebase.httpsCallable('gallerySearchUsers');
      var result = await fn({ query: query, limit: 20 });
      var data = result.data || {};
      renderUserResults(data.results || []);
      if (usersSearchStatus) usersSearchStatus.textContent = (Number(data.total) || 0) + '명 검색됨 · 원본 UID는 표시하지 않습니다.';
    } catch (e) {
      if (usersResults) usersResults.innerHTML = '<p class="empty-msg">사용자 검색에 실패했어요. 다시 시도해 주세요.</p>';
      if (usersSearchStatus) usersSearchStatus.textContent = '검색 중 오류가 발생했습니다.';
      showToast('사용자 검색 실패: ' + (e && e.message ? e.message : e), true);
    } finally {
      if (usersSearchBtn) usersSearchBtn.disabled = false;
    }
  }

  async function loadAuditPage(options) {
    options = options || {};
    if (!window.galFirebase || activeTab !== 'audit') return;
    var token = ++pageRequestToken;
    pageLoading = true;
    updateSelectionUi();
    if (currentSectionEl) currentSectionEl.textContent = TAB_CONFIG.audit.label;
    if (options.showLoading !== false && auditList) auditList.innerHTML = '<p class="empty-msg">감사 로그를 불러오는 중...</p>';
    try {
      var fn = window.galFirebase.httpsCallable('galleryGetAuditLog');
      var filters = getFilters();
      var result = await fn({
        search: filters.search,
        from: filters.from,
        to: filters.to,
        sort: filters.sort,
        action: auditActionFilter ? auditActionFilter.value : 'all',
        cursor: pageCursor,
        pageSize: pageSize,
      });
      if (token !== pageRequestToken) return;
      var data = result.data || {};
      setAuditActionOptions(data.actions || []);
      setPageItems(data.items || []);
      pageTotal = Number(data.total) || 0;
      pageHasMore = !!data.hasMore;
      pageNextCursor = data.nextCursor || null;
      renderAuditLogs();
      if (resultSummary) resultSummary.textContent = pageTotal ? pageTotal + '개 중 ' + (data.items || []).length + '개 표시' : '';
      updatePaginationUi();
    } catch (e) {
      if (token !== pageRequestToken) return;
      if (auditList) auditList.innerHTML = '<p class="empty-msg">감사 로그를 불러오지 못했어요. 새로고침해 주세요.</p>';
      showToast('감사 로그 조회 실패: ' + (e && e.message ? e.message : e), true);
    } finally {
      if (token === pageRequestToken) {
        pageLoading = false;
        updateSelectionUi();
      }
    }
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function updateStorageSelectionUi() {
    var selected = Object.keys(storageSelectedKeys);
    if (storageDeleteBtn) storageDeleteBtn.disabled = selected.length === 0;
    if (storageSelectAll) {
      storageSelectAll.checked = storageOrphanItems.length > 0 && selected.length === storageOrphanItems.length;
      storageSelectAll.indeterminate = selected.length > 0 && selected.length < storageOrphanItems.length;
    }
  }

  function renderStorageScan(data) {
    var totals = data.totals || {};
    storageOrphanItems = data.orphanObjects || [];
    storageSelectedKeys = {};
    if (storageSummary) {
      storageSummary.innerHTML = '<span>R2 파일 <strong>' + formatCount(totals.r2Objects) + '</strong></span>' +
        '<span>참조된 파일 <strong>' + formatCount(totals.referencedObjects) + '</strong></span>' +
        '<span>고아 후보 <strong class="is-warning">' + formatCount(totals.orphanObjects) + '</strong></span>' +
        '<span>등록 중 오류 <strong class="is-warning">' + formatCount(totals.registerFailureObjects) + '</strong></span>' +
        '<span>삭제 중 오류 <strong class="is-warning">' + formatCount(totals.deleteFailureObjects) + '</strong></span>' +
        '<span>원인 미확인 <strong>' + formatCount(totals.unknownObjects) + '</strong></span>' +
        '<span>고아 용량 <strong>' + escapeHtml(formatBytes(totals.orphanBytes)) + '</strong></span>' +
        '<span>메타데이터 누락 <strong class="is-warning">' + formatCount(totals.missingReferences) + '</strong></span>';
    }
    if (storageStatus) {
      var status = data.scanTruncated ? 'R2 오브젝트가 10,000개를 넘어 전체 점검이 완료되지 않았습니다.' : '점검 완료 · ' + escapeHtml(formatWhen(data.scannedAt));
      if (Number(totals.orphanObjects) > storageOrphanItems.length) status += ' 고아 후보는 화면에 최대 1,000건까지 표시됩니다.';
      storageStatus.textContent = status;
    }
    if (storageOrphans) {
      storageOrphans.innerHTML = storageOrphanItems.length ? storageOrphanItems.map(function (item) {
        var classification = item.classification === 'register_failed' ? '등록 중 오류' : item.classification === 'delete_failed' ? '삭제 중 오류' : '원인 미확인';
        var badgeClass = item.classification === 'unknown' ? '' : ' is-warning';
        return '<label class="admin-storage-row"><input class="admin-storage-checkbox" type="checkbox" data-storage-key="' + escapeHtml(item.key) + '"><span class="admin-storage-key">' + escapeHtml(item.key) + '<em class="admin-storage-classification' + badgeClass + '">' + escapeHtml(classification) + '</em></span><span class="admin-storage-size">' + escapeHtml(formatBytes(item.size)) + '</span><time>' + escapeHtml(formatWhen(item.lastModified)) + '</time></label>';
      }).join('') : '<p class="empty-msg">현재 고아 파일 후보가 없습니다.</p>';
    }
    if (storageMissing) {
      var missing = data.missingReferences || [];
      storageMissing.innerHTML = missing.length ? missing.map(function (item) {
        return '<div class="admin-storage-missing-row"><code>' + escapeHtml(item.key) + '</code><span>R2에서 파일을 찾지 못했습니다.</span></div>';
      }).join('') : '<p class="empty-msg">메타데이터와 R2 파일이 모두 일치합니다.</p>';
    }
    updateStorageSelectionUi();
  }

  async function loadStorageScan(options) {
    options = options || {};
    if (!window.galFirebase || activeTab !== 'storage') return;
    if (storageScanBtn) storageScanBtn.disabled = true;
    if (storageDeleteBtn) storageDeleteBtn.disabled = true;
    if (storageStatus) storageStatus.textContent = 'R2와 RTDB 메타데이터를 대조하는 중...';
    if (options.showLoading !== false && storageOrphans) storageOrphans.innerHTML = '<p class="empty-msg">R2 오브젝트를 확인하는 중...</p>';
    try {
      var fn = window.galFirebase.httpsCallable('galleryScanR2');
      var result = await fn({});
      renderStorageScan(result.data || {});
    } catch (e) {
      if (storageStatus) storageStatus.textContent = '점검에 실패했습니다.';
      if (storageOrphans) storageOrphans.innerHTML = '<p class="empty-msg">R2 점검에 실패했어요. 다시 시도해 주세요.</p>';
      showToast('R2 점검 실패: ' + (e && e.message ? e.message : e), true);
    } finally {
      if (storageScanBtn) storageScanBtn.disabled = false;
      updateStorageSelectionUi();
    }
  }

  async function deleteSelectedStorageObjects() {
    var keys = Object.keys(storageSelectedKeys);
    if (!keys.length) return;
    if (!confirm(keys.length + '개 고아 파일을 R2에서 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
    if (storageDeleteBtn) storageDeleteBtn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('galleryDeleteR2Orphans');
      var result = await fn({ keys: keys });
      var data = result.data || {};
      window.galSound && window.galSound.adminAction();
      showToast('✅ ' + (data.deletedKeys || []).length + '개 파일을 삭제했습니다.' + ((data.skippedKeys || []).length ? ' 사용 중인 파일은 건너뛰었습니다.' : ''));
      await loadStorageScan({ showLoading: false });
    } catch (e) {
      window.galSound && window.galSound.error(e);
      showToast('R2 파일 삭제 실패: ' + (e && e.message ? e.message : e), true);
      updateStorageSelectionUi();
    }
  }

  function statsMetricCard(label, value, note, warning) {
    return '<div class="admin-stats-metric' + (warning ? ' is-warning' : '') + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(formatCount(value)) + '</strong><small>' + escapeHtml(note || '') + '</small></div>';
  }

  function renderOperationsStats(data) {
    var totals = data.totals || {};
    var period = data.period || {};
    if (statsTotals) {
      statsTotals.innerHTML =
        statsMetricCard('전체 이미지', totals.images, '현재 게시 중') +
        statsMetricCard('전체 댓글', totals.comments, '현재 등록') +
        statsMetricCard('누적 조회수', totals.views, '계정별 24시간 중복 제한') +
        statsMetricCard('누적 좋아요', totals.likes, '이미지 합계') +
        statsMetricCard('기간 업로드', totals.periodUploads, '선택 기간') +
        statsMetricCard('기간 활동 사용자', totals.activeUsers, '업로드·댓글 기준') +
        statsMetricCard('대기 신고', totals.pendingReports, '즉시 확인 필요', Number(totals.pendingReports) > 0) +
        statsMetricCard('대기 해금 신청', totals.pendingUnlocks, '처리 대기', Number(totals.pendingUnlocks) > 0) +
        statsMetricCard('갤러리 정지 계정', totals.bannedGalleryAccounts, '현재 정지 중');
    }
    var series = data.timeseries || [];
    if (statsTimeseries) {
      if (!series.length) {
        statsTimeseries.innerHTML = '<p class="empty-msg">표시할 활동 데이터가 없습니다.</p>';
      } else {
        var metricDefs = [
          { key: 'uploads', label: '업로드', className: 'is-upload' },
          { key: 'comments', label: '댓글', className: 'is-comment' },
          { key: 'reports', label: '신고', className: 'is-report' },
          { key: 'verifiedVisits', label: '인증 방문', className: 'is-visit' },
        ];
        var maxValue = Math.max(1, ...series.flatMap(function (item) { return metricDefs.map(function (metric) { return Number(item[metric.key]) || 0; }); }));
        var legend = metricDefs.map(function (metric) { return '<span><i class="' + metric.className + '"></i>' + metric.label + '</span>'; }).join('');
        var columns = series.map(function (item) {
          var dayLabel = String(item.date || '').slice(5).replace('-', '.');
          var bars = metricDefs.map(function (metric) {
            var value = Number(item[metric.key]) || 0;
            var height = value ? Math.max(4, Math.round(value / maxValue * 100)) : 0;
            return '<span class="admin-stats-chart-bar ' + metric.className + '" style="height:' + height + '%" title="' + escapeHtml(metric.label + ' ' + value + '건') + '"></span>';
          }).join('');
          return '<div class="admin-stats-chart-col"><div class="admin-stats-chart-bars">' + bars + '</div><small>' + escapeHtml(dayLabel) + '</small></div>';
        }).join('');
        statsTimeseries.innerHTML = '<div class="admin-stats-chart-legend">' + legend + '</div><div class="admin-stats-chart-scroll"><div class="admin-stats-chart-grid">' + columns + '</div></div>';
      }
    }
    if (statsCategories) {
      var categories = data.categories || [];
      var categoryLabels = { screenshot: '스크린샷', 'ai-art': 'AI 일러스트', 'fan-art': '팬아트', meme: '밈', etc: '기타' };
      if (!categories.length) statsCategories.innerHTML = '<p class="empty-msg">등록된 이미지가 없습니다.</p>';
      else {
        var categoryMax = Math.max(1, ...categories.map(function (item) { return Number(item.count) || 0; }));
        statsCategories.innerHTML = categories.map(function (item) {
          var count = Number(item.count) || 0;
          return '<div class="admin-stats-bar-row"><span>' + escapeHtml(categoryLabels[item.category] || item.category || '기타') + '</span><div><i style="width:' + Math.round(count / categoryMax * 100) + '%"></i></div><strong>' + escapeHtml(formatCount(count)) + '</strong></div>';
        }).join('');
      }
    }
    if (statsStreamers) {
      var streamers = data.topStreamers || [];
      statsStreamers.innerHTML = streamers.length ? '<div class="admin-stats-table"><div class="admin-stats-table-head"><span>스트리머</span><span>이미지</span><span>조회</span><span>좋아요</span></div>' + streamers.map(function (item) {
        return '<div class="admin-stats-table-row"><span>' + escapeHtml(item.name || '미지정') + '</span><strong>' + escapeHtml(formatCount(item.images)) + '</strong><strong>' + escapeHtml(formatCount(item.views)) + '</strong><strong>' + escapeHtml(formatCount(item.likes)) + '</strong></div>';
      }).join('') + '</div>' : '<p class="empty-msg">등록된 이미지가 없습니다.</p>';
    }
    if (statsModeration) {
      var reports = data.reports || {};
      var moderationItems = [
        ['대기 신고', totals.pendingReports, 'is-warning'],
        ['처리 완료 신고', (Number(reports.dismissed) || 0) + (Number(reports.deleted) || 0), ''],
        ['인증 스트리머', totals.verifiedStreamers, ''],
        ['인증 스트리머 방문', totals.verifiedVisits, (Number(totals.verifiedVisits) ? '' : '')],
        ['관리자 처리 기록', totals.moderationActions, ''],
        ['R2 등록 오류', totals.r2RegisterFailures, Number(totals.r2RegisterFailures) ? 'is-warning' : ''],
        ['R2 등록 미완료', totals.r2RegisterPending, Number(totals.r2RegisterPending) ? 'is-warning' : ''],
        ['R2 삭제 오류', totals.r2DeleteFailures, Number(totals.r2DeleteFailures) ? 'is-warning' : ''],
        ['R2 삭제 진행 중', totals.r2DeletePending, Number(totals.r2DeletePending) ? 'is-warning' : ''],
      ];
      statsModeration.innerHTML = moderationItems.map(function (item) {
        return '<div class="admin-stats-status-row"><span>' + escapeHtml(item[0]) + '</span><strong class="' + item[2] + '">' + escapeHtml(formatCount(item[1])) + '</strong></div>';
      }).join('') + '<p class="admin-stats-note">최근 이미지 ' + escapeHtml(formatWhen(totals.latestImageAt)) + '<br>최근 댓글 ' + escapeHtml(formatWhen(totals.latestCommentAt)) + '<br>집계 범위: 최근 ' + escapeHtml(String(period.days || 30)) + '일</p>';
    }
  }

  async function loadOperationsStats(options) {
    options = options || {};
    if (!window.galFirebase || activeTab !== 'stats') return;
    if (statsRefreshBtn) statsRefreshBtn.disabled = true;
    if (statsStatus) statsStatus.textContent = '운영 데이터를 집계하는 중...';
    if (options.showLoading !== false && statsTimeseries) statsTimeseries.innerHTML = '<p class="empty-msg">통계를 불러오는 중...</p>';
    try {
      var fn = window.galFirebase.httpsCallable('galleryGetOperationsStats');
      var result = await fn({ days: Number(statsDaysSelect && statsDaysSelect.value) || 30 });
      renderOperationsStats(result.data || {});
      if (statsStatus) statsStatus.textContent = '집계 완료 · ' + formatWhen((result.data || {}).generatedAt);
    } catch (e) {
      if (statsStatus) statsStatus.textContent = '통계를 불러오지 못했습니다.';
      if (statsTimeseries) statsTimeseries.innerHTML = '<p class="empty-msg">운영 통계 조회에 실패했어요. 다시 시도해 주세요.</p>';
      showToast('운영 통계 조회 실패: ' + (e && e.message ? e.message : e), true);
    } finally {
      if (statsRefreshBtn) statsRefreshBtn.disabled = false;
    }
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
    var ban = authorUid && (latestBans.find(function (b) { return b.uid === authorUid; }) || report.ban);
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
    var actions = report.status === 'pending'
      ? '<div class="admin-detail-actions">' +
        (canBan ? '<button class="text-link admin-detail-action" type="button" data-detail-action="ban" data-uid="' + escapeHtml(authorUid) + '">작성자 정지</button>' : '') +
        '<button class="text-link admin-detail-action" type="button" data-detail-action="dismiss" data-report-id="' + escapeHtml(report.id) + '">' + (kind === 'comment' ? '댓글 신고 무시' : '이미지 신고 무시') + '</button>' +
        (kind === 'comment'
          ? '<button class="text-link admin-detail-action admin-detail-danger" type="button" data-detail-action="delete-comment" data-image-id="' + escapeHtml(report.imageId) + '" data-comment-id="' + escapeHtml(report.commentId) + '">댓글 삭제</button>'
          : (image ? '<button class="text-link admin-detail-action admin-detail-danger" type="button" data-detail-action="delete-image" data-image-id="' + escapeHtml(report.imageId) + '">이미지 삭제</button>' : '')) +
        '</div>'
      : '<p class="admin-detail-status is-clear">이미 처리된 항목입니다.</p>';

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
    selectedDetail = { kind: kind, reportId: report.id, report: report, image: findImage(report.imageId) || report.image || null };
    var token = ++detailLoadToken;
    if (contentGrid) contentGrid.classList.add('admin-detail-open');
    if (detailContent) detailContent.innerHTML = '<span class="admin-detail-kicker">DETAIL</span><h2>불러오는 중...</h2><p>신고 대상 정보를 확인하고 있어요.</p>';
    // 원본 gallery/images는 관리자 SDK 전용으로 전환됐다. getGalleryAdminPage가
    // 함께 내려준 image 스냅샷만 사용해 브라우저에서 UID 경로를 직접 읽지 않는다.
    if (token !== detailLoadToken || !selectedDetail) return;
    renderDetailPanel();
  }

  function filterCurrentPanel() {
    var panels = [reportsPanel, commentsPanel, imagesPanel, unlocksPanel, bansPanel, linksPanel];
    var activePanel = panels.find(function (panel) { return panel && panel.style.display !== 'none'; });
    if (!activePanel) return;
    var rows = Array.from(activePanel.querySelectorAll('.admin-row'));
    rows.forEach(function (row) {
      row.style.display = '';
    });
    if (resultSummary) {
      resultSummary.textContent = rows.length
        ? ((pageTotal || rows.length) + '개 중 ' + rows.length + '개 표시')
        : '';
    }
  }

  function setPageItems(items) {
    pageItems = items || [];
    if (activeTab === 'reports') latestReports = pageItems;
    else if (activeTab === 'comments') latestCommentReports = pageItems;
    else if (activeTab === 'unlocks') latestUnlockRequests = pageItems;
    else if (activeTab === 'bans') latestBans = pageItems;
    else if (activeTab === 'links') latestVerifications = pageItems;
    pageItems.forEach(function (item) {
      if (item.image) pageImages[item.image.id] = item.image;
      if (activeTab === 'images') pageImages[item.id] = item;
    });
  }

  async function loadAdminPage(options) {
    options = options || {};
    if (!window.galFirebase) return;
    if (activeTab === 'storage') {
      loadStorageScan(options);
      return;
    }
    if (activeTab === 'audit') {
      loadAuditPage(options);
      return;
    }
    if (activeTab === 'users') {
      setUsersMode(true);
      if (currentSectionEl) currentSectionEl.textContent = TAB_CONFIG.users.label;
      updatePaginationUi();
      return;
    }
    if (activeTab === 'stats') {
      setStatsMode(true);
      if (currentSectionEl) currentSectionEl.textContent = TAB_CONFIG.stats.label;
      loadOperationsStats(options);
      return;
    }
    var token = ++pageRequestToken;
    pageLoading = true;
    updateSelectionUi();
    if (currentSectionEl) currentSectionEl.textContent = currentConfig().label;
    if (options.showLoading !== false) {
      var activePanel = document.getElementById('admin-' + activeTab + '-panel');
      if (activePanel) activePanel.innerHTML = '<p class="empty-msg">목록을 불러오는 중...</p>';
    }
    try {
      var fn = window.galFirebase.httpsCallable('getGalleryAdminPage');
      var result = await fn(Object.assign({ kind: activeTab, cursor: pageCursor, pageSize: pageSize }, getFilters()));
      if (token !== pageRequestToken) return;
      var data = result.data || {};
      pageImages = {};
      setPageItems(data.items || []);
      pageTotal = Number(data.total) || 0;
      pageHasMore = !!data.hasMore;
      pageNextCursor = data.nextCursor || null;
      renderActivePanel();
      updatePaginationUi();
    } catch (e) {
      if (token !== pageRequestToken) return;
      var failedPanel = document.getElementById('admin-' + activeTab + '-panel');
      if (failedPanel) failedPanel.innerHTML = '<p class="empty-msg">목록을 불러오지 못했어요. 새로고침해 주세요.</p>';
      showToast('목록을 불러오지 못했어요: ' + (e && e.message ? e.message : e), true);
    } finally {
      if (token === pageRequestToken) {
        pageLoading = false;
        updateSelectionUi();
      }
    }
  }

  function updatePaginationUi() {
    var hasPrevious = pageHistory.length > 0;
    if (pagination) pagination.hidden = !(hasPrevious || pageHasMore);
    if (pagePrevBtn) pagePrevBtn.disabled = !hasPrevious || pageLoading;
    if (pageNextBtn) pageNextBtn.disabled = !pageHasMore || pageLoading;
    if (pageSummary) {
      var pageNumber = pageHistory.length + 1;
      pageSummary.textContent = pageTotal ? pageNumber + '페이지 · 전체 ' + pageTotal + '건' : '표시할 항목이 없어요';
    }
  }

  function resetPageAndLoad() {
    pageCursor = null;
    pageNextCursor = null;
    pageHistory = [];
    clearSelection();
    setUsersMode(activeTab === 'users');
    setAuditMode(activeTab === 'audit');
    setStorageMode(activeTab === 'storage');
    setStatsMode(activeTab === 'stats');
    loadAdminPage();
  }

  function statusBadge(status) {
    var labels = { pending: '대기', dismissed: '무시 처리', deleted: '삭제 처리', approved: '승인', rejected: '거절', active: '게시 중', banned: '정지 중', linked: '연결됨', unlinked: '미연결' };
    var label = labels[status] || status || '대기';
    var complete = ['dismissed', 'deleted', 'approved', 'rejected', 'unlinked'].includes(status);
    return '<span class="admin-status-badge ' + (complete ? 'is-complete' : 'is-pending') + '">' + escapeHtml(label) + '</span>';
  }

  function rowCheckbox(item) {
    return '<label class="admin-row-check"><input class="admin-select-checkbox" type="checkbox" data-select-id="' + escapeHtml(item.id) + '"' + (selectedItems[itemKey(item)] ? ' checked' : '') + ' aria-label="항목 선택"></label>';
  }

  function renderReports() {
    latestReports = latestReports.filter(function (r) { return !(window.galPendingImageDeletes && window.galPendingImageDeletes[r.imageId]); });
    if (selectedDetail && selectedDetail.kind === 'image' && !latestReports.some(function (r) { return r.id === selectedDetail.reportId; })) clearDetail();
    if (reportsCountEl) {
      reportsCountEl.textContent = (activeTab === 'reports' ? pageTotal : latestReports.length) > 99 ? '99+' : String(activeTab === 'reports' ? pageTotal : latestReports.length);
      reportsCountEl.hidden = (activeTab === 'reports' ? pageTotal : latestReports.length) === 0;
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
          rowCheckbox(r) +
          '<div class="admin-row-thumb' + (img ? ' clickable' : '') + '" title="' + (img ? '클릭하면 풀이미지로 열어요' : '') + '">' + thumb + '</div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml((img && img.streamerName) || r.streamerName || '(삭제된 이미지)') + ' · ' + when + statusBadge(r.status) + '</div>' +
            '<div class="admin-row-reason">' + (escapeHtml(r.reason) || '(사유 없음)') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (r.status === 'pending' ? banBtn +
              '<button class="text-link admin-dismiss-btn" type="button">신고 무시</button>' +
              '<button class="text-link admin-delete-btn" type="button">이미지 삭제</button>' : '') +
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
      commentsCountEl.textContent = (activeTab === 'comments' ? pageTotal : latestCommentReports.length) > 99 ? '99+' : String(activeTab === 'comments' ? pageTotal : latestCommentReports.length);
      commentsCountEl.hidden = (activeTab === 'comments' ? pageTotal : latestCommentReports.length) === 0;
    }
    if (!latestCommentReports.length) { commentsPanel.innerHTML = '<p class="empty-msg">접수된 댓글 신고가 없어요.</p>'; filterCurrentPanel(); return; }
    commentsPanel.innerHTML = latestCommentReports.map(function (r) {
      var img = findImage(r.imageId);
      var when = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '';
      var author = escapeHtml(r.commentAuthorUid || '(알 수 없음)');
      return (
        '<div class="admin-row admin-row-selectable admin-comment-report-row' + (selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.reportId === r.id ? ' is-selected' : '') + '" data-report-id="' + escapeHtml(r.id) + '" data-image-id="' + escapeHtml(r.imageId) + '" data-comment-id="' + escapeHtml(r.commentId) + '">' +
          rowCheckbox(r) +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">댓글 신고 · ' + escapeHtml((img && img.streamerName) || r.streamerName || r.imageId || '(이미지 없음)') + ' · ' + when + statusBadge(r.status) + '</div>' +
            '<div class="admin-row-reason"><strong>댓글:</strong> ' + (escapeHtml(r.commentText) || '(내용 없음)') + '</div>' +
            '<div class="admin-row-reason"><strong>작성자:</strong> ' + author + ' · <strong>신고자:</strong> ' + escapeHtml(r.reporterUid || '(알 수 없음)') + '</div>' +
            '<div class="admin-row-reason"><strong>사유:</strong> ' + (escapeHtml(r.reason) || '(사유 없음)') + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (r.status === 'pending' ? (r.commentAuthorUid && r.commentAuthorUid !== (window.galUser && window.galUser.uid) ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + author + '">작성자 정지</button>' : '') +
              '<button class="text-link admin-dismiss-comment-btn" type="button">신고 무시</button>' +
              '<button class="text-link admin-delete-comment-btn" type="button">댓글 삭제</button>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
    filterCurrentPanel();
    if (selectedDetail && selectedDetail.kind === 'comment') renderDetailPanel();
  }

  function renderImages() {
    var images = pageItems;
    var labels = window.galCategoryLabels || {};
    if (!images.length) { imagesPanel.innerHTML = '<p class="empty-msg">이미지가 없어요.</p>'; filterCurrentPanel(); return; }
    imagesPanel.innerHTML = images.map(function (img) {
      return (
        '<div class="admin-row" data-image-id="' + escapeHtml(img.id) + '">' +
          rowCheckbox(img) +
          '<div class="admin-row-thumb clickable" title="클릭하면 풀이미지로 열어요"><img src="' + escapeHtml(img.thumbUrl) + '" alt=""></div>' +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(img.streamerName || '익명') + ' · ' + escapeHtml(labels[img.category] || img.category || '') + statusBadge(img.status) + '</div>' +
            '<div class="admin-row-reason">조회 ' + (img.viewCount || 0) + ' · ♥ ' + (img.likeCount || 0) + ' · 💬 ' + (img.commentCount || 0) + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (img.status === 'active' ? (img.uploaderUid && img.uploaderUid !== (window.galUser && window.galUser.uid) ? '<button class="text-link admin-ban-btn" type="button" data-uid="' + escapeHtml(img.uploaderUid) + '">업로더 정지</button>' : '') +
              '<button class="text-link admin-delete-btn" type="button">삭제</button>' : '') +
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
          rowCheckbox(Object.assign({ id: b.uid }, b)) +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(b.uid) + ' · ' + when + statusBadge(b.status) + '</div>' +
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
      var link = v.link || latestAccountLinks[v.uid];
      var statusText = link
        ? ('✅ 연결됨: ' + escapeHtml(link.streamerName))
        : '⚠️ 미연결(이름 자동 대조만 적용)';
      return (
        '<div class="admin-row" data-uid="' + escapeHtml(v.uid) + '" style="flex-direction:column; align-items:stretch;">' +
          rowCheckbox(Object.assign({ id: v.uid }, v)) +
          '<div style="display:flex; align-items:center; gap:12px;">' +
            '<div class="admin-row-body">' +
              '<div class="admin-row-meta">' + escapeHtml(v.nickname) + ' · ' + escapeHtml(v.soopId) + statusBadge(v.status) + '</div>' +
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
      unlocksCountEl.textContent = (activeTab === 'unlocks' ? pageTotal : pending.length) > 99 ? '99+' : String(activeTab === 'unlocks' ? pageTotal : pending.length);
      unlocksCountEl.hidden = (activeTab === 'unlocks' ? pageTotal : pending.length) === 0;
    }
    if (!latestUnlockRequests.length) { unlocksPanel.innerHTML = '<p class="empty-msg">조건에 맞는 해금 신청이 없어요.</p>'; filterCurrentPanel(); return; }
    unlocksPanel.innerHTML = latestUnlockRequests.map(function (r) {
      var when = r.requestedAt ? new Date(r.requestedAt).toLocaleString('ko-KR') : '';
      return (
        '<div class="admin-row" data-request-id="' + escapeHtml(r.id) + '">' +
          rowCheckbox(r) +
          '<div class="admin-row-body">' +
            '<div class="admin-row-meta">' + escapeHtml(r.streamerName) + ' · ' + when + statusBadge(r.status) + '</div>' +
            '<div class="admin-row-reason">후원자 닉네임: ' + escapeHtml(r.nickname) + '</div>' +
          '</div>' +
          '<div class="admin-row-actions">' +
            (r.status === 'pending' ? '<button class="text-link admin-reject-unlock-btn" type="button">거절</button>' +
              '<button class="text-link admin-approve-unlock-btn" type="button">해금 승인</button>' : '') +
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
    if (e.detail.isAdmin && backdrop.classList.contains('open')) loadAdminPage();
  });
  document.addEventListener('gal-images-updated', function () {
    if (backdrop.classList.contains('open') && activeTab === 'images') loadAdminPage({ showLoading: false });
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
    activeTab = 'reports';
    tabsWrap.querySelectorAll('.admin-nav-item').forEach(function (item) { item.classList.toggle('active', item.dataset.adminTab === 'reports'); });
    [reportsPanel, commentsPanel, imagesPanel, unlocksPanel, bansPanel, linksPanel, usersPanel, auditPanel, storagePanel, statsPanel].forEach(function (panel) { if (panel) panel.style.display = panel === reportsPanel ? '' : 'none'; });
    if (adminSearch) adminSearch.value = '';
    if (fromFilter) fromFilter.value = '';
    if (toFilter) toFilter.value = '';
    if (usersSearchInput) usersSearchInput.value = '';
    if (usersSearchStatus) usersSearchStatus.textContent = '';
    if (usersResults) usersResults.innerHTML = '<p class="empty-msg">검색어를 입력하면 사용자 활동 요약이 표시됩니다.</p>';
    if (auditActionFilter) auditActionFilter.value = 'all';
    if (auditList) auditList.innerHTML = '<p class="empty-msg">감사 로그를 불러오는 중...</p>';
    storageOrphanItems = [];
    storageSelectedKeys = {};
    if (storageSummary) storageSummary.innerHTML = '';
    if (storageStatus) storageStatus.textContent = '';
    if (storageOrphans) storageOrphans.innerHTML = '<p class="empty-msg">R2 점검을 실행하면 고아 후보가 표시됩니다.</p>';
    if (storageMissing) storageMissing.innerHTML = '<p class="empty-msg">R2 점검을 실행하면 누락 파일이 표시됩니다.</p>';
    configureFilters();
    resetPageAndLoad();
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
    activeTab = tab;
    reportsPanel.style.display = tab === 'reports' ? '' : 'none';
    commentsPanel.style.display = tab === 'comments' ? '' : 'none';
    imagesPanel.style.display = tab === 'images' ? '' : 'none';
    unlocksPanel.style.display = tab === 'unlocks' ? '' : 'none';
    bansPanel.style.display = tab === 'bans' ? '' : 'none';
    linksPanel.style.display = tab === 'links' ? '' : 'none';
    usersPanel.style.display = tab === 'users' ? '' : 'none';
    auditPanel.style.display = tab === 'audit' ? '' : 'none';
    storagePanel.style.display = tab === 'storage' ? '' : 'none';
    statsPanel.style.display = tab === 'stats' ? '' : 'none';
    var names = { reports: '신고 목록', comments: '댓글 검수', images: '전체 이미지', unlocks: '해금 신청', bans: '정지 관리', links: '스트리머 연결', users: '사용자 검색', audit: '감사 로그', storage: 'R2 파일 점검', stats: '운영 통계' };
    if (currentSectionEl) currentSectionEl.textContent = names[tab] || '관리자';
    configureFilters();
    setUsersMode(tab === 'users');
    setAuditMode(tab === 'audit');
    setStorageMode(tab === 'storage');
    setStatsMode(tab === 'stats');
    resetPageAndLoad();
    if (adminSidebar) adminSidebar.classList.remove('open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
  });

  var filterLoadTimer = null;
  function scheduleFilteredLoad() {
    clearTimeout(filterLoadTimer);
    filterLoadTimer = setTimeout(resetPageAndLoad, 250);
  }
  if (adminSearch) adminSearch.addEventListener('input', scheduleFilteredLoad);
  if (usersSearchBtn) usersSearchBtn.addEventListener('click', searchUsers);
  if (usersSearchInput) usersSearchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); searchUsers(); }
  });
  [typeFilter, statusFilter, fromFilter, toFilter, sortFilter].forEach(function (field) {
    if (field) field.addEventListener('change', resetPageAndLoad);
  });
  if (auditActionFilter) auditActionFilter.addEventListener('change', resetPageAndLoad);
  if (storageScanBtn) storageScanBtn.addEventListener('click', function () { loadStorageScan(); });
  if (storageDeleteBtn) storageDeleteBtn.addEventListener('click', deleteSelectedStorageObjects);
  if (statsRefreshBtn) statsRefreshBtn.addEventListener('click', function () { loadOperationsStats(); });
  if (statsDaysSelect) statsDaysSelect.addEventListener('change', function () { loadOperationsStats(); });
  if (storageSelectAll) storageSelectAll.addEventListener('change', function () {
    storageOrphanItems.forEach(function (item) {
      if (storageSelectAll.checked) storageSelectedKeys[item.key] = true;
      else delete storageSelectedKeys[item.key];
    });
    document.querySelectorAll('.admin-storage-checkbox').forEach(function (checkbox) { checkbox.checked = storageSelectAll.checked; });
    updateStorageSelectionUi();
  });
  if (filterResetBtn) filterResetBtn.addEventListener('click', function () {
    if (adminSearch) adminSearch.value = '';
    if (fromFilter) fromFilter.value = '';
    if (toFilter) toFilter.value = '';
    if (sortFilter) sortFilter.value = 'latest';
    if (auditActionFilter) auditActionFilter.value = 'all';
    configureFilters();
    resetPageAndLoad();
  });
  if (pageNextBtn) pageNextBtn.addEventListener('click', function () {
    if (!pageHasMore || pageLoading || !pageNextCursor) return;
    pageHistory.push(pageCursor);
    pageCursor = pageNextCursor;
    clearSelection();
    if (activeTab === 'audit') loadAuditPage();
    else loadAdminPage();
  });
  if (pagePrevBtn) pagePrevBtn.addEventListener('click', function () {
    if (!pageHistory.length || pageLoading) return;
    pageCursor = pageHistory.pop();
    clearSelection();
    if (activeTab === 'audit') loadAuditPage();
    else loadAdminPage();
  });
  document.addEventListener('click', function (e) {
    var storageCheckbox = e.target.closest && e.target.closest('.admin-storage-checkbox');
    if (storageCheckbox) {
      var storageKey = storageCheckbox.dataset.storageKey;
      if (storageCheckbox.checked) storageSelectedKeys[storageKey] = true;
      else delete storageSelectedKeys[storageKey];
      updateStorageSelectionUi();
      return;
    }
    var checkbox = e.target.closest && e.target.closest('.admin-select-checkbox');
    if (!checkbox) return;
    e.stopPropagation();
    var id = checkbox.dataset.selectId;
    var key = activeTab + ':' + id;
    if (checkbox.checked) selectedItems[key] = true;
    else delete selectedItems[key];
    updateSelectionUi();
  }, true);
  if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', function () {
    var source = activeTab === 'reports' ? latestReports : activeTab === 'comments' ? latestCommentReports : activeTab === 'images' ? pageItems : activeTab === 'unlocks' ? latestUnlockRequests : activeTab === 'bans' ? latestBans : latestVerifications;
    source.forEach(function (item) {
      if (selectAllCheckbox.checked) selectedItems[itemKey(item)] = true;
      else delete selectedItems[itemKey(item)];
    });
    renderActivePanel();
  });
  if (selectionClearBtn) selectionClearBtn.addEventListener('click', clearSelection);
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', function () {
    var isOpen = adminSidebar && adminSidebar.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  if (bulkApplyBtn) bulkApplyBtn.addEventListener('click', async function () {
    var selected = selectedForCurrentPage();
    if (!selected.length || pageLoading) return;
    var action = bulkActionSelect && bulkActionSelect.value;
    var actionLabel = bulkActionSelect && bulkActionSelect.options[bulkActionSelect.selectedIndex] ? bulkActionSelect.options[bulkActionSelect.selectedIndex].textContent : '처리';
    if (!confirm(selected.length + '개 항목을 ' + actionLabel + '할까요?')) return;

    var payloadItems = [];
    var uniqueActionIds = {};
    selected.forEach(function (item) {
      var payload = { id: item.id, imageId: item.imageId, commentId: item.commentId };
      if (action === 'delete-image') {
        var targetId = item.imageId || item.id;
        if (uniqueActionIds[targetId]) return;
        uniqueActionIds[targetId] = true;
        payload.id = item.id;
        payload.imageId = targetId;
      }
      payloadItems.push(payload);
    });
    var optimisticImageTokens = {};
    if (action === 'delete-image' && window.galBeginImageDelete) {
      payloadItems.forEach(function (item) {
        var imageId = item.imageId || item.id;
        optimisticImageTokens[item.id] = window.galBeginImageDelete(imageId);
      });
    }
    payloadItems.forEach(function (item) { removeCurrentItem(item.id); });
    renderActivePanel();
    pageLoading = true;
    updateSelectionUi();
    try {
      var fn = window.galFirebase.httpsCallable('adminBulkGalleryAction');
      var result = await fn({ kind: activeTab, action: action, items: payloadItems });
      var data = result.data || {};
      var succeeded = data.succeeded || [];
      var failed = data.failed || [];
      succeeded.forEach(function (id) {
        if (action === 'delete-image' && optimisticImageTokens[id]) window.galConfirmImageDelete && window.galConfirmImageDelete(payloadItems.find(function (item) { return item.id === id; }).imageId || id);
      });
      failed.forEach(function (failure) {
        if (action === 'delete-image' && optimisticImageTokens[failure.id]) window.galRollbackImageDelete && window.galRollbackImageDelete(optimisticImageTokens[failure.id]);
      });
      clearSelection();
      showToast('✅ ' + succeeded.length + '건 처리 완료' + (failed.length ? ' · ' + failed.length + '건 실패' : ''));
      if (failed.length) showToast('실패 항목을 복구하고 있어요. 다시 확인해 주세요.', true);
      await loadAdminPage({ showLoading: false });
    } catch (e) {
      Object.keys(optimisticImageTokens).forEach(function (id) { if (optimisticImageTokens[id]) window.galRollbackImageDelete && window.galRollbackImageDelete(optimisticImageTokens[id]); });
      showToast('일괄 처리 중 오류가 발생했어요: ' + (e && e.message ? e.message : e), true);
      await loadAdminPage({ showLoading: false });
    } finally {
      pageLoading = false;
      updateSelectionUi();
    }
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
      showToast('✅ 정지 처리했어요.');
      loadAdminPage({ showLoading: false });
    } catch (e) {
      window.galSound && window.galSound.error(e);
      showToast('정지 처리 중 오류: ' + (e && e.message ? e.message : e), true);
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
      showToast('✅ 이미지 삭제 완료');
      loadAdminPage({ showLoading: false });
    } catch (e) {
      window.galRollbackImageDelete && window.galRollbackImageDelete(deletionToken);
      removedReports.forEach(function (report) {
        if (!latestReports.some(function (current) { return current.id === report.id; })) latestReports.push(report);
      });
      latestReports.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      renderReports();
      renderImages();
      window.galSound && window.galSound.error(e);
      showToast('이미지 삭제 중 오류: ' + (e && e.message ? e.message : e), true);
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
      showToast('✅ 댓글 삭제 완료');
      loadAdminPage({ showLoading: false });
    } catch (e) {
      if (targetReport) {
        delete pendingCommentReportDeletes[targetReport.id];
        latestCommentReports = previousReports;
        renderCommentReports();
        if (selectedBefore) selectDetail(selectedBefore.kind, selectedBefore.report);
      }
      window.galSound && window.galSound.error(e);
      showToast('댓글 삭제 중 오류: ' + (e && e.message ? e.message : e), true);
      if (!targetReport && btn) btn.disabled = false;
    }
  }

  async function dismissImageReport(reportId, btn) {
    removeCurrentItem(reportId);
    renderActivePanel();
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDismissImageReport');
      await fn({ reportId: reportId });
      window.galSound && window.galSound.adminAction();
      if (selectedDetail && selectedDetail.kind === 'image' && selectedDetail.reportId === reportId) clearDetail();
      showToast('✅ 이미지 신고를 무시했어요.');
      loadAdminPage({ showLoading: false });
    } catch (err) {
      window.galSound && window.galSound.error(err);
      showToast('신고 무시 처리 중 오류: ' + (err && err.message ? err.message : err), true);
      btn.disabled = false;
      loadAdminPage({ showLoading: false });
    }
  }

  async function dismissCommentReport(reportId, btn) {
    removeCurrentItem(reportId);
    renderActivePanel();
    btn.disabled = true;
    try {
      var fn = window.galFirebase.httpsCallable('adminDismissCommentReport');
      await fn({ reportId: reportId });
      window.galSound && window.galSound.adminAction();
      if (selectedDetail && selectedDetail.kind === 'comment' && selectedDetail.reportId === reportId) clearDetail();
      showToast('✅ 댓글 신고를 무시했어요.');
      loadAdminPage({ showLoading: false });
    } catch (err) {
      window.galSound && window.galSound.error(err);
      showToast('댓글 신고 무시 처리 중 오류: ' + (err && err.message ? err.message : err), true);
      btn.disabled = false;
      loadAdminPage({ showLoading: false });
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
        removeCurrentItem(row.dataset.uid);
        renderActivePanel();
        showToast('✅ 정지 해제 완료');
        loadAdminPage({ showLoading: false });
      } catch (err) {
        window.galSound && window.galSound.error(err);
        showToast('정지 해제 중 오류: ' + (err && err.message ? err.message : err), true);
        btn.disabled = false;
        loadAdminPage({ showLoading: false });
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
        removeCurrentItem(requestId);
        renderActivePanel();
        showToast('✅ 해금 신청 승인 완료');
        loadAdminPage({ showLoading: false });
      } catch (err) {
        window.galSound && window.galSound.error(err);
        showToast('해금 승인 중 오류: ' + (err && err.message ? err.message : err), true);
        approveBtn.disabled = false;
        loadAdminPage({ showLoading: false });
      }
    } else if (e.target.closest('.admin-reject-unlock-btn')) {
      var rejectBtn = e.target;
      rejectBtn.disabled = true;
      try {
        var rejectFn = window.galFirebase.httpsCallable('adminRejectStreamerUnlock');
        await rejectFn({ requestId: requestId });
        window.galSound && window.galSound.adminAction();
        removeCurrentItem(requestId);
        renderActivePanel();
        showToast('✅ 해금 신청을 거절했어요.');
        loadAdminPage({ showLoading: false });
      } catch (err) {
        window.galSound && window.galSound.error(err);
        showToast('해금 거절 중 오류: ' + (err && err.message ? err.message : err), true);
        rejectBtn.disabled = false;
        loadAdminPage({ showLoading: false });
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
        removeCurrentItem(uid);
        renderActivePanel();
        showToast('✅ 스트리머 연결을 해제했어요.');
        loadAdminPage({ showLoading: false });
      } catch (err) {
        window.galSound && window.galSound.error(err);
        showToast('연결 해제 중 오류: ' + (err && err.message ? err.message : err), true);
        unlinkBtn.disabled = false;
        loadAdminPage({ showLoading: false });
      }
      return;
    }

    var pickedRow = e.target.closest('.streamer-row');
    if (pickedRow) {
      try {
        var linkFn = window.galFirebase.httpsCallable('adminLinkStreamerAccount');
        await linkFn({ uid: uid, streamerId: pickedRow.dataset.streamerId, streamerName: pickedRow.dataset.streamerName });
        window.galSound && window.galSound.adminAction();
        showToast('✅ 스트리머 연결 완료');
        loadAdminPage({ showLoading: false });
      } catch (err) {
        window.galSound && window.galSound.error(err);
        showToast('스트리머 연결 중 오류: ' + (err && err.message ? err.message : err), true);
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
