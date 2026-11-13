'use strict';
// 스트리머 상세보기 열람 연장 — 통합 캐시 결제(2026-11-13, 별풍선 후원 신청·통합 구독 인증을 대체).
// 결제 즉시 이 스트리머의 상세보기를 모두에게 30일 연장한다(max(지금, 기존 만료) + 30일, 관리자 승인 없음).
// 차감·원장·자동 환불은 공용 통합 캐시 결제 모듈(src/lib/cash-payment.js)을 그대로 쓴다.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireTrustedAccount, assertNotBanned } = require('./lib/auth');
const { createCashProduct, freshTransaction, CashPaymentError } = require('./lib/cash-payment');
const { UNLOCK_CASH_PRICE, UNLOCK_DURATION_MS } = require('./constants');

const STREAMER_ID_RE = /^[a-z0-9]{2,20}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const payment = createCashProduct({
  purchasesKey: 'galleryStreamerUnlockPurchases',
  ledgerKind: 'gallery_streamer_unlock',
  productId: 'gallery-streamer-unlock-30d',
  opsRoot: 'gallery/unlockPurchaseOps', // {requestId}: { uid, streamerId, cashAmount, status, ... } (서버 전용)
  limitsRoot: 'gallery/unlockPurchaseLimits', // {uid}: { lastRequestedAt } (서버 전용)
});

// 결제 → 열람 연장. 같은 요청 번호로 다시 불러도 한 번만 차감·연장한다(테스트에서 직접 부른다).
async function purchaseUnlock({ db, uid, streamerId, requestId, now = Date.now() }) {
  const opRef = db.ref(`gallery/unlockPurchaseOps/${requestId}`);
  const result = await payment.runPurchase({
    db, walletDb: db, uid, requestId, now,
    opMeta: { streamerId },
    cashAmount: UNLOCK_CASH_PRICE,
    fingerprint: `gallery-unlock:${streamerId}`,
    activate: async () => {
      // 재시도 때 두 번 연장하지 않도록 연장 결과를 작업 기록에 남긴다.
      const done = Number((await opRef.get()).val()?.unlockedUntil) || 0;
      if (done) return { activated: true, unlockedUntil: done };
      const tx = await freshTransaction(db.ref(`gallery/streamerUnlockedUntil/${streamerId}`), (current) => Math.max(now, Number(current) || 0) + UNLOCK_DURATION_MS);
      if (!tx.committed) return { activated: false, failureCode: 'unlock-failed' };
      const unlockedUntil = Number(tx.snapshot.val()) || 0;
      await opRef.update({ unlockedUntil });
      return { activated: true, unlockedUntil };
    },
  });
  if (!result.activated) throw new CashPaymentError('aborted', '열람을 연장하지 못해 자동 환불했어요. 다시 시도해 주세요.');
  return { status: 'activated', unlockedUntil: result.data.unlockedUntil, remainingCash: result.remainingCash };
}

function toHttpsError(error) {
  if (error instanceof CashPaymentError) return new HttpsError(error.code, error.message);
  return error;
}

const galleryStreamerUnlockPurchase = onCall({ maxInstances: 10 }, async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const data = request.data || {};
  const action = String(data.action || '');
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  if (!STREAMER_ID_RE.test(streamerId)) throw new HttpsError('invalid-argument', '스트리머를 확인해 주세요.');
  const db = getDatabase();
  const firstUpload = Number((await db.ref(`gallery/streamerFirstUpload/${streamerId}`).get()).val()) || 0;
  if (!firstUpload) throw new HttpsError('not-found', '이미지가 올라온 스트리머만 열 수 있어요.');

  if (action === 'status') {
    const [balance, unlockedUntil] = await Promise.all([
      payment.balance(db, uid),
      db.ref(`gallery/streamerUnlockedUntil/${streamerId}`).get().then((s) => Number(s.val()) || 0),
    ]);
    return { priceCash: UNLOCK_CASH_PRICE, durationDays: Math.round(UNLOCK_DURATION_MS / 86400000), balanceCash: balance, unlockedUntil };
  }

  if (action === 'purchase') {
    const requestId = String(data.requestId || '');
    if (!REQUEST_ID_RE.test(requestId)) throw new HttpsError('invalid-argument', '결제 요청 번호를 확인해 주세요.');
    try {
      return await purchaseUnlock({ db, uid, streamerId, requestId });
    } catch (error) {
      throw toHttpsError(error);
    }
  }
  throw new HttpsError('invalid-argument', '알 수 없는 요청이에요.');
});

module.exports = { galleryStreamerUnlockPurchase, purchaseUnlock, payment };
