//  SOOP 게시글 이미지 불러오기(2026-11-17). 원본은 저장하지 않고 SOOP 주소로 보여 준다.
//  흐름: galleryPreviewSoopPost(1회) → 사진 고르기 → 썸네일 생성 → requestSoopImageUpload(1회)
//  → 썸네일 PUT(사진 수만큼, R2 직접) → registerSoopImages(1회). 사진마다 개별 이미지로 등록된다.
(function () {
  'use strict';
  var tabFile = document.getElementById('upload-tab-file');
  var tabSoop = document.getElementById('upload-tab-soop');
  var panel = document.getElementById('soop-import');
  var urlInput = document.getElementById('soop-post-url');
  var loadBtn = document.getElementById('soop-post-load');
  var grid = document.getElementById('soop-photo-grid');
  var submitBtn = document.getElementById('soop-submit-btn');
  var notice = document.getElementById('soop-notice');
  // 전체 공개가 아닌 글이면 상태줄 대신 눈에 띄는 안내 상자를 보여 준다.
  function showNotice(title, body) {
    if (!notice) return;
    notice.textContent = '';
    if (!title) { notice.hidden = true; return; }
    var b = document.createElement('strong'); b.textContent = title;
    var p = document.createElement('p'); p.textContent = body;
    notice.appendChild(b); notice.appendChild(p); notice.hidden = false;
  }
  var dropzone = document.getElementById('upload-dropzone');
  var fileSubmit = document.getElementById('upload-submit-btn');
  if (!tabFile || !tabSoop || !panel) return;

  var MAX_PICK = 20;
  var previewCache = {}; // "링크|스트리머" → 미리보기 결과(같은 링크는 다시 부르지 않음)
  var current = null; // { url, streamerId, photos }
  var picked = new Set();

  function shared() { return window.galUploadShared; }
  function msg(t) { var s = shared(); if (s) s.status(t); }

  function setMode(soop) {
    tabFile.classList.toggle('active', !soop); tabSoop.classList.toggle('active', soop);
    tabFile.setAttribute('aria-selected', String(!soop)); tabSoop.setAttribute('aria-selected', String(soop));
    panel.hidden = !soop;
    if (dropzone) dropzone.hidden = soop;
    if (fileSubmit) fileSubmit.hidden = soop;
    msg('');
  }
  tabFile.addEventListener('click', function () { setMode(false); });
  tabSoop.addEventListener('click', function () { setMode(true); });

  function errText(err) { return (err && err.message) ? err.message : String(err); }

  function render() {
    grid.textContent = '';
    if (!current) { submitBtn.hidden = true; return; }
    current.photos.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'soop-photo';
      var img = document.createElement('img');
      img.src = p.url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      b.appendChild(img);
      if (p.registered) {
        b.disabled = true; b.classList.add('registered');
        var tag = document.createElement('span'); tag.textContent = '이미 등록됨'; b.appendChild(tag);
      } else {
        b.setAttribute('aria-pressed', picked.has(p.photoNo) ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (picked.has(p.photoNo)) picked.delete(p.photoNo);
          else {
            // 오늘 남은 업로드 장수까지만 고를 수 있다(하루 업로드 제한).
            var left = window.galUploadRemaining ? window.galUploadRemaining() : null;
            var cap = Math.min(MAX_PICK, left === null ? MAX_PICK : left);
            if (picked.size >= cap) {
              msg(cap < MAX_PICK ? '⚠️ 오늘은 ' + cap + '장까지 더 올릴 수 있어요.' : '⚠️ 한 번에 ' + MAX_PICK + '장까지 등록할 수 있어요.');
              if (cap < MAX_PICK && left === 0 && window.galOpenUploadPass) window.galOpenUploadPass();
              return;
            }
            picked.add(p.photoNo);
          }
          b.setAttribute('aria-pressed', picked.has(p.photoNo) ? 'true' : 'false');
          updateSubmit();
        });
      }
      grid.appendChild(b);
    });
    updateSubmit();
  }
  function updateSubmit() {
    submitBtn.hidden = !current;
    submitBtn.disabled = picked.size === 0;
    submitBtn.textContent = picked.size ? '고른 사진 ' + picked.size + '장 등록하기' : '등록할 사진을 골라 주세요';
  }

  loadBtn.addEventListener('click', async function () {
    var s = shared(); var who = s && s.picked();
    var url = (urlInput.value || '').trim();
    if (!who || !who.id) { msg('⚠️ 먼저 스트리머를 검색해서 선택해 주세요.'); return; }
    if (!url) { msg('⚠️ SOOP 게시글 링크를 넣어 주세요.'); return; }
    if (!window.galTrusted) { msg('로그인 후 이용할 수 있어요.'); window.galOpenLoginModal && window.galOpenLoginModal(); return; }
    showNotice('');
    var cacheKey = url + '|' + who.id;
    picked = new Set();
    if (previewCache[cacheKey]) { current = previewCache[cacheKey]; render(); return; }
    loadBtn.disabled = true; msg('게시글을 불러오는 중…');
    try {
      var res = await window.galFirebase.httpsCallable('galleryPreviewSoopPost')({ url: url, streamerId: who.id });
      current = { url: url, streamerId: who.id, photos: (res.data && res.data.photos) || [] };
      previewCache[cacheKey] = current;
      msg('사진 ' + current.photos.length + '장을 찾았어요. 등록할 사진을 골라 주세요.');
      render();
    } catch (err) {
      current = null; render();
      var notPublic = (err && err.details && err.details.reason === 'not-public');
      if (notPublic) {
        msg('');
        showNotice('🔒 전체 공개 글이 아니에요',
          errText(err) + ' SOOP에서 게시판 공개 범위를 \'전체 공개\'로 바꾸거나, 전체 공개 게시판에 올린 글의 링크를 넣어 주세요.');
      } else {
        msg('❌ ' + errText(err));
      }
    } finally { loadBtn.disabled = false; }
  });

  // SOOP 이미지(CORS 허용)를 캔버스로 줄여 목록용 JPEG 썸네일을 만든다.
  function thumbFromUrl(url, max) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) { blob ? resolve({ blob: blob, width: w, height: h }) : reject(new Error('썸네일 생성에 실패했어요.')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { reject(new Error('SOOP 이미지를 읽지 못했어요.')); };
      img.src = url;
    });
  }

  submitBtn.addEventListener('click', async function () {
    var s = shared(); if (!s || !current || !picked.size) return;
    var who = s.picked();
    if (!who || who.id !== current.streamerId) { msg('⚠️ 스트리머 선택이 바뀌었어요. 게시글을 다시 불러와 주세요.'); return; }
    var category = document.getElementById('upload-category').value;
    var chosen = current.photos.filter(function (p) { return picked.has(p.photoNo); });
    submitBtn.disabled = true; loadBtn.disabled = true; msg('');
    try {
      var thumbs = {};
      for (var i = 0; i < chosen.length; i++) {
        s.setProgress('미리보기 만드는 중… (' + (i + 1) + '/' + chosen.length + ')', 10 + Math.round(30 * i / chosen.length));
        thumbs[chosen[i].photoNo] = await thumbFromUrl(chosen[i].url, s.thumbMax || 480);
      }
      s.setProgress('업로드 준비 중…', 45);
      var prep = await window.galFirebase.httpsCallable('requestSoopImageUpload')({
        url: current.url, streamerId: current.streamerId,
        photos: chosen.map(function (p) { var t = thumbs[p.photoNo]; return { photoNo: p.photoNo, thumbFileSize: t.blob.size, width: t.width, height: t.height }; }),
      });
      var uploads = (prep.data && prep.data.uploads) || [];
      for (var j = 0; j < uploads.length; j++) {
        var u = uploads[j];
        s.setProgress('미리보기 올리는 중… (' + (j + 1) + '/' + uploads.length + ')', 50 + Math.round(30 * j / uploads.length));
        var put = await fetch(u.thumbUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumbs[u.photoNo].blob });
        if (!put.ok) throw new Error('미리보기 업로드 실패 (status ' + put.status + ')');
      }
      s.setProgress('등록 중…', 88);
      var reg = await window.galFirebase.httpsCallable('registerSoopImages')({
        imageIds: uploads.map(function (u) { return u.imageId; }), streamerName: who.name, category: category,
      });
      var ok = (reg.data && reg.data.registered || []).length; var bad = (reg.data && reg.data.failed || []).length;
      s.setProgress('완료!', 100);
      msg('✅ 사진 ' + ok + '장을 등록했어요.' + (bad ? ' (' + bad + '장은 실패)' : ''));
      window.galNoteUploaded && window.galNoteUploaded(ok);
      window.galSound && window.galSound.uploadSuccess();
      Object.keys(previewCache).forEach(function (k) { delete previewCache[k]; });
      current = null; picked = new Set(); urlInput.value = ''; render();
      s.done();
    } catch (err) {
      console.error('SOOP 사진 등록 실패', err);
      window.galSound && window.galSound.error(err);
      s.hideProgress();
      msg('❌ ' + errText(err));
      if (err && err.details && err.details.reason === 'daily-limit' && !err.details.hasPass) window.galOpenUploadPass && window.galOpenUploadPass();
    } finally { loadBtn.disabled = false; updateSubmit(); }
  });
})();
