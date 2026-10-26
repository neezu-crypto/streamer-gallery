const { onCall } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isAdmin } = require('./lib/auth');
const { UNLOCK_DURATION_MS } = require('./constants');

const UNIFIED_SUBSCRIPTIONS_PATH = 'streamerFanPageViewerSubscriptions';

async function unifiedSubscriptionAccess(request) {
  const uid = requireAuth(request);
  const db = getDatabase();
  const [subscriptionSnap, admin] = await Promise.all([
    db.ref(`${UNIFIED_SUBSCRIPTIONS_PATH}/${uid}`).get(),
    isAdmin(uid, request.auth.token && request.auth.token.email),
  ]);
  const expiresAt = Math.max(0, Number(subscriptionSnap.val() && subscriptionSnap.val().expiresAt) || 0);
  return {
    uid,
    isAdmin: admin,
    subscribed: admin || expiresAt > Date.now(),
    expiresAt,
  };
}

async function isStreamerPubliclyAccessible(db, streamerId) {
  const [firstUploadSnap, unlockedUntilSnap] = await Promise.all([
    db.ref(`gallery/streamerFirstUpload/${streamerId}`).get(),
    db.ref(`gallery/streamerUnlockedUntil/${streamerId}`).get(),
  ]);
  const now = Date.now();
  const firstUpload = Number(firstUploadSnap.val()) || 0;
  const unlockedUntil = Number(unlockedUntilSnap.val()) || 0;
  return (firstUpload > 0 && now < firstUpload + UNLOCK_DURATION_MS) || unlockedUntil > now;
}

async function galleryContentAccess(request, streamerId) {
  const db = getDatabase();
  const [publiclyAccessible, subscription] = await Promise.all([
    isStreamerPubliclyAccessible(db, streamerId),
    unifiedSubscriptionAccess(request),
  ]);
  return {
    allowed: publiclyAccessible || subscription.subscribed,
    publiclyAccessible,
    ...subscription,
  };
}

const gallerySubscriptionStatus = onCall(async (request) => {
  const access = await unifiedSubscriptionAccess(request);
  return {
    subscribed: access.subscribed,
    isAdmin: access.isAdmin,
    expiresAt: access.expiresAt,
  };
});

module.exports = {
  UNIFIED_SUBSCRIPTIONS_PATH,
  unifiedSubscriptionAccess,
  isStreamerPubliclyAccessible,
  galleryContentAccess,
  gallerySubscriptionStatus,
};
