// 갤러리 체험 튜토리얼(2026-11-17). 메신저 체험(streamer-messenger/js/tutorial.js)과 같은 방식.
// 실제 갤러리 데이터를 "읽기만" 하면서 진행한다(2026-11-17 개편):
//  - 그림·스트리머·카테고리·좋아요 수는 갤러리가 이미 불러온 공개 목록(window.galAllImages)을 그대로 쓴다(추가 서버 호출 없음).
//  - 댓글은 고른 그림 하나의 공개 댓글을 1회 읽는다(상세를 한 번 여는 것과 같은 양).
//  - 스트리머 검색은 서버 검색 대신 불러온 목록 안에서만 찾는다.
//  - 좋아요·댓글·업로드·등록은 이 창 안에서만 보이고 서버로 보내지 않는다(DB 쓰기 없음).
// 목록이 아직 없거나 비어 있으면 예시 그림으로 대신한다. 기기에는 "체험을 끝냈는지"만 localStorage에 남긴다.
(function () {
  'use strict';
  var DONE_KEY = 'streamerGallery.tutorial.v1.done';
  var LABELS = { screenshot: '스크린샷', 'ai-art': 'AI 일러스트', 'fan-art': '팬아트', meme: '밈', etc: '기타', catch: '캐치' };
  var SHORT = { all: '전체', screenshot: '스샷', 'ai-art': 'AI', 'fan-art': '팬', meme: '밈', etc: '기타', catch: '캐치' };

  function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function isDone() { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (_) { return false; } }
  function markDone() { try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {} }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, className, onClick) {
    var b = el('button', className, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  var timers = [];
  function later(ms, fn) { timers.push(window.setTimeout(fn, reduceMotion() ? 0 : ms)); }
  function clearTimers() { timers.forEach(function (t) { window.clearTimeout(t); }); timers = []; }

  // ---------- 데이터: 실제 공개 목록 → 체험용 항목 ----------
  var SAMPLES = [
    { id: 's1', emoji: '🌸', cat: 'fan-art', bg: 'linear-gradient(135deg,#ffd9e6,#ffeef4)', ratio: 0.77, streamer: '몽글이', likes: 12 },
    { id: 's2', emoji: '🎮', cat: 'screenshot', bg: 'linear-gradient(135deg,#dfe8ff,#f1f5ff)', ratio: 1.25, streamer: '몽글이', likes: 5 },
    { id: 's3', emoji: '🐑', cat: 'fan-art', bg: 'linear-gradient(135deg,#fff1d6,#fffaf0)', ratio: 1, streamer: '몽글이', likes: 8 },
    { id: 's4', emoji: '😂', cat: 'meme', bg: 'linear-gradient(135deg,#e6f7ea,#f4fcf6)', ratio: 0.9, streamer: '여우비', likes: 3, soop: true },
    { id: 's5', emoji: '✨', cat: 'ai-art', bg: 'linear-gradient(135deg,#efe4ff,#f8f3ff)', ratio: 0.8, streamer: '여우비', likes: 9, soop: true },
    { id: 's6', emoji: '▶', cat: 'catch', bg: 'linear-gradient(135deg,#2b2f3a,#4a5163)', ratio: 1.78, streamer: '몽글이', likes: 2, soop: true, isCatch: true },
  ];
  var data = { real: false, items: [] };

  function loadData() {
    var hidden = window.galHiddenImages || {};
    var list = (window.galAllImages || []).filter(function (i) { return i && i.id && i.thumbUrl && !hidden[i.id] && !i.sourceRemovedAt; });
    if (list.length < 3) { data = { real: false, items: SAMPLES.slice() }; return; }
    data = {
      real: true,
      items: list.map(function (i) {
        return {
          id: i.id, cat: i.category || 'etc', thumbUrl: i.thumbUrl, streamer: i.streamerName || '익명', streamerId: i.streamerId || '',
          likes: Number(i.likeCount) || 0, ratio: (i.width > 0 && i.height > 0) ? i.width / i.height : 1,
          soop: i.source === 'soop', isCatch: i.mediaType === 'catch', postUrl: i.sourcePostUrl || '',
        };
      }),
    };
  }
  function byCat(cat) { return data.items.filter(function (i) { return cat === 'all' || i.cat === cat; }); }

  function thumb(item, extra) {
    var t = el('div', 'gtut-thumb' + (extra ? ' ' + extra : ''));
    t.style.aspectRatio = String(Math.min(2, Math.max(0.6, item.ratio || 1)));
    if (item.thumbUrl) {
      var img = el('img', '');
      img.src = item.thumbUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      t.appendChild(img);
    } else {
      t.style.background = item.bg;
      t.appendChild(el('span', 'gtut-thumb-emoji', item.emoji));
    }
    if (item.isCatch) t.appendChild(el('span', 'gtut-badge', '▶ 캐치'));
    return t;
  }
  function clickable(node, fn) {
    node.classList.add('gtut-clickable');
    node.setAttribute('role', 'button'); node.tabIndex = 0;
    node.addEventListener('click', fn);
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }

  var STEPS = [
    { title: '카테고리로 골라 보기' },
    { title: '크게 보고 좋아요 누르기', hint: '마음에 드는 그림을 눌러 크게 보고, ♥ 버튼으로 좋아요를 눌러 보세요.' },
    { title: '댓글 남기기', hint: '입력창에 댓글을 쓰고 등록해 보세요. 실제 갤러리에서는 로그인한 이용자만 댓글을 쓸 수 있어요.' },
    { title: '내 사진 올리기', hint: '업로드에서 스트리머를 검색해 고르고, 카테고리와 사진을 골라 올려요. 하루에 올릴 수 있는 장수가 정해져 있어요.' },
    { title: 'SOOP 게시글·캐치 불러오기', hint: '스트리머 방송국의 전체 공개 게시글이나 캐치 링크를 넣으면 사진·영상을 골라 바로 등록할 수 있어요. 원본은 SOOP에서 그대로 보여 줘요.' },
  ];

  var backdrop = null, card = null;
  var picked = null; // 2~3단계에서 고른 그림

  function close() {
    if (!backdrop || !backdrop.classList.contains('open')) return;
    clearTimers();
    backdrop.classList.remove('open');
    card.textContent = ''; // 체험 중 남긴 좋아요·댓글은 창을 닫으면 사라진다
    window.galPopModal && window.galPopModal(close);
    refreshEntry();
    var opener = document.getElementById('gtut-open');
    if (opener) opener.focus();
  }
  function ensure() {
    if (backdrop) return;
    backdrop = el('div', 'gtut-backdrop');
    card = el('section', 'gtut-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'gtut-title');
    backdrop.appendChild(card);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);
  }
  function open() {
    ensure();
    clearTimers();
    loadData();
    picked = null;
    intro();
    if (!backdrop.classList.contains('open')) {
      backdrop.classList.add('open');
      window.galPushModal && window.galPushModal(close);
    }
  }

  function footNote() {
    return data.real ? '실제 갤러리 그림이에요 · 누른 좋아요·댓글·등록은 내 화면에만 보이고 실제로 반영되지 않아요'
      : '예시 그림이에요 · 실제로 올라가거나 저장되지 않아요';
  }
  function frame(step, hint) {
    card.textContent = '';
    var x = btn('✕', 'gtut-close', close); x.setAttribute('aria-label', '체험 닫기');
    var head = el('header', 'gtut-head');
    head.appendChild(el('p', 'gtut-eyebrow', 'TRY · 갤러리 체험'));
    var title = el('h2', 'gtut-title', (step + 1) + '. ' + STEPS[step].title); title.id = 'gtut-title';
    head.appendChild(title);
    var progress = el('ol', 'gtut-progress');
    progress.setAttribute('aria-label', STEPS.length + '단계 중 ' + (step + 1) + '단계');
    STEPS.forEach(function (_, i) { progress.appendChild(el('li', i < step ? 'done' : i === step ? 'current' : '')); });
    var hintEl = el('p', 'gtut-hint', hint || STEPS[step].hint); hintEl.setAttribute('role', 'status');
    var stage = el('div', 'gtut-stage');
    var foot = el('footer', 'gtut-foot');
    foot.appendChild(el('small', 'gtut-muted', footNote()));
    card.appendChild(x); card.appendChild(head); card.appendChild(progress); card.appendChild(hintEl); card.appendChild(stage); card.appendChild(foot);
    return { stage: stage, foot: foot, hint: hintEl };
  }
  function next(foot, label, fn) {
    var b = btn(label, 'gtut-btn gtut-primary', fn);
    foot.appendChild(b);
    b.focus();
    return b;
  }
  function shake(node) { node.classList.add('gtut-shake'); later(400, function () { node.classList.remove('gtut-shake'); }); }

  function intro() {
    card.textContent = '';
    var x = btn('✕', 'gtut-close', close); x.setAttribute('aria-label', '체험 닫기');
    var title = el('h2', 'gtut-title', '1분 체험해 보기'); title.id = 'gtut-title';
    var copy = el('p', 'gtut-copy', data.real
      ? '지금 갤러리에 올라와 있는 실제 그림으로 눌러 봐요. 로그인하지 않아도 되고, 누른 좋아요·댓글·업로드는 내 화면에만 보이고 실제로 반영되지 않아요.'
      : '연습용 그림으로 눌러 봐요. 로그인하지 않아도 되고, 고른 사진이나 쓴 댓글은 저장되거나 올라가지 않아요.');
    var list = el('ol', 'gtut-outline');
    STEPS.forEach(function (s) { list.appendChild(el('li', '', s.title)); });
    var start = btn('체험 시작하기', 'gtut-btn gtut-primary', step0);
    card.appendChild(el('p', 'gtut-eyebrow', 'TRY GALLERY'));
    card.appendChild(x); card.appendChild(title); card.appendChild(copy); card.appendChild(list); card.appendChild(start);
    start.focus();
  }

  // 1단계: 실제 목록에 있는 카테고리 칩으로 거르기
  function step0() {
    var counts = {};
    data.items.forEach(function (i) { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    var cats = ['screenshot', 'ai-art', 'fan-art', 'meme', 'etc', 'catch'].filter(function (c) { return counts[c]; });
    // 그림이 가장 많은 카테고리(전체와 다른 것)를 눌러 보게 한다.
    var target = cats.slice().sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var f = frame(0, '왼쪽(모바일은 아래) 카테고리를 누르면 그 종류만 모아 볼 수 있어요. "' + SHORT[target] + '" 칩을 눌러 ' + LABELS[target] + '만 골라 보세요.');
    var chips = el('div', 'gtut-chips');
    var grid = el('div', 'gtut-grid');
    var targetChip = null;
    function render(cat) {
      grid.textContent = '';
      byCat(cat).slice(0, 9).forEach(function (i) { grid.appendChild(thumb(i)); });
    }
    ['all'].concat(cats).forEach(function (c) {
      var chip = btn(SHORT[c] + (c === 'all' ? '' : ' ' + counts[c]), 'gtut-chip' + (c === 'all' ? ' active' : '') + (c === target ? ' gtut-target' : ''), function () {
        chips.querySelectorAll('.gtut-chip').forEach(function (n) { n.classList.toggle('active', n === chip); n.classList.remove('gtut-target'); });
        render(c);
        if (c !== target) {
          f.hint.textContent = '"' + SHORT[c] + '"만 보여요. 이번엔 "' + SHORT[target] + '" 칩을 눌러 보세요.';
          targetChip.classList.add('gtut-target');
          return;
        }
        f.hint.textContent = LABELS[target] + '만 모였어요! 모바일에서는 아래 카테고리 버튼을 길게 눌러 고를 수 있어요.';
        if (!f.foot.querySelector('.gtut-primary')) next(f.foot, '다음', function () { step1(target); });
      });
      if (c === target) targetChip = chip;
      chips.appendChild(chip);
    });
    render('all');
    f.stage.appendChild(chips); f.stage.appendChild(grid);
  }

  // 2단계: 상세 열고 좋아요(내 화면에서만 +1)
  function step1(cat) {
    var f = frame(1);
    var grid = el('div', 'gtut-grid');
    byCat(cat).slice(0, 6).forEach(function (i, n) {
      var t = thumb(i, n === 0 ? 'gtut-target' : '');
      clickable(t, function () { picked = i; detail(f, i); });
      grid.appendChild(t);
    });
    f.stage.appendChild(grid);
  }
  function detailShell(stage, item, liked) {
    stage.textContent = '';
    var box = el('div', 'gtut-detail' + ((item.ratio || 1) >= 1.2 ? ' gtut-detail-wide' : '')); // 가로 이미지는 상세를 아래로(실제 상세 창과 같게)
    box.appendChild(thumb(item, 'gtut-detail-img'));
    var panel = el('div', 'gtut-detail-panel');
    var row = el('div', 'gtut-detail-row');
    var like = btn((liked ? '♥ ' : '♡ ') + (item.likes + (liked ? 1 : 0)), 'gtut-like' + (liked ? ' on' : ''));
    row.appendChild(like);
    row.appendChild(el('strong', '', item.streamer));
    row.appendChild(el('span', 'gtut-tag', LABELS[item.cat] || item.cat));
    panel.appendChild(row);
    var comments = el('div', 'gtut-comments');
    panel.appendChild(comments);
    box.appendChild(panel);
    stage.appendChild(box);
    return { like: like, comments: comments, panel: panel };
  }
  function detail(f, item) {
    var d = detailShell(f.stage, item, false);
    d.like.classList.add('gtut-target');
    d.like.addEventListener('click', function () {
      if (d.like.classList.contains('on')) return;
      d.like.classList.add('on'); d.like.classList.remove('gtut-target');
      d.like.textContent = '♥ ' + (item.likes + 1);
      f.hint.textContent = '좋아요를 눌렀어요! (체험이라 내 화면에서만 올라가요) 실제 갤러리에서는 그림을 한 번 더 누르면 화면 가득 크게 볼 수 있어요.';
      next(f.foot, '다음', step2);
    });
  }

  // 3단계: 실제 공개 댓글을 1회 읽어 보여 주고, 내 댓글은 화면에만 붙인다.
  function readComments(item) {
    if (!data.real || !window.galFirebase || !window.galDb) return Promise.resolve([{ text: '색감 너무 예뻐요!' }]);
    var F = window.galFirebase;
    return F.get(F.query(F.ref(window.galDb, 'gallery/commentsPublic/' + item.id), F.limitToLast(5)))
      .then(function (snap) {
        var v = snap.val() || {};
        return Object.keys(v).map(function (k) { return v[k]; }).filter(function (c) { return c && c.text; })
          .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      })
      .catch(function () { return []; });
  }
  function step2() {
    var item = picked;
    var f = frame(2);
    var d = detailShell(f.stage, item, true);
    var status = el('p', 'gtut-muted', '댓글을 불러오는 중…');
    d.comments.appendChild(status);
    readComments(item).then(function (list) {
      if (!card.contains(d.comments)) return;
      status.remove();
      if (!list.length) d.comments.appendChild(el('p', 'gtut-muted', '아직 댓글이 없어요. 첫 댓글을 남겨 보세요.'));
      list.forEach(function (c) { d.comments.appendChild(commentRow('', String(c.text).slice(0, 200))); });
    });
    var form = el('div', 'gtut-comment-form');
    var input = el('input', 'gtut-input gtut-target');
    input.type = 'text'; input.maxLength = 100; input.placeholder = '댓글을 입력하세요';
    input.setAttribute('aria-label', '연습용 댓글 입력');
    var send = btn('등록', 'gtut-btn', function () {
      var v = input.value.trim();
      if (!v) { shake(input); input.focus(); return; }
      d.comments.appendChild(commentRow('나(체험)', v, true));
      input.value = ''; input.disabled = true; send.disabled = true; input.classList.remove('gtut-target');
      f.hint.textContent = '댓글이 달렸어요! (내 화면에만 보여요) 실제로는 내 댓글을 지울 수 있고, 불편한 그림·댓글은 ⋯ 메뉴에서 신고할 수 있어요.';
      next(f.foot, '다음', step3);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send.click(); } });
    form.appendChild(input); form.appendChild(send);
    d.panel.appendChild(form);
    input.focus();
  }
  function commentRow(name, text, mine) {
    var r = el('p', 'gtut-comment' + (mine ? ' mine' : ''));
    if (name) r.appendChild(el('strong', '', name + ' '));
    r.appendChild(document.createTextNode(text));
    return r;
  }

  // 4단계: 업로드. 스트리머 검색은 불러온 목록 안에서만 찾는다(서버 검색 호출 없음).
  function streamerList() {
    var seen = {}, out = [];
    data.items.forEach(function (i) {
      var key = i.streamerId || i.streamer;
      if (seen[key]) return;
      seen[key] = 1; out.push({ name: i.streamer, id: i.streamerId });
    });
    return out;
  }
  function step3() {
    var f = frame(3);
    var streamers = streamerList();
    var form = el('div', 'gtut-form');
    var search = el('input', 'gtut-input gtut-target');
    search.type = 'text';
    search.placeholder = '스트리머 닉네임이나 아이디로 검색 (예: ' + (streamers[0] ? streamers[0].name : '몽글이') + ')';
    search.setAttribute('aria-label', '연습용 스트리머 검색');
    var results = el('div', 'gtut-results');
    var pickedEl = el('p', 'gtut-picked');
    var cat = el('select', 'gtut-select');
    ['screenshot', 'ai-art', 'fan-art', 'meme', 'etc'].forEach(function (c) { var op = el('option', '', LABELS[c]); op.value = c; cat.appendChild(op); });
    cat.setAttribute('aria-label', '연습용 카테고리');
    var photos = el('div', 'gtut-photo-picks');
    var upload = btn('업로드하기', 'gtut-btn gtut-primary', null);
    upload.disabled = true;
    var bar = el('div', 'gtut-bar'); var fill = el('span', ''); bar.appendChild(fill); bar.hidden = true;
    var who = null, photo = null;
    function update() { upload.disabled = !(who && photo); upload.classList.toggle('gtut-target', !upload.disabled); }
    function showResults() {
      results.textContent = '';
      var q = search.value.trim().toLowerCase();
      if (!q) return;
      var hits = streamers.filter(function (s) { return s.name.toLowerCase().indexOf(q) !== -1 || (s.id && s.id.indexOf(q) !== -1); }).slice(0, 5);
      if (!hits.length) { results.appendChild(el('p', 'gtut-muted', '갤러리에 있는 스트리머 중에서 찾지 못했어요. 다른 이름으로 검색해 보세요.')); return; }
      hits.forEach(function (s) {
        results.appendChild(btn(s.name + (s.id ? ' (' + s.id + ')' : ''), 'gtut-result', function () {
          who = s.name; results.textContent = ''; search.classList.remove('gtut-target');
          pickedEl.textContent = '✅ 선택됨: ' + s.name;
          f.hint.textContent = '스트리머를 골랐어요. 카테고리를 확인하고 내 기기에서 올릴 사진을 골라 보세요.';
          photos.classList.add('gtut-target-group');
          update();
        }));
      });
    }
    search.addEventListener('input', showResults);
    ['🌷', '🎂', '🌙'].forEach(function (emo) {
      var p = btn(emo, 'gtut-photo', function () {
        photo = emo;
        photos.querySelectorAll('.gtut-photo').forEach(function (n) { n.setAttribute('aria-pressed', String(n === p)); });
        photos.classList.remove('gtut-target-group');
        update();
      });
      p.setAttribute('aria-pressed', 'false'); p.setAttribute('aria-label', '내 기기 사진(예시) ' + emo);
      photos.appendChild(p);
    });
    upload.addEventListener('click', function () {
      if (upload.disabled) return;
      upload.disabled = true; upload.classList.remove('gtut-target'); bar.hidden = false;
      var pct = 0;
      (function tick() {
        pct = Math.min(100, pct + 25); fill.style.width = pct + '%';
        if (pct < 100) { later(250, tick); return; }
        f.hint.textContent = '✅ 올렸어요! (체험이라 실제로는 올라가지 않아요) 무료로 하루 5장까지 올릴 수 있고, 업로드 늘리기 이용권으로 더 올릴 수 있어요.';
        next(f.foot, '다음', step4);
      })();
    });
    form.appendChild(search); form.appendChild(results); form.appendChild(pickedEl);
    form.appendChild(el('small', 'gtut-muted', '내 기기 사진(예시) 고르기'));
    form.appendChild(cat); form.appendChild(photos); form.appendChild(upload); form.appendChild(bar);
    f.stage.appendChild(form);
    search.focus();
  }

  // 5단계: 실제로 SOOP에서 불러온 공개 항목(같은 게시글 사진·캐치)을 예시로 보여 준다.
  function soopExample() {
    var soop = data.items.filter(function (i) { return i.soop; });
    if (!soop.length) return null;
    var post = soop.filter(function (i) { return !i.isCatch && i.postUrl; });
    var groups = {};
    post.forEach(function (i) { (groups[i.postUrl] = groups[i.postUrl] || []).push(i); });
    var best = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; })[0];
    var picks = best ? groups[best].slice(0, 3) : [];
    var catchItem = soop.filter(function (i) { return i.isCatch; })[0];
    if (catchItem) picks.push(catchItem);
    if (!picks.length) return null;
    return { url: best || (catchItem && catchItem.postUrl) || '', items: picks };
  }
  function step4() {
    var f = frame(4);
    var ex = soopExample() || { url: 'https://www.sooplive.com/station/mongle/post/123', items: [SAMPLES[0], SAMPLES[2], SAMPLES[4], SAMPLES[5]] };
    var form = el('div', 'gtut-form');
    var row = el('div', 'gtut-row');
    var input = el('input', 'gtut-input');
    input.type = 'text'; input.placeholder = '게시글 또는 캐치 링크'; input.setAttribute('aria-label', '연습용 SOOP 링크');
    var grid = el('div', 'gtut-grid gtut-grid-4');
    var submit = btn('등록할 사진·캐치를 골라 주세요', 'gtut-btn gtut-primary', null);
    submit.hidden = true; submit.disabled = true;
    var load = btn('불러오기', 'gtut-btn', function () {
      if (!input.value.trim()) { shake(input); return; }
      load.classList.remove('gtut-target'); load.disabled = true;
      grid.textContent = '';
      ex.items.forEach(function (s) {
        var t = thumb(s, 'gtut-pick');
        t.setAttribute('aria-pressed', 'false');
        clickable(t, function () {
          var on = t.getAttribute('aria-pressed') !== 'true';
          t.setAttribute('aria-pressed', String(on));
          var n = grid.querySelectorAll('[aria-pressed=true]').length;
          submit.disabled = !n; submit.textContent = n ? '고른 ' + n + '개 등록하기' : '등록할 사진·캐치를 골라 주세요';
          submit.classList.toggle('gtut-target', !!n);
        });
        grid.appendChild(t);
      });
      var photosN = ex.items.filter(function (i) { return !i.isCatch; }).length;
      var catchN = ex.items.length - photosN;
      f.hint.textContent = (photosN ? '사진 ' + photosN + '장' : '') + (photosN && catchN ? '과 ' : '') + (catchN ? '캐치 ' + catchN + '개' : '') +
        '를 찾았어요. 등록할 것을 골라 보세요.' + (catchN ? ' 캐치는 상세에서 바로 재생되고 "캐치" 카테고리에 들어가요.' : '');
      submit.hidden = false;
    });
    var fillBtn = btn(data.real && soopExample() ? '갤러리에 있는 SOOP 링크 넣기' : '예시 링크 넣기', 'gtut-btn gtut-target', function () {
      input.value = ex.url;
      fillBtn.hidden = true; load.classList.add('gtut-target');
    });
    submit.addEventListener('click', function () {
      submit.disabled = true; submit.classList.remove('gtut-target');
      grid.querySelectorAll('.gtut-pick').forEach(function (n) { n.style.pointerEvents = 'none'; });
      markDone();
      var done = el('div', 'gtut-done');
      done.appendChild(el('strong', '', '체험 완료! 🎉'));
      done.appendChild(el('p', '', '이제 실제 갤러리에서 그림을 보고, 좋아요·댓글을 남기고, 사진을 올려 보세요. 체험 중 누른 것은 반영되지 않았어요.'));
      f.stage.appendChild(done);
      if (!window.galTrusted && window.galOpenLoginModal) {
        f.foot.appendChild(btn('로그인하고 시작하기', 'gtut-btn', function () { close(); window.galOpenLoginModal(); }));
      }
      next(f.foot, '닫기', close);
    });
    row.appendChild(input); row.appendChild(load);
    form.appendChild(row); form.appendChild(fillBtn); form.appendChild(grid); form.appendChild(submit);
    f.stage.appendChild(form);
    fillBtn.focus();
  }

  // 시작 버튼: 사이드바(데스크톱)와 그리드 위 안내(모바일 포함).
  function refreshEntry() {
    var chip = document.getElementById('gtut-open');
    if (chip) chip.textContent = isDone() ? '🎈 체험 다시 해보기' : '🎈 처음이라면 1분 체험해 보기';
    var sub = document.getElementById('gtut-entry-sub');
    if (sub) sub.hidden = isDone();
  }
  function mount() {
    var main = document.querySelector('.main-content');
    var grid = document.getElementById('gallery-grid');
    if (main && grid && !document.getElementById('gtut-open')) {
      var row = el('div', 'gtut-entry');
      var b = btn('', 'gtut-entry-btn', open); b.id = 'gtut-open';
      var sub = el('small', 'gtut-muted', '로그인 없이 실제 갤러리 그림으로 눌러 볼 수 있어요'); sub.id = 'gtut-entry-sub';
      row.appendChild(b); row.appendChild(sub);
      main.insertBefore(row, grid);
    }
    var divider = document.querySelector('.sidebar .side-divider');
    if (divider && !document.getElementById('sidebar-tutorial-btn')) {
      var s = btn('', 'side-btn', open); s.id = 'sidebar-tutorial-btn'; s.title = '1분 체험';
      s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/></svg><span class="side-label">체험</span>';
      divider.parentNode.insertBefore(s, divider);
    }
    refreshEntry();
  }
  window.galOpenTutorial = open;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
