/* =========================================================================
   临界 · 紧急调度 — 程序化音频（WebAudio，无任何外部音频文件）
   内容：环境底噪 / 雨声 / 低频氛围 / 和声垫 / 调度与警情音效（无持续警笛）。
   设计原则：首次用户点击后才解锁声音（浏览器策略）；所有音量受设置控制；
            标签页隐藏时自动压低，避免后台扰民。
   回退办法：删除 emergency/ 目录或 revert；没有外部素材与授权问题。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var A = EM.audio = {
    ctx: null, ready: false, unlocked: false, settings: null,
    masterGain: null, musicGain: null, sfxGain: null, ambGain: null,
    padOscs: [], padFilter: null, sirenOsc: null, sirenGain: null,
    shimmerGain: null, rainGain: null, rainSource: null, humGain: null,
    chordIndex: 0, chordTimer: 0, beatTimer: 0, noiseBuffer: null, intensity: 0,
    lastPlay: {}
  };

  var CHORDS = [
    [110.00, 130.81, 164.81],   // Am
    [87.31, 110.00, 130.81],    // F
    [130.81, 164.81, 196.00],   // C
    [98.00, 123.47, 146.83]     // G
  ];

  A.init = function (settings) {
    this.settings = settings || this.settings || { volumeMaster: 0.8, volumeMusic: 0.55, volumeSfx: 0.8, volumeAmbience: 0.5, muted: false };
    if (this.ctx) return;
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      var ctx = this.ctx = new Ctx();
      var master = this.masterGain = ctx.createGain();
      master.connect(ctx.destination);
      var music = this.musicGain = ctx.createGain(); music.connect(master);
      var sfx = this.sfxGain = ctx.createGain(); sfx.connect(master);
      var amb = this.ambGain = ctx.createGain(); amb.connect(master);

      // 噪声素材
      var len = Math.floor(ctx.sampleRate * 2);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      // 环境雨声
      var rain = ctx.createBufferSource();
      rain.buffer = buf; rain.loop = true;
      var rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'bandpass'; rainFilter.frequency.value = 2200; rainFilter.Q.value = 0.4;
      var rainGain = this.rainGain = ctx.createGain(); rainGain.gain.value = 0;
      rain.connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(amb);
      rain.start();
      // 城市低频
      var hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 52;
      var humGain = this.humGain = ctx.createGain(); humGain.gain.value = 0;
      hum.connect(humGain); humGain.connect(amb); hum.start();

      // 和声垫
      var filter = this.padFilter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 520; filter.Q.value = 0.6;
      var padGain = ctx.createGain(); padGain.gain.value = 0.22;
      filter.connect(padGain); padGain.connect(music);
      var delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.42;
      var feedback = ctx.createGain(); feedback.gain.value = 0.28;
      padGain.connect(delay); delay.connect(feedback); feedback.connect(delay);
      var wet = ctx.createGain(); wet.gain.value = 0.35; delay.connect(wet); wet.connect(music);
      for (var v = 0; v < 3; v++) {
        var osc = ctx.createOscillator();
        osc.type = v === 1 ? 'sine' : 'triangle';
        osc.frequency.value = CHORDS[0][v];
        osc.detune.value = (v - 1) * 5;
        var g = ctx.createGain(); g.gain.value = 0.28;
        osc.connect(g); g.connect(filter);
        osc.start();
        this.padOscs.push(osc);
      }
      // 紧张高频
      var shim = ctx.createOscillator(); shim.type = 'sine'; shim.frequency.value = 880;
      var shimGain = this.shimmerGain = ctx.createGain(); shimGain.gain.value = 0;
      shim.connect(shimGain); shimGain.connect(music); shim.start();

      // v1.1：移除持续警笛，只保留短促的派遣/到场提示音。
      this.sirenOsc = null;
      this.sirenGain = null;

      this.ready = true;
      this.applySettings(this.settings);
    } catch (e) {
      this.ready = false;
      if (root.console) console.warn('[audio] init failed', e);
    }
  };

  A.applySettings = function (settings) {
    this.settings = settings;
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var master = settings.muted ? 0 : settings.volumeMaster;
    this.masterGain.gain.setTargetAtTime(master, t, 0.08);
    this.musicGain.gain.setTargetAtTime(settings.volumeMusic * 0.55, t, 0.1);
    this.sfxGain.gain.setTargetAtTime(settings.volumeSfx, t, 0.06);
    this.ambGain.gain.setTargetAtTime(settings.volumeAmbience * 0.7, t, 0.1);
  };

  A.unlock = function () {
    if (!this.ctx) this.init(this.settings);
    if (!this.ctx) return;
    var self = this;
    var resume = function () {
      if (self.ctx.state === 'suspended') self.ctx.resume().then(function () { self.unlocked = true; }).catch(function () { });
      else self.unlocked = true;
    };
    resume();
  };

  A.setActive = function (active) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var m = this.settings ? (this.settings.muted ? 0 : this.settings.volumeMaster) : 0.8;
    this.masterGain.gain.setTargetAtTime(active ? m : m * 0.25, t, 0.15);
  };

  A._tone = function (freq, dur, type, vol, slideTo, delay) {
    if (!this.ready || !this.unlocked) return;
    try {
      var ctx = this.ctx;
      var t0 = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { }
  };

  A._noise = function (dur, vol, freq, type, delay) {
    if (!this.ready || !this.unlocked || !this.noiseBuffer) return;
    try {
      var ctx = this.ctx;
      var t0 = ctx.currentTime + (delay || 0);
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      var f = ctx.createBiquadFilter();
      f.type = type || 'lowpass';
      f.frequency.value = freq || 400;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.1, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start(t0); src.stop(t0 + dur + 0.05);
    } catch (e) { }
  };

  A.play = function (name) {
    if (!this.ready || !this.unlocked) return;
    var now = this.ctx.currentTime;
    if (this.lastPlay[name] && now - this.lastPlay[name] < 0.05) return;
    this.lastPlay[name] = now;
    switch (name) {
      case 'click':
        this._tone(880, 0.05, 'sine', 0.025);
        break;
      case 'dispatch':
        this._tone(640, 0.1, 'square', 0.035);
        this._tone(960, 0.09, 'square', 0.03, null, 0.1);
        break;
      case 'arrive':
        this._tone(520, 0.09, 'sine', 0.05);
        this._tone(660, 0.12, 'sine', 0.04, null, 0.08);
        break;
      case 'resolve':
        this._tone(523, 0.16, 'sine', 0.05);
        this._tone(659, 0.18, 'sine', 0.045, null, 0.12);
        this._tone(784, 0.3, 'sine', 0.04, null, 0.24);
        break;
      case 'alert':
        this._tone(880, 0.08, 'square', 0.035);
        this._tone(880, 0.08, 'square', 0.035, null, 0.16);
        break;
      case 'critical':
        this._tone(740, 0.1, 'sawtooth', 0.045);
        this._tone(990, 0.1, 'sawtooth', 0.04, null, 0.14);
        this._tone(740, 0.14, 'sawtooth', 0.04, null, 0.28);
        break;
      case 'fail':
        this._tone(180, 0.45, 'sawtooth', 0.06, 70);
        this._noise(0.4, 0.08, 300, 'lowpass');
        break;
      case 'explosion':
        this._tone(70, 0.6, 'sine', 0.16, 30);
        this._noise(0.8, 0.22, 240, 'lowpass');
        this._noise(0.25, 0.1, 1600, 'highpass');
        break;
      case 'thunder':
        this._noise(1.5, 0.12, 180, 'lowpass');
        this._tone(48, 1.2, 'sine', 0.05, 32);
        break;
      case 'defeat':
        this._tone(330, 0.4, 'triangle', 0.06, 220);
        this._tone(220, 0.7, 'triangle', 0.05, 110, 0.35);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach(function (f, i) { A._tone(f, 0.28, 'sine', 0.045, null, i * 0.13); });
        break;
      case 'upgrade':
        this._tone(700, 0.08, 'triangle', 0.04);
        this._tone(1050, 0.12, 'triangle', 0.035, null, 0.07);
        break;
      case 'error':
        this._tone(220, 0.12, 'square', 0.03, 180);
        break;
    }
  };

  A.update = function (dt, sim, renderer) {
    if (!this.ready || !this.unlocked) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var settings = this.settings || {};
    // 和声进行
    this.chordTimer += dt;
    if (this.chordTimer > 9) {
      this.chordTimer = 0;
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      var chord = CHORDS[this.chordIndex];
      for (var i = 0; i < this.padOscs.length; i++) {
        this.padOscs[i].frequency.setTargetAtTime(chord[i], t, 2.2);
      }
    }
    // 低频脉冲
    this.beatTimer += dt;
    if (this.beatTimer > 2.1) {
      this.beatTimer = 0;
      if (this.musicGain && !settings.muted && settings.volumeMusic > 0) {
        try {
          var osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = 55;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          osc.connect(g); g.connect(this.musicGain);
          osc.start(t); osc.stop(t + 0.55);
        } catch (e) { }
      }
    }
    if (!sim) {
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0.05, t, 0.3);
      if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(0, t, 0.4);
      return;
    }
    var active = 0, critical = 0;
    for (var j = 0; j < sim.incidents.length; j++) {
      if (sim.incidents[j].status === 'active') { active++; if (sim.incidents[j].priority === 1) critical++; }
    }
    var intensity = Math.min(1, active / 5 + critical * 0.18);
    this.intensity = intensity;
    var weather = (sim.config && sim.config.weather) || 'rain';
    var rain = EM.data.WEATHERS[weather] ? EM.data.WEATHERS[weather].rain : 0.5;
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(rain * 0.09 * (0.6 + intensity * 0.4), t, 0.6);
    if (this.padFilter) this.padFilter.frequency.setTargetAtTime(460 + intensity * 420, t, 0.8);
    if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(critical > 0 ? 0.012 + critical * 0.004 : 0, t, 0.8);
    if (this.humGain) this.humGain.gain.setTargetAtTime(0.04, t, 0.8);
    if (renderer && renderer.consumeLightning && renderer.consumeLightning()) {
      this.play('thunder');
    }
  };

  A.suspend = function () {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(function () { });
  };
  A.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () { });
  };
})(window);
