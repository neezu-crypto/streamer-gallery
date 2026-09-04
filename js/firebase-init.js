import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signInWithCustomToken,
  linkWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  limitToLast,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

// 갤러리 전용 Web App 등록 (자매 저장소들과 같은 프로젝트 soop-stock-market, appId만 별개)
const firebaseConfig = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:8fa090a599797eb6a3a769',
  measurementId: 'G-Y21N1SSMZB',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app);
const whoAmIFn = httpsCallable(functions, 'galleryCheckAdmin');
// linkGoogleAccount/linkKakaoAccount/requestStreamerVerification은 이 저장소
// 소스에 없다 - 같은 Firebase 프로젝트(soop-stock-market)에 이미 배포돼 있는
// 함수를 codebase 구분 없이 이름으로 그대로 호출한다(다른 자매 저장소들과 동일 -
// "다른 앱 소스에 없다고 삭제하면 안 되는 함수" 목록에 있는 걸 그대로 갖다 쓰는 입장).
const linkGoogleAccountFn = httpsCallable(functions, 'linkGoogleAccount');
const linkKakaoAccountFn = httpsCallable(functions, 'linkKakaoAccount');
const requestStreamerVerificationFn = httpsCallable(functions, 'requestStreamerVerification');
const googleProvider = new GoogleAuthProvider();

window.galFirebase = {
  ref, get, set, update, push, remove, onValue, query, orderByChild, equalTo, limitToFirst, limitToLast, serverTimestamp,
  httpsCallable: (name) => httpsCallable(functions, name),
  GoogleAuthProvider,
};
window.galAuth = auth;
window.galDb = db;
window.galUser = null;      // 익명 계정 포함, 현재 인증 세션(갤러리 조회 등 공개 데이터 읽기 권한용)
window.galRealUser = null;  // 익명이 아닌 실제(Google/Kakao) 로그인 계정만
// 통합관리센터(adminCenter/adminUids) 연결 — 클라이언트가 직접 못 읽으므로 whoAmI
// 서버 확인 결과로만 판정한다(자매 저장소들과 동일 패턴).
window.galIsAdmin = false;
// 스트리머 인증(구글·카카오를 꺼리는 유저를 위한 대체 계정 보호 경로) — 익명
// 세션이어도 인증만 통과하면 실계정과 동일하게 취급한다(functions/src/lib/auth.js의
// isTrustedAccount와 짝을 이루는 클라이언트 쪽 판정).
window.galIsVerifiedStreamer = false;
window.galVerifiedStreamerNickname = null;
window.galTrusted = false;
function updateTrusted() {
  window.galTrusted = !!(window.galRealUser || window.galIsAdmin || window.galIsVerifiedStreamer);
}

// 로그인 후에는 계정 표시 이름을 그대로 노출하는 대신(실명 노출 우려) "OO 로그인
// 완료"를 보여주는 용도 — 카카오는 signInWithCustomToken 기반이라 providerData에
// 'kakao.com'이 안 남으므로(커스텀 토큰 로그인은 연동 제공자 메타데이터를 남기지
// 않음), 이 앱에서 실계정이 될 수 있는 경로가 구글 연동/카카오 연동 둘뿐이라는 점을
// 이용해 "구글이 아니면 카카오"로 판별한다.
function isGoogleLinkedUser(user) {
  return !!(user && user.providerData && user.providerData.some((p) => p.providerId === 'google.com'));
}
window.galLoginMethodLabel = function () {
  if (window.galRealUser) return isGoogleLinkedUser(window.galRealUser) ? '구글 로그인 완료' : '카카오 로그인 완료';
  if (window.galIsVerifiedStreamer) return '스트리머 인증 완료';
  return null;
};
window.galSignInWithCustomToken = (token) => signInWithCustomToken(auth, token);

// 구글 팝업이 닫힌 직후엔 COOP 정책 때문에 브라우저가 이 탭을 잠깐 "활성 탭이
// 아니다"로 오판하고, 그 상태에서 네이티브 confirm()을 부르면 크롬이 다이얼로그
// 자체를 띄우지도 않고 조용히 억제해버린다(콘솔에 "suppressed because this page
// is not the active tab" 경고, 2026-09-04 재현 확인). soop-stock-market에서 이미
// 한 번 실제로 겪고 고친 문제(2026-07-10, 커밋 e6db09d)— 그때 검증된 해법 그대로,
// 타이밍에 기대는 지연이 아니라 이 문제 자체의 대상이 아닌 일반 HTML 커스텀
// 모달로 완전히 대체한다. 여러 자매 사이트가 같은 Firebase Auth 사용자 풀을
// 공유하는 구조상, 다른 사이트에서 이미 구글 계정을 연동해본 사용자가 "새 사이트"
// 첫 로그인마다 이 경로(auth/credential-already-in-use)를 타게 되어 드문 경우가
// 아니다.
function confirmModal(message) {
  return new Promise((resolve) => {
    var backdrop = document.getElementById('app-confirm-backdrop');
    var msgEl = document.getElementById('app-confirm-message');
    var yesBtn = document.getElementById('app-confirm-yes-btn');
    var noBtn = document.getElementById('app-confirm-no-btn');
    if (!backdrop || !msgEl || !yesBtn || !noBtn) { resolve(false); return; }
    msgEl.textContent = message;
    backdrop.classList.add('open');
    function cleanup(result) {
      backdrop.classList.remove('open');
      yesBtn.onclick = null;
      noBtn.onclick = null;
      resolve(result);
    }
    yesBtn.onclick = function () { cleanup(true); };
    noBtn.onclick = function () { cleanup(false); };
  });
}
window.galConfirmModal = confirmModal; // 팝업 기반 로그인(카카오 등) 직후 confirm()에도 재사용

async function completeAccountSwitch(customToken) {
  await signInWithCustomToken(auth, customToken);
  alert('✅ 이제 이 기기에서도 같은 계정을 이어서 쓸 수 있어요.');
  window.location.reload();
}

// 익명 계정을 그대로 승격(linkWithPopup)해 지금까지 쌓인 진행도(업로드·좋아요 등)를
// 잃지 않는다 - 새 계정을 만드는 게 아니라 지금 쓰던 익명 uid를 보호하는 방식
// (streamer-life-game과 동일한 패턴). 이미 다른 uid에 연동된 구글 계정이면 그
// 계정으로 전환.
function signIn() {
  return linkWithPopup(auth.currentUser, googleProvider).then(async () => {
    await linkGoogleAccountFn();
    alert('✅ 구글 연동 완료!');
    window.galCloseLoginModal && window.galCloseLoginModal();
  }).catch(async (err) => {
    if (err && err.code === 'auth/credential-already-in-use') {
      if (!(await confirmModal('🔗 이미 연동된 계정을 발견했어요!\n이 기기에서도 같은 계정으로 이어서 진행할까요?'))) return;
      try {
        await signInWithPopup(auth, googleProvider);
        await linkGoogleAccountFn();
        window.location.reload();
      } catch (e2) {
        console.error('계정 전환용 재인증 실패:', e2);
        alert('⚠️ 계정 전환 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
    console.error('Google 로그인 실패', err);
    alert('Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  });
}
window.galSignIn = signIn;
window.galSignOut = () => signOut(auth);
window.galLinkKakaoAccount = (kakaoAccessToken) => linkKakaoAccountFn({ kakaoAccessToken });
window.galRequestStreamerVerification = (data) => requestStreamerVerificationFn(Object.assign({ source: 'streamer-gallery' }, data));
window.galCompleteAccountSwitch = completeAccountSwitch;

// 스트리머 인증 유저 프로필 자동 채움(2026-09-05 추가) — 인증 신청 때 이미 제출한
// 닉네임/SOOP 아이디를 프로필 모달에서 다시 입력하게 하지 않는다. 이미 사용자가
// 직접 프로필을 저장해둔 적 있으면(닉네임 있음) 덮어쓰지 않음 — updateProfile
// 서버 쪽에도 같은 가드가 있지만, 여기서 먼저 확인해 불필요한 쓰기 자체를 줄인다.
// 인증 신청 닉네임(최대 20자 등)이 프로필 닉네임 상한(12자)보다 길 수 있어 자른다.
async function autoFillProfileFromVerification(uid, nickname, soopId) {
  if (!nickname) return;
  try {
    const existing = await get(ref(db, 'gallery/profiles/' + uid));
    if (existing.exists() && existing.val() && existing.val().nickname) return;
    await httpsCallable(functions, 'updateGalleryProfile')({ nickname: nickname.slice(0, 12), soopId: soopId || '' });
  } catch (e) {
    console.error('프로필 자동 채움 실패', e);
  }
}

async function checkVerifiedStreamer(uid) {
  try {
    const q = query(ref(db, 'streamerVerifications'), orderByChild('uid'), equalTo(uid), limitToFirst(1));
    const snap = await get(q);
    window.galIsVerifiedStreamer = snap.exists();
    const record = snap.exists() ? Object.values(snap.val())[0] : null;
    window.galVerifiedStreamerNickname = record ? (record.nickname || null) : null;
    if (record) await autoFillProfileFromVerification(uid, record.nickname, record.soopId);
  } catch (e) {
    console.error('스트리머 인증 여부 확인 실패', e);
    window.galIsVerifiedStreamer = false;
    window.galVerifiedStreamerNickname = null;
  }
}

// 접속자 분석(admin-center 10번, 2026-09-05 추가) — presence/gallery/{uid}에
// 주기적으로 lastSeen을 기록한다(soop-stock-market/StreamBet-Market이 이미 검증한
// 5분 주기 패턴 그대로 재사용, 경로만 이 사이트 이름으로 네임스페이스). 익명 세션도
// 포함해서 기록해야 실제 동접 규모를 반영한다.
const PRESENCE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let presenceIntervalId = null;
function refreshMyPresence() {
  if (!window.galUser) return;
  set(ref(db, 'presence/gallery/' + window.galUser.uid), { lastSeen: Date.now() }).catch(() => {});
}
function startPresenceRefreshLoop() {
  if (presenceIntervalId) clearInterval(presenceIntervalId);
  refreshMyPresence();
  presenceIntervalId = setInterval(refreshMyPresence, PRESENCE_REFRESH_INTERVAL_MS);
}

// 페이지 접속 시(로딩 동안) 자동으로 익명 로그인 — auth != null 규칙을 만족시켜 로그인
// 전에도 갤러리 목록 등 공개 데이터를 읽을 수 있게 한다. 업로드·좋아요·댓글은
// requireTrustedAccount가 서버에서 막는다(functions/src/lib/auth.js).
onAuthStateChanged(auth, async (user) => {
  window.galUser = user;
  window.galRealUser = user && !user.isAnonymous ? user : null;
  window.galIsAdmin = false; // 서버 확인 전까지는 안전한 기본값 — 익명 계정은 애초에 관리자가 될 수 없다.
  updateTrusted();
  document.dispatchEvent(new CustomEvent('gal-auth-changed', { detail: { user, realUser: window.galRealUser, isAdmin: false, trusted: window.galTrusted } }));

  if (!user) {
    signInAnonymously(auth).catch((err) => console.error('익명 로그인 실패', err));
    return;
  }

  startPresenceRefreshLoop();
  await checkVerifiedStreamer(user.uid); // 익명 세션이어도 인증만 됐으면 확인해야 한다
  if (window.galRealUser) {
    try {
      const result = await whoAmIFn();
      window.galIsAdmin = !!(result.data && result.data.isAdmin);
    } catch (e) {
      console.error('관리자 여부 확인 실패', e);
    }
  }
  updateTrusted();
  document.dispatchEvent(new CustomEvent('gal-auth-changed', { detail: { user, realUser: window.galRealUser, isAdmin: window.galIsAdmin, trusted: window.galTrusted } }));
});

// Ctrl+Enter 단축키로 어디서든 Google 로그인 팝업(게스트/익명 상태에서도 실계정 전환 가능)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && !window.galRealUser) {
    e.preventDefault();
    signIn();
  }
});
