const crypto = require('crypto');

function publicIdFor(uid) {
  return `GAL-${crypto.createHash('sha256').update(`gallery:${uid}`).digest('base64url').slice(0, 14)}`;
}

async function ensurePublicId(db, uid) {
  const id = publicIdFor(uid);
  await db.ref(`privateUserIds/gallery/byUid/${uid}`).set(id);
  await db.ref(`privateUserIds/gallery/byPublicId/${id}`).set(uid);
  return id;
}

function publicImage(image, publicId) {
  const value = Object.assign({}, image, { uploaderPublicId: publicId });
  delete value.uploaderUid;
  return value;
}

function publicComment(comment, publicId) {
  const value = Object.assign({}, comment, { authorPublicId: publicId });
  delete value.uid;
  return value;
}

module.exports = { publicIdFor, ensurePublicId, publicImage, publicComment };
