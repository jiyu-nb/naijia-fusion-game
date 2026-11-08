/**
 * 《这崽随谁》 src/audio.js  (owner: scenes-audio)
 * ------------------------------------------------------------------
 * 全部音效都由 WebAudio 程序化合成，零外链音频文件。
 *
 * 音量：主总线 ≈ -10.5 dB，单个音色峰值 ≤ 0.6，实际输出约 -18 dBFS，
 *       克制、不刺耳；mute 后主总线增益归零（完全静音，但所有方法仍可调用）。
 * 安全：所有公开方法都包在 try/catch 里，任何环境（无 AudioContext / Node /
 *       浏览器策略拦截）都不会抛异常；未 unlock 前调用只是空转。
 *
 * 对外 API（见 docs/CONTRACT.md 第 2 节）：
 *   audio.ready / audio.muted
 *   audio.unlock() / audio.toggleMute() -> bool
 *   audio.alarm(on) / hop() / flip() / snooze() / ding() / bubble() / pop() / tick()
 */

const MASTER_VOLUME = 0.3; // ≈ -10.5 dB，配合单音峰值得到 ≈ -18 dBFS 的听感
const ALARM_STEP = 1.0; // 双音闹铃一轮的周期（秒）
const ALARM_LOOKAHEAD = 0.55; // 提前排程的时间窗
const ALARM_TICK_MS = 220; // 排程器心跳

const noop = () => {};

/* ------------------------------------------------------------------ 状态 */

let ctx = null;
let master = null;
let alarmBus = null;
let noiseBuffer = null;

let muted = false;
let alarmOn = false;
let alarmTimer = 0;
let alarmNextTime = 0;
let autoUnlockBound = false;
let fusionAudio = null;

function getFusionAudio() {
  if (!fusionAudio && typeof Audio !== 'undefined') {
    fusionAudio = new Audio('/assets/fusion-sound.mp4');
    fusionAudio.preload = 'auto';
  }
  return fusionAudio;
}

/** 把任何可能抛错的逻辑吞掉，音效绝不打断游戏逻辑。 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    return fallback;
  }
}

function ensureCtx() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  try {
    ctx = new AudioCtor({ latencyHint: 'interactive' });
  } catch (err) {
    ctx = null;
    return null;
  }
  try {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    alarmBus = ctx.createGain();
    alarmBus.gain.value = 1;
    alarmBus.connect(master);
  } catch (err) {
    ctx = null;
    master = null;
    alarmBus = null;
    return null;
  }
  return ctx;
}

function resumeIfNeeded() {
  if (!ctx) return;
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    safe(() => {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    });
  }
}

/** 统一入口：确保 context、处理 mute、捕获一切异常。 */
function play(fn) {
  safe(() => {
    const c = ensureCtx();
    if (!c || !master) return;
    resumeIfNeeded();
    if (muted) return; // 静音时不起新节点（也不报错）
    fn(c, c.currentTime + 0.006, master);
  });
}

/* ------------------------------------------------------------------ 基础音色 */

function getNoise(c) {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = Math.max(1, Math.floor(c.sampleRate * 1.0));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/**
 * 一个带包络的振荡器。
 * opts: { type, f0, f1, t, dur, peak, dest, glide: 'exp'|'lin' }
 */
function blip(c, opts) {
  const t = opts.t;
  const dur = Math.max(0.02, opts.dur || 0.12);
  const end = t + dur;
  const peak = Math.max(0.0002, Math.min(0.9, opts.peak == null ? 0.3 : opts.peak));
  const osc = c.createOscillator();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(20, opts.f0 || 440), t);
  const f1 = opts.f1 == null ? opts.f0 || 440 : opts.f1;
  if (Math.abs(f1 - (opts.f0 || 440)) > 0.5) {
    if (opts.glide === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(20, f1), end);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), end);
  }
  const g = c.createGain();
  const attack = Math.min(0.02, dur * 0.3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(g);
  g.connect(opts.dest || master);
  osc.start(t);
  osc.stop(end + 0.02);
  return osc;
}

/**
 * 一段带包络的滤波噪声（whoosh / 噗 / 咔哒）。
 * opts: { t, dur, type, f0, f1, q, peak, attack, dest }
 */
function noiseHit(c, opts) {
  const t = opts.t;
  const dur = Math.max(0.02, opts.dur || 0.2);
  const peak = Math.max(0.0002, Math.min(0.9, opts.peak == null ? 0.2 : opts.peak));
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = opts.type || 'bandpass';
  flt.Q.value = opts.q == null ? 1 : opts.q;
  const f0 = Math.max(30, opts.f0 || 900);
  flt.frequency.setValueAtTime(f0, t);
  if (opts.f1 && Math.abs(opts.f1 - f0) > 1) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, opts.f1), t + dur);
  }
  const g = c.createGain();
  const attack = Math.min(opts.attack == null ? 0.02 : opts.attack, dur * 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.004, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(opts.dest || master);
  src.start(t);
  src.stop(t + dur + 0.02);
  return src;
}

/* ------------------------------------------------------------------ 闹铃循环 */

function scheduleTwoTone(c, t) {
  const bus = alarmBus || master;
  if (!bus) return;
  // 双音：高 → 低，两颗铃铛互相敲
  blip(c, { type: 'triangle', f0: 1046.5, f1: 1046.5, t, dur: 0.12, peak: 0.3, dest: bus });
  blip(c, { type: 'sine', f0: 2093, f1: 2093, t, dur: 0.07, peak: 0.055, dest: bus });
  blip(c, { type: 'triangle', f0: 784, f1: 784, t: t + 0.16, dur: 0.12, peak: 0.26, dest: bus });
  blip(c, { type: 'sine', f0: 1568, f1: 1568, t: t + 0.16, dur: 0.07, peak: 0.045, dest: bus });
}

function scheduleAlarmWindow() {
  safe(() => {
    const c = ctx;
    if (!c || !alarmOn) return;
    const horizon = c.currentTime + ALARM_LOOKAHEAD;
    let guard = 0;
    while (alarmNextTime < horizon && guard < 8) {
      scheduleTwoTone(c, Math.max(alarmNextTime, c.currentTime + 0.01));
      alarmNextTime += ALARM_STEP;
      guard += 1;
    }
  });
}

function startAlarm() {
  safe(() => {
    const c = ensureCtx();
    if (!c || !master) return;
    resumeIfNeeded();
    if (alarmOn) return; // 幂等：重复 alarm(true) 不叠加
    if (!alarmBus) {
      alarmBus = c.createGain();
      alarmBus.gain.value = 1;
      alarmBus.connect(master);
    }
    alarmOn = true;
    const now = c.currentTime;
    alarmNextTime = now + 0.02;
    alarmBus.gain.cancelScheduledValues(now);
    alarmBus.gain.setValueAtTime(alarmBus.gain.value, now);
    alarmBus.gain.linearRampToValueAtTime(1, now + 0.04);
    scheduleAlarmWindow();
    alarmTimer = setInterval(scheduleAlarmWindow, ALARM_TICK_MS);
  });
}

function stopAlarm() {
  safe(() => {
    if (!alarmOn && !alarmTimer) return;
    alarmOn = false;
    if (alarmTimer) {
      clearInterval(alarmTimer);
      alarmTimer = 0;
    }
    const c = ctx;
    if (c && alarmBus) {
      const now = c.currentTime;
      alarmBus.gain.cancelScheduledValues(now);
      alarmBus.gain.setValueAtTime(alarmBus.gain.value, now);
      alarmBus.gain.linearRampToValueAtTime(0.0001, now + 0.07); // 快速收干净
    }
  });
}

/* ------------------------------------------------------------------ 静音 */

function applyMute() {
  if (fusionAudio) fusionAudio.muted = muted;
  safe(() => {
    const c = ctx;
    if (!c || !master) return;
    const now = c.currentTime;
    const target = muted ? 0.0001 : MASTER_VOLUME;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.linearRampToValueAtTime(target, now + 0.05);
  });
}

/* ------------------------------------------------------------------ 自动解锁 */

function attachAutoUnlock() {
  safe(() => {
    if (autoUnlockBound) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    autoUnlockBound = true;
    const events = ['pointerdown', 'touchstart', 'keydown', 'mousedown'];
    const handler = () => {
      safe(() => api.unlock());
      // 只要拿到 running 状态就撤掉，别一直占着全局监听
      if (ctx && ctx.state === 'running') detach();
    };
    const detach = () => {
      events.forEach((name) => {
        safe(() => document.removeEventListener(name, handler, true));
      });
    };
    events.forEach((name) => {
      safe(() => document.addEventListener(name, handler, true));
    });
  });
}

/* ------------------------------------------------------------------ 公开对象 */

const api = {
  /** AudioContext 已创建且处于 running 才为 true */
  get ready() {
    return !!ctx && ctx.state === 'running';
  },

  get muted() {
    return muted;
  },

  /** 允许外部直接赋值（audio.muted = true 也安全） */
  set muted(value) {
    safe(() => {
      muted = !!value;
      applyMute();
    });
  },

  /**
   * 首次 pointerdown 时调用：创建 / resume AudioContext，并播一个 1 采样静音
   * 让 iOS Safari 真正解锁。可重复调用。
   */
  unlock() {
    return safe(() => {
      const c = ensureCtx();
      if (!c) return false;
      resumeIfNeeded();
      try {
        const src = c.createBufferSource();
        const buf = c.createBuffer(1, 1, c.sampleRate);
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
        src.stop(0.001);
      } catch (err) {
        /* 某些浏览器不允许 0 长度，忽略 */
      }
      return c.state === 'running';
    }, false);
  },

  /** 切换静音，返回切换后的 muted 值 */
  toggleMute() {
    return safe(() => {
      muted = !muted;
      applyMute();
      if (!muted) resumeIfNeeded();
      return muted;
    }, muted);
  },

  /** 融合视频开始时播放用户提供的音效 */
  fusion() {
    return safe(() => {
      const sound = getFusionAudio();
      if (!sound) return;
      sound.pause();
      sound.currentTime = 0;
      sound.muted = muted;
      const playback = sound.play();
      if (playback && typeof playback.catch === 'function') playback.catch(noop);
    });
  },

  stopFusion() {
    return safe(() => {
      if (!fusionAudio) return;
      fusionAudio.pause();
      fusionAudio.currentTime = 0;
    });
  },

  /** 双音闹铃循环，alarm(true) 开、alarm(false) 停；重复调用安全 */
  alarm(on) {
    return safe(() => {
      if (on) startAlarm();
      else stopAlarm();
    });
  },

  /** 短促 boing：点额头 / 小蝌蚪落地 */
  hop() {
    play((c, t, out) => {
      blip(c, { type: 'sine', f0: 520, f1: 168, t, dur: 0.3, peak: 0.42, dest: out });
      blip(c, { type: 'triangle', f0: 268, f1: 96, t, dur: 0.26, peak: 0.16, dest: out });
      blip(c, { type: 'sine', f0: 1040, f1: 420, t: t + 0.02, dur: 0.1, peak: 0.1, dest: out });
    });
  },

  /** 翻身的 whoosh */
  flip() {
    play((c, t, out) => {
      noiseHit(c, { t, dur: 0.16, type: 'bandpass', f0: 520, f1: 2400, q: 2.2, peak: 0.24, dest: out });
      noiseHit(c, { t: t + 0.14, dur: 0.2, type: 'bandpass', f0: 2400, f1: 620, q: 1.6, peak: 0.18, dest: out });
    });
  },

  /** 软软的“噗”：关铃 */
  snooze() {
    play((c, t, out) => {
      noiseHit(c, { t, dur: 0.3, type: 'lowpass', f0: 720, f1: 260, q: 0.8, peak: 0.26, attack: 0.05, dest: out });
      blip(c, { type: 'sine', f0: 268, f1: 168, t: t + 0.02, dur: 0.34, peak: 0.18, dest: out });
    });
  },

  /** 清脆的“叮” */
  ding() {
    play((c, t, out) => {
      blip(c, { type: 'sine', f0: 1568, f1: 1568, t, dur: 0.72, peak: 0.34, dest: out });
      blip(c, { type: 'sine', f0: 2349, f1: 2349, t, dur: 0.5, peak: 0.15, dest: out });
      blip(c, { type: 'sine', f0: 3136, f1: 3136, t, dur: 0.32, peak: 0.07, dest: out });
      noiseHit(c, { t, dur: 0.05, type: 'highpass', f0: 4200, q: 0.7, peak: 0.12, attack: 0.004, dest: out });
    });
  },

  /** 气泡：咕嘟 */
  bubble() {
    play((c, t, out) => {
      blip(c, { type: 'sine', f0: 360, f1: 980, t, dur: 0.075, peak: 0.2, dest: out });
      blip(c, { type: 'sine', f0: 520, f1: 1320, t: t + 0.05, dur: 0.06, peak: 0.13, dest: out });
    });
  },

  /** 啵：奶滴蹦出来 */
  pop() {
    play((c, t, out) => {
      noiseHit(c, { t, dur: 0.045, type: 'highpass', f0: 1200, q: 0.8, peak: 0.24, attack: 0.003, dest: out });
      blip(c, { type: 'sine', f0: 760, f1: 150, t, dur: 0.09, peak: 0.3, dest: out });
    });
  },

  /** 发条咔哒 */
  tick() {
    play((c, t, out) => {
      noiseHit(c, { t, dur: 0.022, type: 'bandpass', f0: 3200, q: 7, peak: 0.2, attack: 0.003, dest: out });
      blip(c, { type: 'square', f0: 1800, f1: 1800, t, dur: 0.012, peak: 0.045, dest: out });
    });
  },

  /** 奶蛋：啵 + 弹跳 */
  bounce() {
    play((c, t, out) => {
      blip(c, { type: 'sine', f0: 190, f1: 620, t, dur: 0.14, peak: 0.36, dest: out });
      blip(c, { type: 'sine', f0: 620, f1: 150, t: t + 0.1, dur: 0.24, peak: 0.26, dest: out });
      noiseHit(c, { t, dur: 0.04, type: 'highpass', f0: 1400, q: 0.8, peak: 0.16, attack: 0.003, dest: out });
    });
  },

  /** 奶包：嘿嘿嘿 */
  giggle() {
    play((c, t, out) => {
      [720, 880, 1040].forEach((f, i) => {
        blip(c, { type: 'triangle', f0: f, f1: f * 1.08, t: t + i * 0.075, dur: 0.07, peak: 0.16, dest: out });
      });
      blip(c, { type: 'sine', f0: 360, f1: 520, t: t + 0.24, dur: 0.12, peak: 0.1, dest: out });
    });
  },

  /** 奶狗：尾巴扫风 + 汪 */
  wag() {
    play((c, t, out) => {
      noiseHit(c, { t, dur: 0.24, type: 'bandpass', f0: 320, f1: 1200, q: 1.2, peak: 0.2, dest: out });
      blip(c, { type: 'triangle', f0: 240, f1: 150, t: t + 0.2, dur: 0.16, peak: 0.2, dest: out });
    });
  },

  /** 奶狗：汪 */
  bark() {
    play((c, t, out) => {
      blip(c, { type: 'sawtooth', f0: 260, f1: 120, t, dur: 0.12, peak: 0.24, dest: out });
      blip(c, { type: 'square', f0: 180, f1: 90, t: t + 0.1, dur: 0.1, peak: 0.14, dest: out });
      noiseHit(c, { t, dur: 0.05, type: 'bandpass', f0: 900, q: 1.4, peak: 0.16, attack: 0.003, dest: out });
    });
  },

  /** 奶鸡：喔喔—— */
  crow() {
    play((c, t, out) => {
      blip(c, { type: 'sawtooth', f0: 330, f1: 660, t, dur: 0.2, peak: 0.16, dest: out });
      blip(c, { type: 'sawtooth', f0: 660, f1: 880, t: t + 0.16, dur: 0.16, peak: 0.14, dest: out });
      blip(c, { type: 'sawtooth', f0: 880, f1: 494, t: t + 0.3, dur: 0.3, peak: 0.12, dest: out });
      noiseHit(c, { t, dur: 0.26, type: 'bandpass', f0: 1400, f1: 2600, q: 2, peak: 0.1, dest: out });
    });
  },

  /** 出生：奶光升起 */
  birth() {
    play((c, t, out) => {
      blip(c, { type: 'sine', f0: 300, f1: 900, t, dur: 0.5, peak: 0.22, dest: out });
      blip(c, { type: 'sine', f0: 900, f1: 1320, t: t + 0.28, dur: 0.42, peak: 0.14, dest: out });
      blip(c, { type: 'sine', f0: 1760, f1: 1760, t: t + 0.45, dur: 0.5, peak: 0.08, dest: out });
    });
  },
};

// 页面一加载就挂上自动解锁（真正的创建仍在首次手势里完成）
attachAutoUnlock();

export const audio = api;
export default api;
