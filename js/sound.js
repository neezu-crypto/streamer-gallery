// 갤러리 액션 사운드(2026-09-06 추가) — dont-click-ads(shooter.js/racing.js/dodge.js)의
// Web Audio API 오실레이터 합성 패턴을 그대로 재사용한다. 별도 mp3/wav 파일을 만들거나
// 호스팅/라이선스를 신경 쓸 필요 없이 브라우저 자체 기능만으로 재생된다.
// 항상 켜짐(토글 없음) — 사용자 확정(2026-09-06), 최대 볼륨 0.15로 낮게 고정.
(function () {
  var MAX_VOLUME = 0.15;
  var ctx = null;

  function getCtx() {
    if (ctx) return ctx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    } catch (e) { return null; }
    return ctx;
  }

  // freqFrom과 freqTo가 같으면 단일음, 다르면 그 사이를 부드럽게 슬라이드.
  function playTone(freqFrom, freqTo, dur, vol, type) {
    var c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(function () {});
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || 'sine';
    var now = c.currentTime;
    osc.frequency.setValueAtTime(freqFrom, now);
    if (freqTo !== freqFrom) osc.frequency.linearRampToValueAtTime(freqTo, now + dur);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  // 여러 음을 순서대로(팡파레류) — noteDur/gap은 초 단위.
  function playSequence(freqs, noteDur, gap, vol, type) {
    freqs.forEach(function (f, i) {
      setTimeout(function () { playTone(f, f, noteDur, vol, type); }, i * (noteDur + gap) * 1000);
    });
  }

  window.galSound = {
    likeOn: function () { playTone(600, 900, 0.12, MAX_VOLUME, 'sine'); },
    likeOff: function () { playTone(500, 350, 0.08, MAX_VOLUME * 0.8, 'sine'); },
    commentSuccess: function () { playTone(700, 1000, 0.15, MAX_VOLUME, 'sine'); },
    uploadSuccess: function () { playSequence([523, 659, 784], 0.12, 0.03, MAX_VOLUME, 'sine'); },
    actionError: function () { playTone(180, 180, 0.15, MAX_VOLUME, 'sawtooth'); },
    reportSubmitted: function () { playTone(650, 650, 0.1, MAX_VOLUME * 0.9, 'sine'); },
    deleteConfirm: function () { playTone(400, 200, 0.15, MAX_VOLUME, 'sine'); },
    modalOpen: function () { playTone(800, 800, 0.05, MAX_VOLUME * 0.6, 'sine'); },
    modalClose: function () { playTone(500, 500, 0.05, MAX_VOLUME * 0.6, 'sine'); },
    adminAction: function () { playSequence([440, 440], 0.1, 0.05, MAX_VOLUME, 'square'); },
    cooldownWarning: function () { playTone(220, 220, 0.12, MAX_VOLUME, 'square'); },
    // 실패 사운드 분기 헬퍼 — 매크로 쿨다운(functions/resource-exhausted)이면 경고음,
    // 그 외 일반 오류면 기본 에러음. 각 catch 블록에서 실제 에러 객체를 그대로 넘기면 된다.
    error: function (e) {
      if (e && e.code === 'functions/resource-exhausted') this.cooldownWarning();
      else this.actionError();
    },
  };
})();
