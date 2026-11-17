// 갤러리 체험 튜토리얼(2026-11-17). 메신저 체험(streamer-messenger/js/tutorial.js)과 같은 방식.
// 실제 갤러리와 닮은 연습용 화면을 이 창 안에서만 띄운다. 서버 호출·DB 쓰기·로그인 없이 동작하고,
// 입력한 댓글·고른 사진은 창을 닫으면 사라진다. 기기에는 "체험을 끝냈는지"만 localStorage에 남긴다.
(function () {
  'use strict';
  var DONE_KEY = 'streamerGallery.tutorial.v1.done';
  var STREAMER = '몽글이';

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

  // 연습용 그림: 실제 이미지 대신 그라데이션+이모지 카드(외부 이미지를 불러오지 않는다).
  var SAMPLES = [
    { id: 1, emoji: '🌸', cat: 'fan-art', label: '팬아트', bg: 'linear-gradient(135deg,#ffd9e6,#ffeef4)', h: 1.3 },
    { id: 2, emoji: '🎮', cat: 'screenshot', label: '스크린샷', bg: 'linear-gradient(135deg,#dfe8ff,#f1f5ff)', h: 0.8 },
    { id: 3, emoji: '🐑', cat: 'fan-art', label: '팬아트', bg: 'linear-gradient(135deg,#fff1d6,#fffaf0)', h: 1 },
    { id: 4, emoji: '😂', cat: 'meme', label: '밈', bg: 'linear-gradient(135deg,#e6f7ea,#f4fcf6)', h: 1.1 },
    { id: 5, emoji: '✨', cat: 'ai-art', label: 'AI 일러스트', bg: 'linear-gradient(135deg,#efe4ff,#f8f3ff)', h: 1.25 },
    { id: 6, emoji: '▶', cat: 'catch', label: '캐치', bg: 'linear-gradient(135deg,#2b2f3a,#4a5163)', h: 0.75 },
  ];
  var CHIPS = [['all', '전체'], ['screenshot', '스샷'], ['fan-art', '팬'], ['meme', '밈'], ['catch', '캐치']];

  var STEPS = [
    { title: '카테고리로 골라 보기', hint: '왼쪽(모바일은 아래) 카테고리를 누르면 그 종류만 모아 볼 수 있어요. "팬" 칩을 눌러 팬아트만 골라 보세요.' },
    { title: '크게 보고 좋아요 누르기', hint: '마음에 드는 그림을 눌러 크게 보고, ♥ 버튼으로 좋아요를 눌러 보세요.' },
    { title: '댓글 남기기', hint: '그림 아래 입력창에 댓글을 쓰고 등록해 보세요. 실제 갤러리에서는 로그인한 이용자만 댓글을 쓸 수 있어요.' },
    { title: '내 사진 올리기', hint: '업로드에서 스트리머를 검색해 고르고, 카테고리와 사진을 골라 올려요. 하루에 올릴 수 있는 장수가 정해져 있어요.' },
    { title: 'SOOP 게시글·캐치 불러오기', hint: '스트리머 방송국의 전체 공개 게시글이나 캐치 링크를 넣으면 사진·영상을 골라 바로 등록할 수 있어요. 원본은 SOOP에서 그대로 보여 줘요.' },
  ];

  var backdrop = null, card = null;

  function close() {
    if (!backdrop || !backdrop.classList.contains('open')) return;
    clearTimers();
    backdrop.classList.remove('open');
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
    intro();
    if (!backdrop.classList.contains('open')) {
      backdrop.classList.add('open');
      window.galPushModal && window.galPushModal(close);
    }
  }

  function frame(step) {
    card.textContent = '';
    var x = btn('✕', 'gtut-close', close); x.setAttribute('aria-label', '체험 닫기');
    var head = el('header', 'gtut-head');
    head.appendChild(el('p', 'gtut-eyebrow', 'TRY · 갤러리 체험'));
    var title = el('h2', 'gtut-title', (step + 1) + '. ' + STEPS[step].title); title.id = 'gtut-title';
    head.appendChild(title);
    var progress = el('ol', 'gtut-progress');
    progress.setAttribute('aria-label', STEPS.length + '단계 중 ' + (step + 1) + '단계');
    STEPS.forEach(function (_, i) { progress.appendChild(el('li', i < step ? 'done' : i === step ? 'current' : '')); });
    var hint = el('p', 'gtut-hint', STEPS[step].hint); hint.setAttribute('role', 'status');
    var stage = el('div', 'gtut-stage');
    var foot = el('footer', 'gtut-foot');
    foot.appendChild(el('small', 'gtut-muted', '연습용 화면이에요 · 실제로 올라가거나 저장되지 않아요'));
    card.appendChild(x); card.appendChild(head); card.appendChild(progress); card.appendChild(hint); card.appendChild(stage); card.appendChild(foot);
    return { stage: stage, foot: foot, hint: hint };
  }
  function next(foot, label, fn) {
    var b = btn(label, 'gtut-btn gtut-primary', fn);
    foot.appendChild(b);
    b.focus();
    return b;
  }
  function shake(node) { node.classList.add('gtut-shake'); later(400, function () { node.classList.remove('gtut-shake'); }); }
  function thumb(s, extra) {
    var t = el('div', 'gtut-thumb' + (extra ? ' ' + extra : ''));
    t.style.background = s.bg;
    t.style.aspectRatio = String(1 / s.h);
    t.appendChild(el('span', 'gtut-thumb-emoji', s.emoji));
    if (s.cat === 'catch') t.appendChild(el('span', 'gtut-badge', '▶ 캐치'));
    return t;
  }

  function intro() {
    card.textContent = '';
    var x = btn('✕', 'gtut-close', close); x.setAttribute('aria-label', '체험 닫기');
    var title = el('h2', 'gtut-title', '1분 체험해 보기'); title.id = 'gtut-title';
    var copy = el('p', 'gtut-copy', '실제 갤러리처럼 눌러 보는 연습용 화면이에요. 로그인하지 않아도 되고, 고른 사진이나 쓴 댓글은 저장되거나 올라가지 않아요.');
    var list = el('ol', 'gtut-outline');
    STEPS.forEach(function (s) { list.appendChild(el('li', '', s.title)); });
    var start = btn('체험 시작하기', 'gtut-btn gtut-primary', function () { step0(); });
    card.appendChild(el('p', 'gtut-eyebrow', 'TRY GALLERY'));
    card.appendChild(x); card.appendChild(title); card.appendChild(copy); card.appendChild(list); card.appendChild(start);
    start.focus();
  }

  // 1단계: 카테고리 칩으로 거르기
  function step0() {
    var f = frame(0);
    var chips = el('div', 'gtut-chips');
    var grid = el('div', 'gtut-grid');
    function render(cat) {
      grid.textContent = '';
      SAMPLES.filter(function (s) { return cat === 'all' || s.cat === cat; }).forEach(function (s) { grid.appendChild(thumb(s)); });
    }
    CHIPS.forEach(function (c) {
      var chip = btn(c[1], 'gtut-chip' + (c[0] === 'all' ? ' active' : '') + (c[0] === 'fan-art' ? ' gtut-target' : ''), function () {
        chips.querySelectorAll('.gtut-chip').forEach(function (n) { n.classList.toggle('active', n === chip); n.classList.remove('gtut-target'); });
        render(c[0]);
        if (c[0] !== 'fan-art') { f.hint.textContent = '"' + c[1] + '"만 보여요. 이번엔 "팬" 칩을 눌러 팬아트만 골라 보세요.'; chips.children[2].classList.add('gtut-target'); return; }
        f.hint.textContent = '팬아트만 모였어요! 모바일에서는 아래 카테고리 버튼을 길게 눌러 고를 수 있어요.';
        if (!f.foot.querySelector('.gtut-primary')) next(f.foot, '다음', step1);
      });
      chips.appendChild(chip);
    });
    render('all');
    f.stage.appendChild(chips); f.stage.appendChild(grid);
  }

  // 2단계: 상세 열고 좋아요
  function step1() {
    var f = frame(1);
    var grid = el('div', 'gtut-grid');
    SAMPLES.filter(function (s) { return s.cat === 'fan-art'; }).forEach(function (s, i) {
      var t = thumb(s, i === 0 ? 'gtut-target gtut-clickable' : 'gtut-clickable');
      t.setAttribute('role', 'button'); t.tabIndex = 0;
      var go = function () { detail(f, s); };
      t.addEventListener('click', go);
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      grid.appendChild(t);
    });
    f.stage.appendChild(grid);
  }
  function detailShell(stage, s) {
    stage.textContent = '';
    var box = el('div', 'gtut-detail');
    box.appendChild(thumb(s, 'gtut-detail-img'));
    var panel = el('div', 'gtut-detail-panel');
    var row = el('div', 'gtut-detail-row');
    var like = btn('♡ 0', 'gtut-like');
    row.appendChild(like);
    row.appendChild(el('strong', '', STREAMER));
    row.appendChild(el('span', 'gtut-tag', s.label));
    panel.appendChild(row);
    var comments = el('div', 'gtut-comments');
    panel.appendChild(comments);
    box.appendChild(panel);
    stage.appendChild(box);
    return { like: like, comments: comments, panel: panel };
  }
  function detail(f, s) {
    var d = detailShell(f.stage, s);
    d.like.classList.add('gtut-target');
    d.like.addEventListener('click', function () {
      if (d.like.classList.contains('on')) return;
      d.like.classList.add('on'); d.like.classList.remove('gtut-target');
      d.like.textContent = '♥ 1';
      f.hint.textContent = '좋아요를 눌렀어요! 실제 갤러리에서는 그림을 한 번 더 누르면 화면 가득 크게 볼 수 있어요.';
      next(f.foot, '다음', function () { step2(s); });
    });
  }

  // 3단계: 댓글
  function step2(s) {
    var f = frame(2);
    var d = detailShell(f.stage, s);
    d.like.classList.add('on'); d.like.textContent = '♥ 1';
    d.comments.appendChild(commentRow('팬1', '색감 너무 예뻐요!'));
    var form = el('div', 'gtut-comment-form');
    var input = el('input', 'gtut-input gtut-target');
    input.type = 'text'; input.maxLength = 100; input.placeholder = '댓글을 입력하세요';
    input.setAttribute('aria-label', '연습용 댓글 입력');
    var send = btn('등록', 'gtut-btn', function () {
      var v = input.value.trim();
      if (!v) { shake(input); input.focus(); return; }
      d.comments.appendChild(commentRow('나', v, true));
      input.value = ''; input.disabled = true; send.disabled = true; input.classList.remove('gtut-target');
      f.hint.textContent = '댓글이 달렸어요! 내 댓글은 나중에 지울 수 있고, 불편한 그림·댓글은 ⋯ 메뉴에서 신고할 수 있어요.';
      next(f.foot, '다음', step3);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send.click(); } });
    form.appendChild(input); form.appendChild(send);
    d.panel.appendChild(form);
    input.focus();
  }
  function commentRow(name, text, mine) {
    var r = el('p', 'gtut-comment' + (mine ? ' mine' : ''));
    r.appendChild(el('strong', '', name + ' '));
    r.appendChild(document.createTextNode(text));
    return r;
  }

  // 4단계: 업로드(스트리머 검색 → 카테고리 → 사진 → 올리기)
  function step3() {
    var f = frame(3);
    var form = el('div', 'gtut-form');
    var search = el('input', 'gtut-input gtut-target');
    search.type = 'text'; search.placeholder = 'SOOP 스트리머 닉네임이나 아이디로 검색'; search.setAttribute('aria-label', '연습용 스트리머 검색');
    var results = el('div', 'gtut-results');
    var picked = el('p', 'gtut-picked');
    var cat = el('select', 'gtut-select');
    [['screenshot', '스크린샷'], ['fan-art', '팬아트'], ['meme', '밈']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; cat.appendChild(op); });
    cat.setAttribute('aria-label', '연습용 카테고리');
    var photos = el('div', 'gtut-photo-picks');
    var upload = btn('업로드하기', 'gtut-btn gtut-primary', null);
    upload.disabled = true;
    var bar = el('div', 'gtut-bar'); var fill = el('span', ''); bar.appendChild(fill); bar.hidden = true;
    var who = null, photo = null;
    function update() { upload.disabled = !(who && photo); if (!upload.disabled) upload.classList.add('gtut-target'); }
    function showResults() {
      results.textContent = '';
      if (!search.value.trim()) return;
      [[STREAMER, 'mongle'], ['몽글몽글', 'mongle2']].forEach(function (r) {
        results.appendChild(btn(r[0] + ' (' + r[1] + ')', 'gtut-result', function () {
          who = r[0]; results.textContent = ''; search.classList.remove('gtut-target');
          picked.textContent = '✅ 선택됨: ' + r[0];
          f.hint.textContent = '스트리머를 골랐어요. 카테고리를 확인하고 올릴 사진을 골라 보세요.';
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
      p.setAttribute('aria-pressed', 'false'); p.setAttribute('aria-label', '연습용 사진 ' + emo);
      photos.appendChild(p);
    });
    upload.addEventListener('click', function () {
      if (upload.disabled) return;
      upload.disabled = true; upload.classList.remove('gtut-target'); bar.hidden = false;
      var pct = 0;
      (function tick() {
        pct = Math.min(100, pct + 25); fill.style.width = pct + '%';
        if (pct < 100) { later(250, tick); return; }
        f.hint.textContent = '✅ 올렸어요! 실제로는 무료로 하루 10장까지 올릴 수 있고, 업로드 늘리기 이용권으로 더 올릴 수 있어요.';
        next(f.foot, '다음', step4);
      })();
    });
    form.appendChild(search); form.appendChild(results); form.appendChild(picked);
    form.appendChild(cat); form.appendChild(photos); form.appendChild(upload); form.appendChild(bar);
    f.stage.appendChild(form);
    search.focus();
  }

  // 5단계: SOOP 게시글·캐치 링크
  function step4() {
    var f = frame(4);
    var form = el('div', 'gtut-form');
    var row = el('div', 'gtut-row');
    var input = el('input', 'gtut-input');
    input.type = 'text'; input.placeholder = '게시글 또는 캐치 링크'; input.setAttribute('aria-label', '연습용 SOOP 링크');
    var fillBtn = btn('예시 링크 넣기', 'gtut-btn gtut-target', function () {
      input.value = 'https://www.sooplive.com/station/mongle/post/123';
      fillBtn.hidden = true; load.classList.add('gtut-target');
    });
    var load = btn('불러오기', 'gtut-btn', function () {
      if (!input.value.trim()) { shake(input); return; }
      load.classList.remove('gtut-target'); load.disabled = true;
      grid.textContent = '';
      [SAMPLES[0], SAMPLES[2], SAMPLES[4], SAMPLES[5]].forEach(function (s) {
        var t = thumb(s, 'gtut-clickable gtut-pick');
        t.setAttribute('role', 'button'); t.tabIndex = 0; t.setAttribute('aria-pressed', 'false');
        var toggle = function () {
          var on = t.getAttribute('aria-pressed') !== 'true';
          t.setAttribute('aria-pressed', String(on));
          var n = grid.querySelectorAll('[aria-pressed=true]').length;
          submit.disabled = !n; submit.textContent = n ? '고른 ' + n + '개 등록하기' : '등록할 사진·캐치를 골라 주세요';
          submit.classList.toggle('gtut-target', !!n);
        };
        t.addEventListener('click', toggle);
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        grid.appendChild(t);
      });
      f.hint.textContent = '사진 3장과 캐치 1개를 찾았어요. 등록할 것을 골라 보세요. 캐치는 상세에서 바로 재생되고 "캐치" 카테고리에 들어가요.';
      submit.hidden = false;
    });
    var grid = el('div', 'gtut-grid gtut-grid-4');
    var submit = btn('등록할 사진·캐치를 골라 주세요', 'gtut-btn gtut-primary', function () {
      submit.disabled = true; submit.classList.remove('gtut-target');
      grid.querySelectorAll('.gtut-pick').forEach(function (n) { n.style.pointerEvents = 'none'; });
      markDone();
      var done = el('div', 'gtut-done');
      done.appendChild(el('strong', '', '체험 완료! 🎉'));
      done.appendChild(el('p', '', '이제 실제 갤러리에서 그림을 보고, 좋아요·댓글을 남기고, 사진을 올려 보세요.'));
      f.stage.appendChild(done);
      if (!window.galTrusted && window.galOpenLoginModal) {
        f.foot.appendChild(btn('로그인하고 시작하기', 'gtut-btn', function () { close(); window.galOpenLoginModal(); }));
      }
      next(f.foot, '닫기', close);
    });
    submit.hidden = true; submit.disabled = true;
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
      var sub = el('small', 'gtut-muted', '로그인 없이 연습용 화면에서 눌러 볼 수 있어요'); sub.id = 'gtut-entry-sub';
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
