const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { galleryCheckAdmin } = require('./src/whoami');
const { requestImageUpload, registerImage } = require('./src/r2');
const { toggleLike, postComment, reportImage } = require('./src/interactions');
const { adminDeleteImage, adminDeleteComment, adminDismissImageReport, banGalleryAccount, unbanGalleryAccount } = require('./src/admin');
const { updateGalleryProfile } = require('./src/profile');
const { requestStreamerUnlock, adminApproveStreamerUnlock, adminRejectStreamerUnlock } = require('./src/unlock');

// r2.js는 admin.js가 재사용할 getR2Client/R2_BUCKET_NAME/시크릿 참조도 같이 export하므로
// 여기서 그대로 spread하면 Cloud Function이 아닌 값까지 최상위로 노출된다 — 실제 배포
// 대상인 callable 함수만 이름을 명시해서 다시 export한다.
module.exports = {
  galleryCheckAdmin,
  requestImageUpload,
  registerImage,
  toggleLike,
  postComment,
  reportImage,
  adminDeleteImage,
  adminDeleteComment,
  adminDismissImageReport,
  banGalleryAccount,
  unbanGalleryAccount,
  updateGalleryProfile,
  requestStreamerUnlock,
  adminApproveStreamerUnlock,
  adminRejectStreamerUnlock,
};
