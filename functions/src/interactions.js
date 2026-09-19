const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireTrustedAccount, assertNotBanned } = require('./lib/auth');
const { trimToLast } = require('./lib/capped-log');
const { assertCooldown } = require('./lib/rate-limit');
const { FORBIDDEN_TEXT_RE, LINK_RE, COMMENT_MAX_LENGTH, REPORT_REASON_MAX_LENGTH, COMMENT_COOLDOWN_MS, IMAGE_REPORTS_CAP, COMMENT_REPORTS_CAP, COMMENT_REPORT_COOLDOWN_MS, LIKE_COOLDOWN_MS, REPORT_COOLDOWN_MS } = require('./constants');
const { ensurePublicId, publicComment } = require('./public-identity');

// 좋아요 토글. gallery/likes/{imageId}/{uid}가 "이 uid가 좋아요했다"의 근거이고,
// gallery/userLikes/{uid}/{imageId}는 그 반대 방향 조회(내가 좋아요한 이미지 목록)를
// 한 번의 읽기로 하기 위한 미러다. imageStats/{imageId}/likeCount(2026-09-06부로
// gallery/images에서 분리)는 트랜잭션으로 증감시켜 동시 클릭에도 카운트가 어긋나지
// 않게 한다 — 다만 like 플래그 자체는 트랜잭션 밖에서 별도로 쓰기 때문에, 극히 짧은
// 순간 동시 클릭이 겹치면 카운트와 플래그가 잠깐 어긋날 수 있다(비금전적 좋아요
// 수치라 허용 가능한 수준으로 판단, 클라이언트에서 버튼을 처리 중 비활성화해 실사용
// 빈도를 낮춘다).
const toggleLike = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  await assertCooldown(uid, 'like', LIKE_COOLDOWN_MS);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const likeRef = db.ref(`gallery/likes/${imageId}/${uid}`);
  const alreadyLiked = (await likeRef.get()).exists();
  const delta = alreadyLiked ? -1 : 1;

  const countResult = await db.ref(`gallery/imageStats/${imageId}/likeCount`).transaction((current) => Math.max(0, (current || 0) + delta));
  if (!countResult.committed) throw new HttpsError('aborted', '잠시 후 다시 시도해 주세요.');

  if (alreadyLiked) {
    await Promise.all([likeRef.remove(), db.ref(`gallery/userLikes/${uid}/${imageId}`).remove()]);
  } else {
    await Promise.all([likeRef.set(true), db.ref(`gallery/userLikes/${uid}/${imageId}`).set(true)]);
  }

  return { liked: !alreadyLiked, likeCount: countResult.snapshot.val() };
});

// 상세 패널 조회수 기록. 썸네일을 눌러 상세 패널을 연 시점에만 클라이언트가
// 호출하며, Firebase가 발급한 인증 uid(익명 세션 포함) 기준으로 집계한다. 계정·이미지별
// 마지막 기록 시각을 서버 전용 dedup 노드에 저장해 24시간 동안
// 같은 계정의 재열람을 한 번으로 묶는다. 카운터와 dedup은 모두 RTDB 트랜잭션으로
// 처리하므로 같은 순간 여러 탭에서 열어도 1회만 증가한다.
const recordImageView = onCall(async (request) => {
  const uid = requireAuth(request);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(imageId)) {
    throw new HttpsError('invalid-argument', '잘못된 이미지입니다.');
  }

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  await assertNotBanned(uid);

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const dedupRef = db.ref(`gallery/viewDedup/${uid}/${imageId}`);
  let accepted = false;
  const dedupResult = await dedupRef.transaction((lastViewedAt) => {
    const previous = Number(lastViewedAt) || 0;
    if (previous > cutoff) {
      accepted = false;
      return;
    }
    accepted = true;
    return now;
  });
  if (!dedupResult.committed) accepted = false;

  const viewRef = db.ref(`gallery/imageStats/${imageId}/viewCount`);
  if (accepted) {
    const countResult = await viewRef.transaction((current) => Math.max(0, Number(current) || 0) + 1);
    if (!countResult.committed) throw new HttpsError('aborted', '조회수 반영에 실패했습니다.');
    return { counted: true, viewCount: Number(countResult.snapshot.val()) || 0 };
  }
  const countSnap = await viewRef.get();
  return { counted: false, viewCount: Number(countSnap.val()) || 0, reason: 'within-24-hours' };
});

const postComment = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId, text } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  const trimmed = (text || '').trim();
  if (!trimmed) throw new HttpsError('invalid-argument', '댓글 내용을 입력해 주세요.');
  if (trimmed.length > COMMENT_MAX_LENGTH) throw new HttpsError('invalid-argument', `댓글은 ${COMMENT_MAX_LENGTH}자 이하로 입력해 주세요.`);
  if (FORBIDDEN_TEXT_RE.test(trimmed)) throw new HttpsError('invalid-argument', '허용되지 않는 문자가 포함되어 있습니다.');
  if (LINK_RE.test(trimmed)) throw new HttpsError('invalid-argument', '댓글에 링크는 포함할 수 없어요.');

  await assertCooldown(uid, 'comment', COMMENT_COOLDOWN_MS);

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const commentRef = db.ref(`gallery/comments/${imageId}`).push();
  const publicId = await ensurePublicId(db, uid);
  const comment = { uid, text: trimmed, createdAt: Date.now() };
  await db.ref().update({
    [`gallery/comments/${imageId}/${commentRef.key}`]: comment,
    [`gallery/commentsPublic/${imageId}/${commentRef.key}`]: publicComment(comment, publicId),
  });
  const countResult = await db.ref(`gallery/imageStats/${imageId}/commentCount`).transaction((current) => (current || 0) + 1);

  return { commentId: commentRef.key, commentCount: countResult.snapshot.val() || 0 };
});

const reportImage = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  // 이미지당 1회 중복 신고는 아래 dedupRef로 이미 막혀있지만, 짧은 시간에 여러
  // 이미지를 잇달아 신고하는 매크로/도배는 별도 쿨다운으로 막는다.
  await assertCooldown(uid, 'report', REPORT_COOLDOWN_MS);
  const { imageId, reason } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  const trimmedReason = (reason || '').trim().slice(0, REPORT_REASON_MAX_LENGTH);
  if (FORBIDDEN_TEXT_RE.test(trimmedReason)) throw new HttpsError('invalid-argument', '허용되지 않는 문자가 포함되어 있습니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  // 중복 신고 방지 — gallery/likes의 userLikes 미러와 동일한 패턴으로 "이 uid가 이
  // imageId를 신고했다"를 별도 노드에 기록해두고 재신고를 막는다(orderByChild 없이
  // 단건 조회로 확인 가능해 추가 인덱스가 필요 없다).
  const dedupRef = db.ref(`gallery/imageReportsByUser/${uid}/${imageId}`);
  if ((await dedupRef.get()).exists()) {
    throw new HttpsError('already-exists', '이미 신고한 이미지예요.');
  }

  const reportsRef = db.ref('gallery/imageReports');
  const reportRef = reportsRef.push();
  await reportRef.set({ imageId, reporterUid: uid, reason: trimmedReason, createdAt: Date.now() });
  await dedupRef.set(true);
  await trimToLast(reportsRef, IMAGE_REPORTS_CAP);
  return { reportId: reportRef.key };
});

// 댓글 신고 — 이미지 신고와 별도 큐로 분리해 관리자가 댓글 자체와 작성자를
// 함께 검수할 수 있게 한다. commentText는 신고 시점의 스냅샷을 보관하므로
// 원댓글이 먼저 삭제돼도 관리자 목록에서 신고 맥락이 사라지지 않는다.
const reportComment = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  await assertCooldown(uid, 'commentReport', COMMENT_REPORT_COOLDOWN_MS);
  const { imageId, commentId, reason } = request.data || {};
  if (!imageId || typeof imageId !== 'string' || !commentId || typeof commentId !== 'string') {
    throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  }
  const trimmedReason = (reason || '').trim().slice(0, REPORT_REASON_MAX_LENGTH);
  if (FORBIDDEN_TEXT_RE.test(trimmedReason)) throw new HttpsError('invalid-argument', '허용되지 않는 문자가 포함되어 있습니다.');

  const db = getDatabase();
  const [imageSnap, commentSnap] = await Promise.all([
    db.ref(`gallery/images/${imageId}`).get(),
    db.ref(`gallery/comments/${imageId}/${commentId}`).get(),
  ]);
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');
  if (!commentSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 댓글입니다.');
  const comment = commentSnap.val() || {};
  if (comment.uid === uid) throw new HttpsError('invalid-argument', '본인이 작성한 댓글은 신고할 수 없어요.');

  const dedupRef = db.ref(`gallery/commentReportsByUser/${uid}/${imageId}/${commentId}`);
  if ((await dedupRef.get()).exists()) throw new HttpsError('already-exists', '이미 신고한 댓글이에요.');

  const reportsRef = db.ref('gallery/commentReports');
  const reportRef = reportsRef.push();
  await reportRef.set({
    imageId,
    commentId,
    commentAuthorUid: comment.uid || '',
    commentText: String(comment.text || '').slice(0, COMMENT_MAX_LENGTH),
    reporterUid: uid,
    reason: trimmedReason,
    createdAt: Date.now(),
  });
  await dedupRef.set(true);
  await trimToLast(reportsRef, COMMENT_REPORTS_CAP);
  return { reportId: reportRef.key };
});

// 썸네일 숨기기(2026-09-05 추가) — 다른 사람에게는 전혀 영향 없이, 이 계정의
// 메인 그리드에서만 해당 이미지를 안 보이게 하는 개인 취향 필터. userLikes와
// 동일한 미러 패턴(gallery/hiddenImages/{uid}/{imageId})이라 클라이언트가
// 자기 uid 목록만 구독해서 그리드를 걸러내면 된다. unhideImage는 지금 UI에서
// 호출하는 곳은 없지만(관리 화면 없음 — 사용자 결정), ban/unban처럼 되돌리는
// 대응 함수 없이 한 방향만 만들어두면 나중에 되돌릴 방법이 아예 없어지므로
// 짝을 맞춰 같이 배포해둔다.
const hideImage = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  await db.ref(`gallery/hiddenImages/${uid}/${imageId}`).set(true);
  return { hidden: true };
});

const unhideImage = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  await getDatabase().ref(`gallery/hiddenImages/${uid}/${imageId}`).remove();
  return { hidden: false };
});

module.exports = { toggleLike, recordImageView, postComment, reportImage, reportComment, hideImage, unhideImage };
