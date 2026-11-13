'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseUnlock } = require('./unlock-purchase');
// 경로를 중첩 객체로 보관하는 최소 RTDB 대역.
function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  const failures = new Set();
  const walk = (path, create) => {
    const keys = path.split('/').filter(Boolean);
    let node = root;
    for (const key of keys.slice(0, -1)) {
      if (node[key] == null || typeof node[key] !== 'object') { if (!create) return [null, null]; node[key] = {}; }
      node = node[key];
    }
    return [node, keys[keys.length - 1]];
  };
  const read = (path) => { const [node, key] = walk(path, false); const v = node ? node[key] : undefined; return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  const write = (path, value) => { const [node, key] = walk(path, true); if (value === null) delete node[key]; else node[key] = JSON.parse(JSON.stringify(value)); };
  return {
    read, failOnce(path) { failures.add(path); },
    ref(path) {
      return {
        on(_e, cb) { queueMicrotask(cb); }, off() {},
        async get() { const v = read(path); return { val: () => v, exists: () => v !== null }; },
        async transaction(fn) {
          if (failures.has(path)) { failures.delete(path); throw new Error('simulated-failure'); }
          const cur = read(path); const next = fn(cur);
          if (next === undefined) return { committed: false, snapshot: { val: () => cur } };
          write(path, next); return { committed: true, snapshot: { val: () => read(path) } };
        },
        async update(part) { write(path, { ...(read(path) || {}), ...part }); },
        async remove() { write(path, null); },
      };
    },
  };
}

const uid = 'user1';
const DAY = 86400000;
const T = 1.8e12;
const db = (balance, unlockedUntil = 0) => database({
  gameSeriesWallet: { accounts: { [uid]: { balanceCash: balance } } },
  gallery: { streamerFirstUpload: { abc: 1 }, ...(unlockedUntil ? { streamerUnlockedUntil: { abc: unlockedUntil } } : {}) },
});
const RID = 'req_1234567890abcdef';

test('10캐시를 차감하고 지금부터 30일 열람을 연장한다', async () => {
  const d = db(25);
  const r = await purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T });
  assert.equal(r.status, 'activated');
  assert.equal(r.unlockedUntil, T + 30 * DAY);
  assert.equal(r.remainingCash, 15);
  assert.equal(d.read(`gameSeriesWallet/ledger/${uid}/${RID}_gallery_streamer_unlock/balanceDelta`), -10);
  assert.equal(d.read(`gallery/unlockPurchaseOps/${RID}/status`), 'activated');
});

test('남은 기간이 있으면 그 뒤로 30일을 더한다', async () => {
  const d = db(10, T + 5 * DAY);
  const r = await purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T });
  assert.equal(r.unlockedUntil, T + 35 * DAY);
});

test('같은 요청 번호로 다시 불러도 한 번만 차감·연장한다', async () => {
  const d = db(30);
  await purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T });
  const again = await purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T + 9000 });
  assert.equal(again.unlockedUntil, T + 30 * DAY);
  assert.equal(d.read(`gameSeriesWallet/accounts/${uid}/balanceCash`), 20);
  assert.equal(d.read('gallery/streamerUnlockedUntil/abc'), T + 30 * DAY);
});

test('캐시가 부족하면 차감·연장 없이 거절한다', async () => {
  const d = db(9);
  await assert.rejects(purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T }), /통합 캐시가 부족/);
  assert.equal(d.read(`gameSeriesWallet/accounts/${uid}/balanceCash`), 9);
  assert.equal(d.read('gallery/streamerUnlockedUntil/abc'), null);
});

test('연장에 실패하면 자동 환불한다', async () => {
  const d = db(10);
  d.failOnce('gallery/streamerUnlockedUntil/abc');
  await assert.rejects(purchaseUnlock({ db: d, uid, streamerId: 'abc', requestId: RID, now: T }), /자동 환불/);
  assert.equal(d.read(`gameSeriesWallet/accounts/${uid}/balanceCash`), 10);
  assert.equal(d.read(`gallery/unlockPurchaseOps/${RID}/status`), 'refunded');
});
