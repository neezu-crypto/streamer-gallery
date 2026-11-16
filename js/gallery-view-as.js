//  관리자 보기 모드 전환(2026-11-17). 진짜 관리자에게만 보인다. 고른 모드는 이 탭에만 저장되고
//  (sessionStorage), 바꾸면 새로고침해 모든 화면·서버 판단을 그 모드로 다시 시작한다.
//  팬: 관리자 우회 없이 일반 이용자와 같은 열람 기간·결제·삭제 규칙. 스트리머: 관리자 방송국(오목지면시그) 본인.
(function () {
  'use strict';
  var KEY = 'galViewAs.v1';
  var LABELS = { '': '관리자', fan: '팬', streamer: '스트리머(오목지면시그)' };
  var box = null;

  function current() { return window.galViewAs ? window.galViewAs() : ''; }
  function setMode(v) {
    try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (_) {}
    location.reload();
  }

  function render() {
    if (!window.galRealAdmin) { if (box) { box.remove(); box = null; } return; }
    var mode = current();
    if (!box) {
      box = document.createElement('div');
      box.className = 'gal-viewas';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', '관리자 보기 모드');
      document.body.appendChild(box);
    }
    box.textContent = '';
    box.classList.toggle('active', !!mode);
    var label = document.createElement('span');
    label.className = 'gal-viewas-label';
    label.textContent = mode ? '👀 ' + LABELS[mode] + '(으)로 보는 중' : '보기 모드';
    box.appendChild(label);
    ['', 'fan', 'streamer'].forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = v === 'streamer' ? '스트리머' : LABELS[v];
      b.setAttribute('aria-pressed', String(mode === v));
      b.addEventListener('click', function () { if (mode !== v) setMode(v); });
      box.appendChild(b);
    });
    if (mode) {
      var warn = document.createElement('small');
      warn.textContent = '결제는 실제로 이루어져요';
      box.appendChild(warn);
    }
  }

  document.addEventListener('gal-auth-changed', render);
})();
