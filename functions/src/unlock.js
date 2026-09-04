const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireTrustedAccount, assertNotBanned, isAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { FORBIDDEN_TEXT_RE, UNLOCK_NICKNAME_MAX_LENGTH } = require('./constants');

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!(await isAdmin(uid, email))) {
    throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  }
  return uid;
}

// 스트리머별 업로드 잠금 해금 신청 — 별풍선 100개 후원 후 신청, 관리자가 방송에서
// 실제 후원을 수동으로 확인하고 승인한다(soop-stock-market의 "동결 해제(후원)"와
// 동일 원칙 — SOOP API로 자동 확인하지 않음). 이미 해금된 스트리머거나, 이미
// 대기 중인 신청이 있으면 새로 만들지 않고 그 상태를 그대로 알려준다.
const requestStreamerUnlock = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);

  const { streamerId, streamerName, nickname } = request.data || {};
  if (!streamerId || typeof streamerId !== 'string') {
    throw new HttpsError('invalid-argument', '스트리머를 목록에서 선택해 주세요.');
  }
  const name = (streamerName || '').trim().slice(0, 20);
  if (!name) throw new HttpsError('invalid-argument', '스트리머 이름을 확인해 주세요.');
  const donorNickname = (nickname || '').trim().slice(0, UNLOCK_NICKNAME_MAX_LENGTH);
  if (!donorNickname || FORBIDDEN_TEXT_RE.test(donorNickname)) {
    throw new HttpsError('invalid-argument', '후원자 닉네임을 확인해 주세요.');
  }

  const db = getDatabase();
  const unlockedSnap = await db.ref(`gallery/unlockedStreamers/${streamerId}`).get();
  if (unlockedSnap.exists() && unlockedSnap.val() === true) {
    return { action: 'already-unlocked' };
  }

  const existingSnap = await db.ref('gallery/unlockRequests')
    .orderByChild('streamerId').equalTo(streamerId).get();
  if (existingSnap.exists()) {
    let hasPending = false;
    existingSnap.forEach((child) => { if (child.val().status === 'pending') hasPending = true; });
    if (hasPending) return { action: 'already-pending' };
  }

  const reqRef = db.ref('gallery/unlockRequests').push();
  await reqRef.set({
    streamerId,
    streamerName: name,
    nickname: donorNickname,
    requesterUid: uid,
    status: 'pending',
    requestedAt: Date.now(),
  });
  return { action: 'pending', requestId: reqRef.key };
});

const adminApproveStreamerUnlock = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const reqRef = db.ref(`gallery/unlockRequests/${requestId}`);
  const snap = await reqRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', '존재하지 않는 신청입니다.');
  const data = snap.val();

  await db.ref().update({
    [`gallery/unlockedStreamers/${data.streamerId}`]: true,
    [`gallery/unlockRequests/${requestId}/status`]: 'approved',
    [`gallery/unlockRequests/${requestId}/reviewedAt`]: Date.now(),
  });
  await logAudit(adminUid, (request.auth.token && request.auth.token.email) || adminUid, 'gallery.approveUnlock', data.streamerName + ' (' + data.streamerId + ')');
  return { ok: true };
});

const adminRejectStreamerUnlock = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const reqRef = db.ref(`gallery/unlockRequests/${requestId}`);
  const snap = await reqRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', '존재하지 않는 신청입니다.');
  const data = snap.val();

  await reqRef.update({ status: 'rejected', reviewedAt: Date.now() });
  await logAudit(adminUid, (request.auth.token && request.auth.token.email) || adminUid, 'gallery.rejectUnlock', data.streamerName + ' (' + data.streamerId + ')');
  return { ok: true };
});

module.exports = { requestStreamerUnlock, adminApproveStreamerUnlock, adminRejectStreamerUnlock };
