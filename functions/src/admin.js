const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isAdmin, assertNotBanned, getVerifiedStreamerNickname } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { getR2Client, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = require('./r2');
const { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { UNLOCK_DURATION_MS } = require('./constants');
const { ensurePublicId, publicImage, publicComment, publicIdFor } = require('./public-identity');

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!(await isAdmin(uid, email))) {
    throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  }
  return uid;
}

// 이미지 삭제 — RTDB 메타데이터(이미지 본체·좋아요·댓글·이 이미지 대상 신고들)와
// R2에 올라간 실제 파일을 함께 정리한다. 좋아요 미러(userLikes/{uid}/{imageId})는
// gallery/likes/{imageId} 목록을 먼저 읽어야만 정리 대상 uid를 알 수 있으므로,
// 삭제 순서상 반드시 읽기가 지우기보다 먼저 와야 한다(안 그러면 미러가 고아로 남음).
// adminDeleteImage(관리자)와 deleteOwnImage(본인) 둘 다 이 로직을 그대로 쓰고,
// 호출부에서 소유권/권한 검증만 각자 다르게 한다.
async function performImageDeletion(imageId) {
  const db = getDatabase();
  const [imageSnap, likesSnap, reportsSnap] = await Promise.all([
    db.ref(`gallery/images/${imageId}`).get(),
    db.ref(`gallery/likes/${imageId}`).get(),
    db.ref('gallery/imageReports').orderByChild('imageId').equalTo(imageId).get(),
  ]);
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const updates = {};
  updates[`gallery/images/${imageId}`] = null;
  updates[`gallery/imagesPublic/${imageId}`] = null;
  updates[`gallery/imageStats/${imageId}`] = null;
  updates[`gallery/likes/${imageId}`] = null;
  updates[`gallery/comments/${imageId}`] = null;
  updates[`gallery/commentsPublic/${imageId}`] = null;
  if (likesSnap.exists()) {
    likesSnap.forEach((child) => { updates[`gallery/userLikes/${child.key}/${imageId}`] = null; });
  }
  if (reportsSnap.exists()) {
    reportsSnap.forEach((child) => { updates[`gallery/imageReports/${child.key}`] = null; });
  }
  await db.ref().update(updates);

  const { key, thumbKey } = imageSnap.val();
  const r2Keys = [key, thumbKey].filter(Boolean);
  for (const r2Key of r2Keys) {
    try {
      await getR2Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key }));
    } catch (e) {
      console.error('R2 파일 삭제 실패(메타데이터는 이미 삭제됨):', r2Key, e);
    }
  }
  return imageSnap.val();
}

// adminDeleteComment(관리자)와 deleteOwnComment(본인)가 공유하는 삭제 로직.
async function performCommentDeletion(imageId, commentId) {
  const db = getDatabase();
  const commentRef = db.ref(`gallery/comments/${imageId}/${commentId}`);
  const [snap, reportsSnap] = await Promise.all([
    commentRef.get(),
    db.ref('gallery/commentReports').orderByChild('commentId').equalTo(commentId).get(),
  ]);
  if (!snap.exists()) throw new HttpsError('not-found', '존재하지 않는 댓글입니다.');
  const updates = {};
  updates[`gallery/comments/${imageId}/${commentId}`] = null;
  updates[`gallery/commentsPublic/${imageId}/${commentId}`] = null;
  if (reportsSnap.exists()) {
    reportsSnap.forEach((child) => {
      const report = child.val() || {};
      if (report.imageId !== imageId) return;
      updates[`gallery/commentReports/${child.key}`] = null;
      if (report.reporterUid) {
        updates[`gallery/commentReportsByUser/${report.reporterUid}/${imageId}/${commentId}`] = null;
      }
    });
  }
  await db.ref().update(updates);
  const countResult = await db.ref(`gallery/imageStats/${imageId}/commentCount`).transaction((current) => Math.max(0, (current || 0) - 1));
  return { comment: snap.val(), commentCount: countResult.snapshot.val() || 0 };
}

const adminDeleteImage = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const uid = await requireAdmin(request);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  await performImageDeletion(imageId);
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.deleteImage', imageId);
  return { deleted: true };
});

// 본인이 업로드한 이미지 셀프 삭제(2026-09-05 추가) — 관리자 승인 없이도 본인
// 콘텐츠는 직접 지울 수 있어야 한다.
// 인증 스트리머 본인 대상 이미지 삭제(2026-09-06 추가) — 팬이 올린 자신의
// 팬아트/스크린샷도 스트리머 본인이 원하면 지울 수 있어야 한다. gallery/images엔
// 스트리머의 uid가 아니라 streamerName(문자열)만 있어서, 기본적으로는 인증 시
// 등록한 닉네임과 이름이 일치하는지로 판별한다(soopId-스트리머ID 매핑이 별도로
// 없어 이 방법뿐). 다만 표기 차이(오타·띄어쓰기 등)로 이름이 안 맞을 수 있어서,
// 관리자가 gallery/streamerAccountLinks/{uid}로 특정 streamerId를 수동 연결해두면
// 그 연결을 이름 일치보다 우선 신뢰한다.
const deleteOwnImage = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');
  const image = imageSnap.val();

  const isUploader = image.uploaderUid === uid;
  if (!isUploader) {
    const linkSnap = await db.ref(`gallery/streamerAccountLinks/${uid}`).get();
    const link = linkSnap.exists() ? linkSnap.val() : null;
    const isDepictedByLink = !!link && link.streamerId === image.streamerId;

    let isDepictedByName = false;
    if (!isDepictedByLink) {
      const verifiedNickname = await getVerifiedStreamerNickname(uid);
      isDepictedByName = !!verifiedNickname && verifiedNickname === image.streamerName;
    }

    if (!isDepictedByLink && !isDepictedByName) {
      throw new HttpsError('permission-denied', '본인이 업로드했거나, 본인을 대상으로 한 이미지만 삭제할 수 있어요.');
    }
  }

  await performImageDeletion(imageId);
  return { deleted: true };
});

const adminDeleteComment = onCall(async (request) => {
  const uid = await requireAdmin(request);
  const { imageId, commentId } = request.data || {};
  if (!imageId || !commentId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const result = await performCommentDeletion(imageId, commentId);
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.deleteComment', `${imageId}/${commentId}`);
  return { deleted: true, commentCount: result.commentCount };
});

// 본인이 작성한 댓글 셀프 삭제(2026-09-05 추가).
const deleteOwnComment = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { imageId, commentId } = request.data || {};
  if (!imageId || !commentId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const commentSnap = await getDatabase().ref(`gallery/comments/${imageId}/${commentId}`).get();
  if (!commentSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 댓글입니다.');
  if (commentSnap.val().uid !== uid) {
    throw new HttpsError('permission-denied', '본인이 작성한 댓글만 삭제할 수 있어요.');
  }

  const result = await performCommentDeletion(imageId, commentId);
  return { deleted: true, commentCount: result.commentCount };
});

// 관리자 목록 공통 페이지 조회(2026-09-19) — 각 메뉴가 RTDB 전체를 브라우저로
// 내려받지 않도록 관리자 인증 후 서버에서 검색·상태·날짜·정렬·커서 페이지네이션을
// 적용한다. 데이터 규모가 커져도 클라이언트는 현재 페이지(최대 100건)만 받는다.
function adminQueueText(value) {
  return String(value == null ? '' : value).toLocaleLowerCase('ko-KR');
}

function encodeAdminQueueCursor(item) {
  return Buffer.from(JSON.stringify({ value: item._sortValue || 0, id: item.id || '' })).toString('base64url');
}

function decodeAdminQueueCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.value !== 'number' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch (e) {
    throw new HttpsError('invalid-argument', '페이지 커서가 올바르지 않습니다.');
  }
}

function adminQueueSort(items, sort) {
  const direction = sort === 'oldest' ? 1 : -1;
  return items.sort((a, b) => {
    const valueDiff = ((a._sortValue || 0) - (b._sortValue || 0)) * direction;
    if (valueDiff) return valueDiff;
    return String(a.id || '').localeCompare(String(b.id || '')) * direction;
  });
}

function adminQueueStatus(item, fallback) {
  return item.status || fallback;
}

function adminQueueMatchesCursor(item, cursor, sort) {
  if (!cursor) return true;
  const direction = sort === 'oldest' ? 1 : -1;
  const value = item._sortValue || 0;
  if (value !== cursor.value) return (value - cursor.value) * direction > 0;
  return String(item.id || '').localeCompare(cursor.id) * direction > 0;
}

async function getAdminQueueItems(kind) {
  const db = getDatabase();
  const [reportsSnap, commentsSnap, imagesSnap, statsSnap, unlocksSnap, bansSnap, verificationsSnap, linksSnap] = await Promise.all([
    kind === 'reports' ? db.ref('gallery/imageReports').get() : Promise.resolve(null),
    kind === 'comments' ? db.ref('gallery/commentReports').get() : Promise.resolve(null),
    (kind === 'images' || kind === 'reports' || kind === 'comments') ? db.ref('gallery/images').get() : Promise.resolve(null),
    kind === 'images' ? db.ref('gallery/imageStats').get() : Promise.resolve(null),
    kind === 'unlocks' ? db.ref('gallery/unlockRequests').get() : Promise.resolve(null),
    (kind === 'bans' || kind === 'reports' || kind === 'comments') ? db.ref('bannedAccounts').get() : Promise.resolve(null),
    kind === 'links' ? db.ref('streamerVerifications').get() : Promise.resolve(null),
    kind === 'links' ? db.ref('gallery/streamerAccountLinks').get() : Promise.resolve(null),
  ]);

  const images = imagesSnap ? (imagesSnap.val() || {}) : {};
  const bannedAccounts = bansSnap ? (bansSnap.val() || {}) : {};
  const imageFor = (imageId) => imageId && images[imageId] ? Object.assign({ id: imageId }, images[imageId]) : null;
  const galleryBanFor = (uid) => {
    const value = uid && bannedAccounts[uid] && bannedAccounts[uid].games && bannedAccounts[uid].games.gallery;
    return value ? Object.assign({ uid }, value) : null;
  };
  let items = [];

  if (kind === 'reports') {
    const data = reportsSnap ? (reportsSnap.val() || {}) : {};
    items = Object.keys(data).map((id) => {
      const report = Object.assign({ id, kind: 'imageReport' }, data[id] || {});
      const image = imageFor(report.imageId);
      return Object.assign(report, {
        status: adminQueueStatus(report, 'pending'),
        image: image || null,
        streamerName: image && image.streamerName || '',
        uploaderUid: image && image.uploaderUid || '',
        ban: galleryBanFor(image && image.uploaderUid),
        _sortValue: Number(report.createdAt) || 0,
      });
    });
  } else if (kind === 'comments') {
    const data = commentsSnap ? (commentsSnap.val() || {}) : {};
    items = Object.keys(data).map((id) => {
      const report = Object.assign({ id, kind: 'commentReport' }, data[id] || {});
      const image = imageFor(report.imageId);
      return Object.assign(report, {
        status: adminQueueStatus(report, 'pending'),
        image: image || null,
        streamerName: image && image.streamerName || '',
        ban: galleryBanFor(report.commentAuthorUid),
        _sortValue: Number(report.createdAt) || 0,
      });
    });
  } else if (kind === 'images') {
    const data = imagesSnap ? (imagesSnap.val() || {}) : {};
    const stats = statsSnap ? (statsSnap.val() || {}) : {};
    items = Object.keys(data).map((id) => {
      const image = Object.assign({ id, kind: 'image' }, data[id] || {});
      const stat = stats[id] || {};
      return Object.assign(image, {
        status: adminQueueStatus(image, 'active'),
        likeCount: stat.likeCount || 0,
        commentCount: stat.commentCount || 0,
        _sortValue: Number(image.createdAt) || 0,
      });
    });
  } else if (kind === 'unlocks') {
    const data = unlocksSnap ? (unlocksSnap.val() || {}) : {};
    items = Object.keys(data).map((id) => {
      const item = Object.assign({ id, kind: 'unlock' }, data[id] || {});
      return Object.assign(item, { status: adminQueueStatus(item, 'pending'), _sortValue: Number(item.requestedAt) || 0 });
    });
  } else if (kind === 'bans') {
    const data = bansSnap ? (bansSnap.val() || {}) : {};
    items = Object.keys(data).filter((uid) => data[uid] && data[uid].games && data[uid].games.gallery).map((uid) => {
      const item = Object.assign({ id: uid, uid, kind: 'ban' }, data[uid].games.gallery);
      return Object.assign(item, { status: 'banned', _sortValue: Number(item.bannedAt) || 0 });
    });
  } else if (kind === 'links') {
    const data = verificationsSnap ? (verificationsSnap.val() || {}) : {};
    const links = linksSnap ? (linksSnap.val() || {}) : {};
    items = Object.keys(data).map((id) => {
      const verification = Object.assign({ id: (data[id] && data[id].uid) || id, kind: 'link' }, data[id] || {});
      const link = links[verification.uid];
      return Object.assign(verification, {
        status: link ? 'linked' : 'unlinked',
        link: link || null,
        _sortValue: Number(verification.verifiedAt) || 0,
      });
    });
  } else {
    throw new HttpsError('invalid-argument', '지원하지 않는 관리자 목록입니다.');
  }
  return items;
}

const getGalleryAdminPage = onCall(async (request) => {
  await requireAdmin(request);
  const data = request.data || {};
  const kind = String(data.kind || '');
  const allowedKinds = new Set(['reports', 'comments', 'images', 'unlocks', 'bans', 'links']);
  if (!allowedKinds.has(kind)) throw new HttpsError('invalid-argument', '지원하지 않는 관리자 목록입니다.');

  const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 50));
  const sort = data.sort === 'oldest' ? 'oldest' : 'latest';
  const status = String(data.status || 'pending');
  const type = String(data.type || 'all');
  const search = adminQueueText(String(data.search || '').trim().slice(0, 80));
  const from = Number(data.from) || 0;
  const to = Number(data.to) || 0;
  const cursor = decodeAdminQueueCursor(data.cursor);
  let items = await getAdminQueueItems(kind);

  items = items.filter((item) => {
    const itemStatus = item.status || 'pending';
    if (status !== 'all' && itemStatus !== status) return false;
    if (type !== 'all') {
      if (kind === 'images' && item.category !== type) return false;
      if ((kind === 'reports' && type !== 'image') || (kind === 'comments' && type !== 'comment')) return false;
    }
    if (from && item._sortValue < from) return false;
    if (to && item._sortValue > to) return false;
    if (search) {
      const haystack = adminQueueText([
        item.id, item.uid, item.imageId, item.commentId, item.streamerName,
        item.nickname, item.soopId, item.reason, item.commentText,
        item.category, item.reporterUid, item.commentAuthorUid, item.uploaderUid,
      ].join(' '));
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  adminQueueSort(items, sort);
  const total = items.length;
  if (cursor) items = items.filter((item) => adminQueueMatchesCursor(item, cursor, sort));
  const page = items.slice(0, pageSize);
  const nextCursor = items.length > pageSize ? encodeAdminQueueCursor(page[page.length - 1]) : null;
  page.forEach((item) => { delete item._sortValue; });
  return { items: page, total, hasMore: !!nextCursor, nextCursor };
});

// 사용자 검색(2026-09-20) — 원본 UID가 들어 있는 원장들은 서버에서만 읽고,
// 관리자 화면에는 공개 ID와 최소 활동 정보만 반환한다. 검색어가 UID인 경우에도
// UID를 응답에 되돌려 보내지 않으므로 브라우저·네트워크 로그에 원본 식별자가
// 남지 않는다. 이 함수는 관리자 재검증(requireAdmin)을 거친 관리자만 호출할 수 있다.
const gallerySearchUsers = onCall(async (request) => {
  await requireAdmin(request);
  const rawQuery = String((request.data || {}).query || '').trim().slice(0, 80);
  if (rawQuery.length < 2) throw new HttpsError('invalid-argument', '두 글자 이상 입력해 주세요.');
  const query = adminQueueText(rawQuery);
  const requestedLimit = Number((request.data || {}).limit) || 20;
  const limit = Math.min(30, Math.max(1, requestedLimit));
  const db = getDatabase();
  const [profilesSnap, mappingsSnap, imagesSnap, commentsSnap, imageReportsSnap, commentReportsSnap, bansSnap, verificationsSnap, statsSnap, userLikesSnap] = await Promise.all([
    db.ref('gallery/profiles').get(),
    db.ref('privateUserIds/gallery').get(),
    db.ref('gallery/images').get(),
    db.ref('gallery/comments').get(),
    db.ref('gallery/imageReports').get(),
    db.ref('gallery/commentReports').get(),
    db.ref('bannedAccounts').get(),
    db.ref('streamerVerifications').get(),
    db.ref('gallery/imageStats').get(),
    db.ref('gallery/userLikes').get(),
  ]);

  const profiles = profilesSnap.val() || {};
  const mappings = mappingsSnap.val() || {};
  const byUid = mappings.byUid || {};
  const byPublicId = mappings.byPublicId || {};
  const images = imagesSnap.val() || {};
  const comments = commentsSnap.val() || {};
  const imageReports = imageReportsSnap.val() || {};
  const commentReports = commentReportsSnap.val() || {};
  const bannedAccounts = bansSnap.val() || {};
  const verifications = verificationsSnap.val() || {};
  const imageStats = statsSnap.val() || {};
  const userLikes = userLikesSnap.val() || {};

  const verifiedByUid = {};
  Object.keys(verifications).forEach((id) => {
    const value = verifications[id] || {};
    if (!value.uid) return;
    if (!verifiedByUid[value.uid]) verifiedByUid[value.uid] = [];
    verifiedByUid[value.uid].push({
      nickname: value.nickname || '',
      soopId: value.soopId || '',
      verifiedAt: Number(value.verifiedAt) || 0,
    });
  });

  const imageById = {};
  const imageCountByUid = {};
  const imageLikesByUid = {};
  const imageListByUid = {};
  Object.keys(images).forEach((imageId) => {
    const image = images[imageId] || {};
    const uid = image.uploaderUid;
    if (!uid) return;
    imageById[imageId] = image;
    imageCountByUid[uid] = (imageCountByUid[uid] || 0) + 1;
    imageLikesByUid[uid] = (imageLikesByUid[uid] || 0) + (Number(imageStats[imageId] && imageStats[imageId].likeCount) || 0);
    if (!imageListByUid[uid]) imageListByUid[uid] = [];
    imageListByUid[uid].push({
      id: imageId,
      streamerName: image.streamerName || '',
      category: image.category || '',
      createdAt: Number(image.createdAt) || 0,
      thumbUrl: image.thumbUrl || '',
      imageUrl: image.imageUrl || '',
    });
  });
  Object.keys(imageListByUid).forEach((uid) => imageListByUid[uid].sort((a, b) => b.createdAt - a.createdAt));

  const commentCountByUid = {};
  const commentListByUid = {};
  Object.keys(comments).forEach((imageId) => {
    const imageComments = comments[imageId] || {};
    Object.keys(imageComments).forEach((commentId) => {
      const comment = imageComments[commentId] || {};
      const uid = comment.uid;
      if (!uid) return;
      commentCountByUid[uid] = (commentCountByUid[uid] || 0) + 1;
      if (!commentListByUid[uid]) commentListByUid[uid] = [];
      commentListByUid[uid].push({
        imageId,
        commentId,
        text: comment.text || '',
        createdAt: Number(comment.createdAt) || 0,
      });
    });
  });
  Object.keys(commentListByUid).forEach((uid) => commentListByUid[uid].sort((a, b) => b.createdAt - a.createdAt));

  const likedImageCountByUid = {};
  Object.keys(userLikes).forEach((uid) => {
    const likes = userLikes[uid] || {};
    likedImageCountByUid[uid] = Object.keys(likes).filter((imageId) => likes[imageId] !== null).length;
  });

  const reportByUid = {};
  function addReport(uid, report) {
    if (!uid) return;
    if (!reportByUid[uid]) reportByUid[uid] = { submitted: [], received: [] };
    reportByUid[uid][report.relation].push(report.value);
  }
  Object.keys(imageReports).forEach((id) => {
    const report = imageReports[id] || {};
    const value = { id, kind: 'image', imageId: report.imageId || '', reason: report.reason || '', status: report.status || 'pending', createdAt: Number(report.createdAt) || 0 };
    addReport(report.reporterUid, { relation: 'submitted', value });
    const image = imageById[report.imageId];
    addReport(image && image.uploaderUid, { relation: 'received', value });
  });
  Object.keys(commentReports).forEach((id) => {
    const report = commentReports[id] || {};
    const value = { id, kind: 'comment', imageId: report.imageId || '', commentId: report.commentId || '', reason: report.reason || '', status: report.status || 'pending', createdAt: Number(report.createdAt) || 0 };
    addReport(report.reporterUid, { relation: 'submitted', value });
    addReport(report.commentAuthorUid, { relation: 'received', value });
  });
  Object.keys(reportByUid).forEach((uid) => {
    reportByUid[uid].submitted.sort((a, b) => b.createdAt - a.createdAt);
    reportByUid[uid].received.sort((a, b) => b.createdAt - a.createdAt);
  });

  const candidateUids = new Set([
    ...Object.keys(profiles),
    ...Object.keys(byUid),
    ...Object.keys(imageCountByUid),
    ...Object.keys(commentCountByUid),
    ...Object.keys(likedImageCountByUid),
    ...Object.keys(reportByUid),
    ...Object.keys(bannedAccounts),
    ...Object.keys(verifiedByUid),
  ]);
  if (byPublicId[rawQuery.toUpperCase()]) candidateUids.add(byPublicId[rawQuery.toUpperCase()]);
  if (byPublicId[rawQuery]) candidateUids.add(byPublicId[rawQuery]);

  const matched = [];
  candidateUids.forEach((uid) => {
    const profile = profiles[uid] || {};
    const publicId = byUid[uid] || publicIdFor(uid);
    const verificationList = verifiedByUid[uid] || [];
    const haystack = [uid, publicId, profile.nickname, profile.soopId]
      .concat(verificationList.flatMap((item) => [item.nickname, item.soopId]))
      .join(' ');
    if (!adminQueueText(haystack).includes(query)) return;
    const ban = bannedAccounts[uid] && bannedAccounts[uid].games && bannedAccounts[uid].games.gallery;
    const userReports = reportByUid[uid] || { submitted: [], received: [] };
    const imagesForUser = imageListByUid[uid] || [];
    const commentsForUser = commentListByUid[uid] || [];
    const verifiedProfile = verificationList[0] || {};
    matched.push({
      publicId,
      profile: { nickname: profile.nickname || verifiedProfile.nickname || '', soopId: profile.soopId || verifiedProfile.soopId || '', avatarUrl: profile.avatarUrl || '' },
      verifiedStreamer: verificationList.length > 0,
      verifications: verificationList.slice(0, 5),
      ban: ban ? { status: 'banned', reason: ban.reason || '', bannedAt: Number(ban.bannedAt) || 0 } : { status: 'clear' },
      summary: {
        imageCount: imageCountByUid[uid] || 0,
        commentCount: commentCountByUid[uid] || 0,
        submittedReportCount: userReports.submitted.length,
        receivedReportCount: userReports.received.length,
        totalLikes: imageLikesByUid[uid] || 0,
        likedImageCount: likedImageCountByUid[uid] || 0,
        latestImageAt: imagesForUser[0] ? imagesForUser[0].createdAt : 0,
        latestCommentAt: commentsForUser[0] ? commentsForUser[0].createdAt : 0,
      },
      images: imagesForUser.slice(0, 10),
      comments: commentsForUser.slice(0, 10),
      reports: {
        submitted: userReports.submitted.slice(0, 10),
        received: userReports.received.slice(0, 10),
      },
    });
  });
  matched.sort((a, b) => {
    const aLatest = Math.max(a.summary.latestImageAt || 0, a.summary.latestCommentAt || 0);
    const bLatest = Math.max(b.summary.latestImageAt || 0, b.summary.latestCommentAt || 0);
    return bLatest - aLatest;
  });
  return { results: matched.slice(0, limit), total: matched.length };
});

// 관리자 감사 로그 조회(2026-09-20) — 로그 원장은 서버에서만 읽고, 관리자에게도
// 원본 actorUid는 반환하지 않는다. 최근 200건으로 보관하는 gallery/auditLog를
// 액션·기간·검색어·정렬·커서로 필터링해 현재 화면에 필요한 페이지만 내려준다.
const galleryGetAuditLog = onCall(async (request) => {
  await requireAdmin(request);
  const data = request.data || {};
  const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 50));
  const sort = data.sort === 'oldest' ? 'oldest' : 'latest';
  const action = String(data.action || 'all').trim().slice(0, 120);
  const search = adminQueueText(String(data.search || '').trim().slice(0, 80));
  const from = Number(data.from) || 0;
  const to = Number(data.to) || 0;
  const cursor = decodeAdminQueueCursor(data.cursor);
  const snap = await getDatabase().ref('gallery/auditLog').get();
  const raw = snap.val() || {};
  const actions = new Set();
  let items = Object.keys(raw).map((id) => {
    const entry = raw[id] || {};
    const item = {
      id,
      actorName: entry.actorName || '알 수 없음',
      action: entry.action || '기타',
      detail: entry.detail || '',
      at: Number(entry.at) || 0,
    };
    actions.add(item.action);
    item._sortValue = item.at;
    return item;
  }).filter((item) => {
    if (action !== 'all' && item.action !== action) return false;
    if (from && item.at < from) return false;
    if (to && item.at > to) return false;
    if (search && !adminQueueText([item.actorName, item.action, item.detail].join(' ')).includes(search)) return false;
    return true;
  });
  adminQueueSort(items, sort);
  const total = items.length;
  if (cursor) items = items.filter((item) => adminQueueMatchesCursor(item, cursor, sort));
  const page = items.slice(0, pageSize);
  const nextCursor = items.length > pageSize ? encodeAdminQueueCursor(page[page.length - 1]) : null;
  page.forEach((item) => { delete item._sortValue; });
  return { items: page, total, hasMore: !!nextCursor, nextCursor, actions: Array.from(actions).sort((a, b) => String(a).localeCompare(String(b), 'ko-KR')) };
});

// R2 파일 점검(2026-09-20) — RTDB 원본 메타데이터의 key/thumbKey와 R2
// images/ 오브젝트를 서버에서 대조한다. 메타데이터에 연결되지 않은 오브젝트는
// 바로 삭제하지 않고 관리자에게 후보로만 보여준다.
const galleryScanR2 = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  await requireAdmin(request);
  const db = getDatabase();
  const [imagesSnap] = await Promise.all([db.ref('gallery/images').get()]);
  const images = imagesSnap.val() || {};
  const referenced = new Set();
  Object.keys(images).forEach((imageId) => {
    const image = images[imageId] || {};
    const keys = [image.key, image.thumbKey].filter((key) => typeof key === 'string' && key.startsWith('images/'));
    keys.forEach((key) => referenced.add(key));
  });

  const client = getR2Client();
  const objects = [];
  let continuationToken;
  let scanTruncated = false;
  const maxObjects = 10000;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: 'images/',
      MaxKeys: 1000,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));
    (result.Contents || []).forEach((item) => {
      if (!item.Key || objects.length >= maxObjects) return;
      objects.push({ key: item.Key, size: Number(item.Size) || 0, lastModified: item.LastModified ? new Date(item.LastModified).getTime() : 0, etag: item.ETag || '' });
    });
    if (objects.length >= maxObjects && result.IsTruncated) {
      scanTruncated = true;
      break;
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
  } while (continuationToken);

  const objectKeys = new Set(objects.map((item) => item.key));
  const orphanObjects = objects.filter((item) => !referenced.has(item.key));
  const missingReferences = [];
  referenced.forEach((key) => {
    if (!objectKeys.has(key)) missingReferences.push({ key });
  });
  orphanObjects.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  missingReferences.sort((a, b) => a.key.localeCompare(b.key));
  return {
    scannedAt: Date.now(),
    scanTruncated,
    totals: {
      r2Objects: objects.length,
      referencedObjects: objects.filter((item) => referenced.has(item.key)).length,
      orphanObjects: orphanObjects.length,
      missingReferences: missingReferences.length,
      totalBytes: objects.reduce((sum, item) => sum + item.size, 0),
      orphanBytes: orphanObjects.reduce((sum, item) => sum + item.size, 0),
    },
    orphanObjects: orphanObjects.slice(0, 1000),
    missingReferences: missingReferences.slice(0, 1000),
  };
});

// R2 고아 파일 삭제 — 클라이언트가 보낸 key만 대상으로 하되, 삭제 직전에
// gallery/images 전체를 다시 읽어 현재 참조 여부를 재검증한다. images/ 밖의 key,
// 현재 참조 중인 key는 서버에서 거절/건너뛰므로 점검 시점과 삭제 시점 사이에
// 새 이미지가 등록돼도 사용 중인 파일이 지워지지 않는다.
const galleryDeleteR2Orphans = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const adminUid = await requireAdmin(request);
  const data = request.data || {};
  if (!Array.isArray(data.keys) || data.keys.length === 0 || data.keys.length > 100) {
    throw new HttpsError('invalid-argument', '삭제할 고아 파일을 1~100개 선택해 주세요.');
  }
  const requestedKeys = Array.from(new Set(data.keys.map((key) => String(key || '')).filter((key) => key.startsWith('images/') && key.length <= 300)));
  if (!requestedKeys.length) throw new HttpsError('invalid-argument', '올바른 R2 파일을 선택해 주세요.');
  const imagesSnap = await getDatabase().ref('gallery/images').get();
  const images = imagesSnap.val() || {};
  const referenced = new Set();
  Object.keys(images).forEach((imageId) => {
    const image = images[imageId] || {};
    [image.key, image.thumbKey].forEach((key) => {
      if (typeof key === 'string' && key.startsWith('images/')) referenced.add(key);
    });
  });
  const safeKeys = requestedKeys.filter((key) => !referenced.has(key));
  const skippedKeys = requestedKeys.filter((key) => referenced.has(key));
  let deletedKeys = [];
  if (safeKeys.length) {
    const result = await getR2Client().send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET_NAME,
      Delete: { Objects: safeKeys.map((Key) => ({ Key })), Quiet: true },
    }));
    const errors = (result.Errors || []).map((error) => ({ key: error.Key || '', code: error.Code || '', message: error.Message || '' }));
    deletedKeys = safeKeys.filter((key) => !errors.some((error) => error.key === key));
    if (errors.length) console.error('R2 고아 파일 일부 삭제 실패:', errors);
  }
  const actorName = (request.auth.token && (request.auth.token.email || request.auth.token.name)) || adminUid;
  if (deletedKeys.length) await logAudit(adminUid, actorName, 'gallery.r2Cleanup', deletedKeys.length + '개 고아 파일 삭제');
  return { deletedKeys, skippedKeys, failedCount: requestedKeys.length - deletedKeys.length - skippedKeys.length };
});

async function markAdminReport(reportPath, reportId, status, uid, actorName, action) {
  const ref = getDatabase().ref(`${reportPath}/${reportId}`);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '처리할 신고를 찾을 수 없습니다.');
  await ref.update({ status, resolution: status, reviewedAt: Date.now(), reviewedBy: uid });
  await logAudit(uid, actorName, action, reportId);
}

async function approveUnlockById(requestId, adminUid, actorName) {
  const db = getDatabase();
  const reqRef = db.ref(`gallery/unlockRequests/${requestId}`);
  const snap = await reqRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', '해금 신청을 찾을 수 없습니다.');
  const data = snap.val();
  if (data.status !== 'pending') throw new HttpsError('failed-precondition', '이미 처리된 신청입니다.');
  const now = Date.now();
  await db.ref(`gallery/streamerUnlockedUntil/${data.streamerId}`).transaction((current) => Math.max(now, current || 0) + UNLOCK_DURATION_MS);
  await reqRef.update({ status: 'approved', reviewedAt: now, reviewedBy: adminUid });
  await logAudit(adminUid, actorName, 'gallery.approveUnlock', data.streamerName + ' (' + data.streamerId + ')');
}

const adminBulkGalleryAction = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const adminUid = await requireAdmin(request);
  const data = request.data || {};
  const kind = String(data.kind || '');
  const action = String(data.action || '');
  if (!Array.isArray(data.items) || data.items.length > 20) throw new HttpsError('invalid-argument', '일괄 처리는 한 번에 최대 20건까지 가능합니다.');
  const items = data.items;
  if (!items.length) throw new HttpsError('invalid-argument', '처리할 항목을 선택해 주세요.');
  const actorName = (request.auth.token && (request.auth.token.email || request.auth.token.name)) || adminUid;
  const result = { succeeded: [], failed: [] };

  for (const item of items) {
    const id = String(item.id || '');
    try {
      if (!id) throw new HttpsError('invalid-argument', '항목 ID가 없습니다.');
      if (kind === 'reports' && action === 'dismiss') {
        await markAdminReport('gallery/imageReports', id, 'dismissed', adminUid, actorName, 'gallery.dismissReport');
      } else if (kind === 'comments' && action === 'dismiss') {
        await markAdminReport('gallery/commentReports', id, 'dismissed', adminUid, actorName, 'gallery.dismissCommentReport');
      } else if ((kind === 'reports' || kind === 'images') && action === 'delete-image') {
        await performImageDeletion(String(item.imageId || id));
        await logAudit(adminUid, actorName, 'gallery.deleteImage', String(item.imageId || id));
      } else if (kind === 'comments' && action === 'delete-comment') {
        const imageId = String(item.imageId || '');
        await performCommentDeletion(imageId, String(item.commentId || ''));
        await logAudit(adminUid, actorName, 'gallery.deleteComment', imageId + '/' + String(item.commentId || ''));
      } else if (kind === 'unlocks' && action === 'approve') {
        await approveUnlockById(id, adminUid, actorName);
      } else if (kind === 'unlocks' && action === 'reject') {
        const ref = getDatabase().ref(`gallery/unlockRequests/${id}`);
        const snap = await ref.get();
        if (!snap.exists()) throw new HttpsError('not-found', '해금 신청을 찾을 수 없습니다.');
        if (snap.val().status !== 'pending') throw new HttpsError('failed-precondition', '이미 처리된 신청입니다.');
        await ref.update({ status: 'rejected', reviewedAt: Date.now(), reviewedBy: adminUid });
        await logAudit(adminUid, actorName, 'gallery.rejectUnlock', snap.val().streamerName + ' (' + snap.val().streamerId + ')');
      } else if (kind === 'bans' && action === 'unban') {
        await getDatabase().ref(`bannedAccounts/${id}/games/gallery`).remove();
        await logAudit(adminUid, actorName, '계정 정지 해제', id);
      } else if (kind === 'links' && action === 'unlink') {
        await getDatabase().ref(`gallery/streamerAccountLinks/${id}`).remove();
        await logAudit(adminUid, actorName, 'gallery.unlinkStreamerAccount', id);
      } else {
        throw new HttpsError('invalid-argument', '목록과 처리 방식이 일치하지 않습니다.');
      }
      result.succeeded.push(id);
    } catch (e) {
      result.failed.push({ id, message: e && e.message ? e.message : '처리 실패' });
    }
  }
  return result;
});

const adminDismissImageReport = onCall(async (request) => {
  const uid = await requireAdmin(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const reportRef = db.ref(`gallery/imageReports/${reportId}`);
  if (!(await reportRef.get()).exists()) throw new HttpsError('not-found', '존재하지 않는 신고입니다.');

  await reportRef.update({ status: 'dismissed', resolution: 'dismissed', reviewedAt: Date.now(), reviewedBy: uid });
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.dismissReport', reportId);
  return { dismissed: true };
});

const adminDismissCommentReport = onCall(async (request) => {
  const uid = await requireAdmin(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const reportRef = db.ref(`gallery/commentReports/${reportId}`);
  if (!(await reportRef.get()).exists()) throw new HttpsError('not-found', '존재하지 않는 댓글 신고입니다.');

  await reportRef.update({ status: 'dismissed', resolution: 'dismissed', reviewedAt: Date.now(), reviewedBy: uid });
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.dismissCommentReport', reportId);
  return { dismissed: true };
});

// 게임별 정지 관리(2026-09-05 추가, 신규 게임 온보딩 체크리스트) — StreamBet-Market의
// banAccount/unbanAccount와 동일 패턴이지만 이름은 다르게 짓는다. Cloud Functions
// 리소스 이름은 codebase로 네임스페이스되지 않아(2026-09-04 whoAmI 충돌 사고로 확인)
// banAccount/unbanAccount는 이미 StreamBet-Market이 선점 중이라 그대로 쓰면 그 함수를
// 덮어쓴다. bannedAccounts/{uid}/games/gallery에 쓰고, assertNotBanned(lib/auth.js)가
// 이미 이 경로를 읽고 있으므로 별도 검증 로직 변경은 필요 없다.
const banGalleryAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid, reason } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (uid === adminUid) throw new HttpsError('invalid-argument', '본인 계정은 정지할 수 없어요.');
  if (!reason || !reason.trim()) throw new HttpsError('invalid-argument', '정지 사유를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/gallery').set({
    reason: reason.trim(),
    bannedAt: Date.now(),
    bannedBy: adminUid,
    bannedByName: adminName,
  });
  await logAudit(adminUid, adminName, '계정 정지', uid + ' · ' + reason.trim());
  return { status: 'banned' };
});

const unbanGalleryAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/gallery').remove();
  await logAudit(adminUid, adminName, '계정 정지 해제', uid);
  return { status: 'unbanned' };
});

// 인증 스트리머 계정 ↔ 스트리머ID 수동 연결(2026-09-06 추가) — deleteOwnImage의
// 이름 일치 판별이 표기 차이(오타·띄어쓰기 등)로 실패하는 경우를 관리자가 직접
// 보정할 수 있게 한다. 대상 uid가 실제로 인증된 스트리머인지도 같이 검증한다
// (인증 안 된 계정에 연결해봐야 isTrustedAccount 등 다른 권한 체계와 안 맞음).
const adminLinkStreamerAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid, streamerId, streamerName } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (!streamerId || !streamerName) throw new HttpsError('invalid-argument', '연결할 스트리머를 선택해 주세요.');

  const isVerified = await getVerifiedStreamerNickname(uid);
  if (!isVerified) throw new HttpsError('failed-precondition', '스트리머 인증이 완료된 계정만 연결할 수 있어요.');

  await getDatabase().ref(`gallery/streamerAccountLinks/${uid}`).set({
    streamerId,
    streamerName,
    linkedAt: Date.now(),
    linkedBy: adminUid,
    linkedByName: adminName,
  });
  await logAudit(adminUid, adminName, 'gallery.linkStreamerAccount', `${uid} → ${streamerName} (${streamerId})`);
  return { linked: true };
});

const adminUnlinkStreamerAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');

  await getDatabase().ref(`gallery/streamerAccountLinks/${uid}`).remove();
  await logAudit(adminUid, adminName, 'gallery.unlinkStreamerAccount', uid);
  return { unlinked: true };
});

// 공개 미러 도입 전 데이터의 UID를 관리자만 읽을 수 있는 원본에서 변환한다.
// 이미 변환된 항목은 같은 publicId로 덮어써 재실행해도 안전하다.
const migrateGalleryPublicIdentityData = onCall(async (request) => {
  await requireAdmin(request);
  const db = getDatabase();
  const [imagesSnap, commentsSnap] = await Promise.all([
    db.ref('gallery/images').get(),
    db.ref('gallery/comments').get(),
  ]);
  const updates = {};
  const images = imagesSnap.val() || {};
  for (const [imageId, image] of Object.entries(images)) {
    if (!image || !image.uploaderUid) continue;
    const publicId = await ensurePublicId(db, image.uploaderUid);
    updates[`gallery/imagesPublic/${imageId}`] = publicImage(image, publicId);
  }
  const comments = commentsSnap.val() || {};
  for (const [imageId, imageComments] of Object.entries(comments)) {
    for (const [commentId, comment] of Object.entries(imageComments || {})) {
      if (!comment || !comment.uid) continue;
      const publicId = await ensurePublicId(db, comment.uid);
      updates[`gallery/commentsPublic/${imageId}/${commentId}`] = publicComment(comment, publicId);
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { migrated: Object.keys(updates).length };
});

module.exports = {
  adminDeleteImage,
  deleteOwnImage,
  adminDeleteComment,
  deleteOwnComment,
  adminDismissImageReport,
  adminDismissCommentReport,
  banGalleryAccount,
  unbanGalleryAccount,
  adminLinkStreamerAccount,
  adminUnlinkStreamerAccount,
  migrateGalleryPublicIdentityData,
  getGalleryAdminPage,
  gallerySearchUsers,
  galleryGetAuditLog,
  galleryScanR2,
  galleryDeleteR2Orphans,
  adminBulkGalleryAction,
};
