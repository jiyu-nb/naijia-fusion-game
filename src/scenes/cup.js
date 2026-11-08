/**
 * 《这崽随谁》 src/scenes/cup.js  (owner: scenes-audio)
 * ------------------------------------------------------------------
 * 两个 2D 亲手发现本领场景（DOM + SVG，全部 Pointer Events，鼠标/触摸通用）：
 *
 *   frogMilk  漏一口   左右拖斜杯身(±18°) → 先冒 3~5 个气泡 → “啵”地蹦出奶滴小蝌蚪
 *   alarmMilk 醒奶杯   按住蓄力(抖动/发条/进度条) → 松手“叮” → 奶泡按蓄力比例弹起
 *
 * 契约 API：
 *   createCupScene(container, recipeKey, { onGoal, onEvent, hint }) -> { dispose, reset }
 *
 * 设计基准 390×844，场景内部用 390×520 的设计画布，按容器尺寸整体缩放并居中，
 * 因此放进 play 屏任意大小的容器都能自适应。
 *
 * 静音（或无音频）时依然有完整可见反馈：杯身倾斜、气泡粒子、蓄力条、文字提示。
 * 音效不在此模块内播放，只通过 onEvent('bubble'|'pop'|'hop'|'tick'|'ding') 交给上层。
 */

const DESIGN_W = 390;
const DESIGN_H = 520;

/** 杯口在舞台坐标系里的位置（用于气泡 / 蝌蚪 / 奶泡） */
const MOUTH = { x: 195, y: 188 };
/** 小蝌蚪落地线 */
const GROUND_Y = 392;

const ART = {
  // 第一个能拿到的就用；都没交付时退回内联 SVG 占位
  frogMilk: { files: ['louyikou_1024.png'], title: '漏一口' },
  alarmMilk: { files: ['xingnaibei_1024.png', 'naibei_1024.png'], title: '醒奶杯' },
};

const MAX_TILT = 18; // 度
const DRAG_FULL_PX = 96; // 拖多少设计像素到满倾斜
const BUBBLE_AT = 6; // 触发冒泡的倾斜角
const POP_AT = 12; // 触发“啵”的倾斜角

const CHARGE_GOAL = 0.6; // 秒：蓄力超过它松手算成功
const CHARGE_FULL = 1.6; // 秒：蓄满

const HINT = {
  frogMilk: {
    idle: '左右拖一下杯子',
    bubble: '咕嘟…冒泡了！',
    pop: '啵！漏出一只奶滴小蝌蚪',
    again: '再拖一次，看它蹦多高',
    notEnough: '歪得不够，再拖远一点',
  },
  alarmMilk: {
    idle: '按住杯子蓄力',
    charge: '别松手，继续上发条…',
    ready: '够劲了，松手！',
    go: '叮——奶泡跳起来啦',
    tooShort: '太轻了，再按久一点',
    again: '再蓄一次，能跳更高',
  },
};

const TADPOLE_SVG = `
<svg viewBox="0 0 86 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path class="cup-tadpole-tail" d="M38 32 C 54 14, 70 20, 82 32 C 70 44, 54 50, 38 32 Z"
        fill="#8FE3B8" stroke="#6B4B2A" stroke-width="3.4" stroke-linejoin="round"/>
  <circle cx="26" cy="32" r="18" fill="#FFF4E0" stroke="#6B4B2A" stroke-width="4.2"/>
  <circle cx="20" cy="27" r="2.7" fill="#6B4B2A"/>
  <circle cx="31" cy="27" r="2.7" fill="#6B4B2A"/>
  <path d="M21 38 q4.5 3.4 9 0" stroke="#6B4B2A" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <ellipse cx="14" cy="34" rx="3.8" ry="2.5" fill="#F7B8A8" opacity=".85"/>
</svg>`;

const ART_FROGMILK_SVG = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="cup-glass-1" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#FFFDF7"/><stop offset="1" stop-color="#E4C79C"/>
    </linearGradient>
    <linearGradient id="cup-milk-1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF8EC"/><stop offset="1" stop-color="#EED8B4"/>
    </linearGradient>
  </defs>
  <g stroke="#6B4B2A" stroke-linejoin="round">
    <path d="M84 92 h132 l-16 154 a20 20 0 0 1 -20 18 h-60 a20 20 0 0 1 -20 -18 z"
          fill="url(#cup-glass-1)" stroke-width="7"/>
    <path d="M92 150 h116 l-11 96 a14 14 0 0 1 -14 12 h-66 a14 14 0 0 1 -14 -12 z"
          fill="url(#cup-milk-1)" stroke="none"/>
    <path d="M86 100 q18 -20 38 -6 q14 -20 34 -4 q16 -18 34 -2 q14 -12 22 2 q-10 15 -28 11
             q-16 14 -34 2 q-18 12 -34 0 q-16 8 -28 -3 z"
          fill="#FFFDF7" stroke-width="6"/>
    <g fill="#8FE3B8" stroke-width="4.4">
      <ellipse cx="126" cy="196" rx="11" ry="9"/>
      <circle cx="112" cy="180" r="6"/><circle cx="126" cy="176" r="6"/><circle cx="140" cy="180" r="6"/>
    </g>
    <g fill="#4FB98C" stroke-width="4" opacity=".8">
      <ellipse cx="174" cy="226" rx="9" ry="7"/>
      <circle cx="165" cy="213" r="5"/><circle cx="175" cy="210" r="5"/><circle cx="185" cy="213" r="5"/>
    </g>
    <path d="M104 110 q-7 62 6 120" stroke="#FFFDF7" stroke-width="9" fill="none" opacity=".65"
          stroke-linecap="round"/>
  </g>
  <ellipse cx="97" cy="244" rx="12" ry="7" fill="#F7B8A8" opacity=".3"/>
</svg>`;

const ART_ALARMMILK_SVG = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="cup-glass-2" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#F4FFFA"/><stop offset="1" stop-color="#CDEBDC"/>
    </linearGradient>
    <linearGradient id="cup-milk-2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF8EC"/><stop offset="1" stop-color="#EED8B4"/>
    </linearGradient>
  </defs>
  <g stroke="#6B4B2A" stroke-linejoin="round">
    <circle cx="103" cy="88" r="17" fill="#8FE3B8" stroke-width="6"/>
    <circle cx="197" cy="88" r="17" fill="#8FE3B8" stroke-width="6"/>
    <path d="M84 96 h132 l-16 150 a20 20 0 0 1 -20 18 h-60 a20 20 0 0 1 -20 -18 z"
          fill="url(#cup-glass-2)" stroke-width="7"/>
    <path d="M93 150 h114 l-10 95 a14 14 0 0 1 -14 12 h-66 a14 14 0 0 1 -14 -12 z"
          fill="url(#cup-milk-2)" stroke="none"/>
    <ellipse cx="150" cy="98" rx="70" ry="15" fill="#FFFDF7" stroke-width="6"/>
    <circle cx="150" cy="200" r="38" fill="#FFF4E0" stroke-width="7"/>
    <path d="M150 176 v10 M150 214 v10 M126 200 h10 M164 200 h10"
          stroke-width="5" stroke-linecap="round"/>
    <path d="M150 200 l12 -16 M150 200 l14 8" stroke-width="5" stroke-linecap="round"/>
    <path d="M104 112 q-6 60 6 118" stroke="#FFFDF7" stroke-width="8" fill="none" opacity=".7"
          stroke-linecap="round"/>
  </g>
  <ellipse cx="98" cy="246" rx="12" ry="7" fill="#F7B8A8" opacity=".3"/>
</svg>`;

const STYLE = `
.cup-scene{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;
  touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  cursor:grab;font-family:inherit;color:#6B4B2A;}
.cup-scene.is-active{cursor:grabbing;}
.cup-stage{position:absolute;left:50%;top:50%;width:${DESIGN_W}px;height:${DESIGN_H}px;
  margin:${-DESIGN_H / 2}px 0 0 ${-DESIGN_W / 2}px;transform:scale(var(--cup-s,1));transform-origin:50% 50%;}
.cup-glow{position:absolute;left:50%;top:150px;width:330px;height:290px;margin-left:-165px;
  border-radius:50%;background:radial-gradient(ellipse at center,rgba(143,227,184,.26),rgba(143,227,184,0) 68%);
  pointer-events:none;transition:opacity .3s;opacity:.85;}
.cup-floor{position:absolute;left:50%;top:${GROUND_Y - 22}px;width:300px;height:48px;margin-left:-150px;
  border-radius:50%;background:radial-gradient(ellipse at center,rgba(107,75,42,.2),rgba(107,75,42,0) 72%);
  pointer-events:none;}
.cup-art-wrap{position:absolute;left:50%;top:88px;width:300px;height:300px;margin-left:-150px;
  transform-origin:50% 94%;will-change:transform;}
.cup-art{position:absolute;inset:0;}
.cup-art img,.cup-art svg{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;
  filter:drop-shadow(0 16px 18px rgba(107,75,42,.18));}
.cup-key{position:absolute;right:-4px;top:104px;width:80px;height:80px;transform-origin:50% 50%;
  pointer-events:none;filter:drop-shadow(0 6px 8px rgba(107,75,42,.2));display:none;}
.cup-scene[data-recipe="alarmMilk"] .cup-key{display:block;}
/* 真实美术自带发条钥匙时，用一圈旋转的薄荷弧线表示“在上发条” */
.cup-spin{position:absolute;left:220px;top:138px;width:80px;height:80px;transform-origin:50% 50%;
  pointer-events:none;display:none;opacity:.9;}
.cup-scene[data-recipe="alarmMilk"][data-art="png"] .cup-spin{display:block;}
.cup-scene[data-recipe="alarmMilk"][data-art="png"] .cup-key{display:none;}
.cup-foam{position:absolute;left:65px;top:26px;width:170px;height:78px;transform-origin:50% 100%;
  pointer-events:none;display:none;filter:drop-shadow(0 6px 10px rgba(107,75,42,.16));}
.cup-scene[data-recipe="alarmMilk"] .cup-foam{display:block;}
.cup-fx{position:absolute;inset:0;pointer-events:none;}
.cup-bubble{position:absolute;border-radius:50%;box-sizing:border-box;
  background:radial-gradient(circle at 32% 30%,#fff 0%,rgba(255,248,236,.96) 48%,rgba(143,227,184,.88) 100%);
  border:2px solid rgba(107,75,42,.4);box-shadow:0 2px 6px rgba(107,75,42,.12);}
.cup-droplet{position:absolute;border-radius:50%;box-sizing:border-box;
  background:radial-gradient(circle at 34% 30%,#fff,#FFF4E0 60%,#F3C463);border:1.5px solid rgba(107,75,42,.28);}
.cup-tadpole{position:absolute;width:86px;height:64px;margin-left:-43px;margin-top:-32px;pointer-events:none;}
.cup-tadpole svg{display:block;width:100%;height:100%;overflow:visible;
  filter:drop-shadow(0 8px 10px rgba(107,75,42,.22));}
.cup-tadpole-tail{transform-origin:38px 32px;animation:cup-tail .3s infinite alternate ease-in-out;}
@keyframes cup-tail{from{transform:rotate(-9deg) scaleY(.95)}to{transform:rotate(9deg) scaleY(1.05)}}
.cup-caption{position:absolute;left:16px;right:16px;bottom:14px;text-align:center;font-size:17px;
  line-height:1.3;font-weight:800;letter-spacing:.4px;color:#6B4B2A;pointer-events:none;
  text-shadow:0 2px 0 rgba(255,255,255,.85),0 0 12px rgba(255,255,255,.6);}
.cup-caption.is-pop{animation:cup-caption-pop .34s ease-out;}
@keyframes cup-caption-pop{0%{transform:scale(.86);opacity:.4}60%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
.cup-charge{position:absolute;left:50%;bottom:58px;width:206px;height:16px;margin-left:-103px;
  border-radius:999px;box-sizing:border-box;background:rgba(107,75,42,.14);
  border:2px solid rgba(107,75,42,.4);opacity:0;transition:opacity .2s;overflow:hidden;display:none;}
.cup-scene[data-recipe="alarmMilk"] .cup-charge{display:block;opacity:.55;}
.cup-charge i{display:block;height:100%;width:0%;border-radius:999px;
  background:linear-gradient(90deg,#8FE3B8,#4FB98C 62%,#F3C463);transition:width .05s linear;}
.cup-charge::after{content:"";position:absolute;left:60%;top:-2px;bottom:-2px;width:2px;
  background:rgba(107,75,42,.55);}
.cup-charge.is-charging{opacity:1;}
.cup-charge.is-ready i{background:linear-gradient(90deg,#F3C463,#CE9A2F);}
.cup-badge{position:absolute;left:50%;top:6px;transform:translateX(-50%);font-size:13px;font-weight:800;
  letter-spacing:1px;color:#6B4B2A;background:rgba(255,244,224,.8);border:2px solid rgba(107,75,42,.35);
  border-radius:999px;padding:2px 12px;pointer-events:none;transition:opacity .16s;}
.cup-hintline{position:absolute;left:0;right:0;top:44px;text-align:center;font-size:13px;font-weight:700;
  color:rgba(107,75,42,.66);pointer-events:none;letter-spacing:.4px;transition:opacity .16s;}
.cup-scene.is-launch .cup-badge,.cup-scene.is-launch .cup-hintline{opacity:0;}
`;

const KEY_SVG = `
<svg viewBox="0 0 78 78" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="39" cy="39" r="9" fill="#CE9A2F" stroke="#6B4B2A" stroke-width="4"/>
  <path d="M39 12 v18 M39 48 v18 M12 39 h18 M48 39 h18" stroke="#6B4B2A" stroke-width="6"
        stroke-linecap="round" opacity=".55"/>
  <path d="M39 39 m-20 0 a20 20 0 1 1 20 20" fill="none" stroke="#6B4B2A" stroke-width="6"
        stroke-linecap="round" opacity=".25"/>
  <g fill="#F3C463" stroke="#6B4B2A" stroke-width="3.6" stroke-linejoin="round">
    <circle cx="39" cy="11" r="7"/><circle cx="39" cy="67" r="7"/>
    <circle cx="11" cy="39" r="7"/><circle cx="67" cy="39" r="7"/>
  </g>
</svg>`;

const SPIN_SVG = `
<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="#4FB98C" stroke-width="5" stroke-linecap="round">
    <path d="M40 12 a28 28 0 0 1 24 14" opacity=".95"/>
    <path d="M40 68 a28 28 0 0 1 -24 -14" opacity=".95"/>
  </g>
  <g fill="#F3C463" stroke="#6B4B2A" stroke-width="3" stroke-linejoin="round">
    <path d="M64 26 l -3 11 l -10 -5 z"/>
    <path d="M16 54 l 3 -11 l 10 5 z"/>
  </g>
</svg>`;

const FOAM_SVG = `
<svg viewBox="0 0 170 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g stroke="#6B4B2A" stroke-linejoin="round" stroke-width="5">
    <path d="M18 62 q-12 -18 6 -26 q4 -18 26 -14 q8 -16 28 -10 q20 -8 28 10 q20 4 16 24 q10 14 -8 18
             q-14 8 -30 2 q-18 8 -34 0 q-20 4 -32 -4 z" fill="#FFFDF7"/>
  </g>
  <g fill="#F7B8A8" opacity=".35">
    <ellipse cx="52" cy="46" rx="12" ry="7"/><ellipse cx="116" cy="46" rx="12" ry="7"/>
  </g>
  <path d="M44 30 q10 -8 20 -2" stroke="#FFF4E0" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function artUrls(file) {
  // 线上静态根把 /art 映射到 public/art；dev 页（项目根起服务）走 /public/art。
  const urls = [`/art/${file}`];
  try {
    urls.push(new URL(`../../public/art/${file}`, import.meta.url).href);
  } catch (err) {
    /* ignore */
  }
  return urls;
}

/* ------------------------------------------------------------------ 工厂 */

export function createCupScene(container, recipeKey, opts = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    return { dispose() {}, reset() {}, recipeKey: 'frogMilk' };
  }

  const mode = recipeKey === 'alarmMilk' ? 'alarmMilk' : 'frogMilk';
  const art = ART[mode];
  const hints = HINT[mode];

  const onGoal = typeof opts.onGoal === 'function' ? opts.onGoal : null;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  const hintFn = typeof opts.hint === 'function' ? opts.hint : null;

  let disposed = false;
  let scale = 1;

  // 计时器 / 动画 / rAF
  const timers = new Set();
  const anims = new Set();
  let rafId = 0;
  let lastTs = 0;

  // 交互状态
  let activePointer = null;
  let dragging = false;
  let dragStartX = 0;
  let tilt = 0;
  let shiftX = 0;
  let bubbleFired = false;
  let popFired = false;

  let charging = false;
  let chargeStartMs = 0;
  let charge = 0;
  let nextTickAt = 0;
  let shakePhase = 0;
  let shakeX = 0;
  let shakeY = 0;
  let shakeAmp = 0;
  let keyAngle = 0;
  let keySpin = 0;
  let foamAnim = null;
  let readySaid = false;

  let round = 0; // 成功次数（第一次之后动画更快）
  let goalFired = false;

  /* ------------------------------------------------------------ DOM */

  const root = document.createElement('div');
  root.className = 'cup-scene';
  root.dataset.recipe = mode;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', `${art.title}小游戏`);

  root.innerHTML = `
    <style>${STYLE}</style>
    <div class="cup-stage">
      <div class="cup-glow"></div>
      <div class="cup-floor"></div>
      <div class="cup-art-wrap">
        <div class="cup-art"></div>
        <div class="cup-foam">${FOAM_SVG}</div>
        <div class="cup-spin">${SPIN_SVG}</div>
        <div class="cup-key">${KEY_SVG}</div>
      </div>
      <div class="cup-fx"></div>
      <div class="cup-badge">${art.title}</div>
      <div class="cup-hintline">${mode === 'frogMilk' ? '拖动 · 别洒了' : '按住 · 上发条'}</div>
      <div class="cup-charge"><i></i></div>
      <div class="cup-caption"></div>
    </div>`;

  const stage = root.querySelector('.cup-stage');
  const artWrap = root.querySelector('.cup-art-wrap');
  const artEl = root.querySelector('.cup-art');
  const fx = root.querySelector('.cup-fx');
  const captionEl = root.querySelector('.cup-caption');
  const chargeEl = root.querySelector('.cup-charge');
  const chargeFill = chargeEl.querySelector('i');
  const foamEl = root.querySelector('.cup-foam');
  const keyEl = root.querySelector('.cup-key');
  const spinEl = root.querySelector('.cup-spin');

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(root);
  artEl.innerHTML = mode === 'alarmMilk' ? ART_ALARMMILK_SVG : ART_FROGMILK_SVG;

  /* ------------------------------------------------------------ 工具 */

  function setTimer(fn, ms) {
    if (disposed) return 0;
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) {
        try {
          fn();
        } catch (err) {
          /* 单帧逻辑出错不影响后续 */
        }
      }
    }, Math.max(0, ms));
    timers.add(id);
    return id;
  }

  function clearTimers() {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  }

  function runAnim(el, keyframes, options) {
    if (disposed || !el || typeof el.animate !== 'function') return null;
    let animation = null;
    try {
      animation = el.animate(keyframes, options);
    } catch (err) {
      return null;
    }
    anims.add(animation);
    const done = () => anims.delete(animation);
    if (animation.finished && typeof animation.finished.then === 'function') {
      animation.finished.then(done, done);
    }
    return animation;
  }

  function emit(name) {
    if (!onEvent) return;
    try {
      onEvent(name);
    } catch (err) {
      /* 上层回调出错不能打断场景 */
    }
  }

  function say(text, pop = true) {
    if (!text) return;
    captionEl.textContent = text;
    if (pop) {
      captionEl.classList.remove('is-pop');
      // 强制重排以便重放动画
      void captionEl.offsetWidth;
      captionEl.classList.add('is-pop');
    }
    if (hintFn) {
      try {
        hintFn(text);
      } catch (err) {
        /* ignore */
      }
    }
  }

  function fireGoal() {
    if (goalFired) return;
    goalFired = true;
    round += 1;
    if (!onGoal) return;
    try {
      onGoal({ recipeKey: mode });
    } catch (err) {
      /* ignore */
    }
  }

  /** 第一次 1，之后 0.62（动画更快） */
  function speedFactor() {
    return round === 0 ? 1 : 0.62;
  }

  /* ------------------------------------------------------------ 自适应 */

  function fit() {
    const w = container.clientWidth || DESIGN_W;
    const h = container.clientHeight || DESIGN_H;
    const raw = Math.min(w / DESIGN_W, h / DESIGN_H);
    scale = clamp(raw, 0.35, 1.5);
    stage.style.setProperty('--cup-s', scale.toFixed(4));
  }

  fit();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    try {
      ro = new ResizeObserver(fit);
      ro.observe(container);
    } catch (err) {
      ro = null;
    }
  }
  const onWinResize = () => fit();
  window.addEventListener('resize', onWinResize);

  /* ------------------------------------------------------------ 美术资源 */

  // 先用内联 SVG 占位；PNG 一旦可用就自动换成图片（之后出现也会被捡起来）
  // 用 fetch 探测 + blob URL：JS 侧不会抛错；美术还没交付时浏览器网络面板里会有
  // 一条 404（这是唯一预期内的网络日志，图片到位即消失）。
  // 上层若想彻底不探测，可传 opts.artProbe === false。
  const retryDelays = [3000, 12000, 30000];
  const artProbe = opts.artProbe !== false;
  let retryIndex = 0;
  let imgEl = null;
  let artObjectUrl = null;
  let artLoading = false;

  function adoptImage() {
    if (disposed || !imgEl) return;
    artEl.innerHTML = '';
    artEl.appendChild(imgEl);
    root.dataset.art = 'png';
  }

  function scheduleArtRetry() {
    if (disposed || artLoading) return;
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)];
    retryIndex += 1;
    if (retryIndex <= retryDelays.length) setTimer(tryLoadArt, delay);
  }

  async function tryLoadArt() {
    if (disposed || artLoading) return;
    artLoading = true;
    try {
      for (const file of art.files) {
        if (disposed) return;
        let res = null;
        for (const url of artUrls(file)) {
          res = await fetch(url, { cache: 'no-store' }).catch(() => null);
          if (res && res.ok) break;
        }
        if (!res || !res.ok) continue;
        const blob = await res.blob();
        if (!blob || !/^image\//.test(blob.type || '')) continue;
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        try {
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('decode failed'));
            img.src = objectUrl;
          });
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          continue;
        }
        artLoading = false;
        if (disposed) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (artObjectUrl) URL.revokeObjectURL(artObjectUrl);
        artObjectUrl = objectUrl;
        imgEl = img;
        adoptImage();
        return;
      }
      artLoading = false;
      scheduleArtRetry();
    } catch (err) {
      artLoading = false;
      scheduleArtRetry();
    }
  }
  if (artProbe) tryLoadArt();

  /* ------------------------------------------------------------ 粒子 / 角色 */

  function bubbleBurst() {
    const n = 3 + Math.floor(Math.random() * 3); // 3~5 个
    const sp = speedFactor();
    const dir = tilt >= 0 ? 1 : -1;
    for (let i = 0; i < n; i += 1) {
      const delay = i * (70 * sp + Math.random() * 30);
      setTimer(() => {
        const size = 11 + Math.random() * 10;
        const x = MOUTH.x + dir * 16 + (Math.random() - 0.5) * 40;
        const y = MOUTH.y - 4 - Math.random() * 8;
        const rise = 46 + Math.random() * 46;
        const drift = dir * (10 + Math.random() * 26);
        popBubble(x, y, size, rise, drift, (520 + Math.random() * 260) * sp);
        emit('bubble');
      }, delay);
    }
  }

  function popBubble(x, y, size, rise, drift, dur) {
    const el = document.createElement('i');
    el.className = 'cup-bubble';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.marginLeft = `${-size / 2}px`;
    el.style.marginTop = `${-size / 2}px`;
    fx.appendChild(el);
    const cleanup = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    const animation = runAnim(
      el,
      [
        { transform: 'translate(0,0) scale(.35)', opacity: 0 },
        { transform: `translate(${drift * 0.4}px,${-rise * 0.5}px) scale(1)`, opacity: 0.95, offset: 0.4 },
        { transform: `translate(${drift}px,${-rise}px) scale(.82)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' },
    );
    if (animation) {
      animation.finished.then(cleanup, cleanup);
    } else {
      setTimer(cleanup, dur);
    }
  }

  function dropletBurst(power) {
    const n = 3 + Math.round(power * 3);
    for (let i = 0; i < n; i += 1) {
      const delay = i * 40;
      setTimer(() => {
        const size = 7 + Math.random() * 6;
        const el = document.createElement('i');
        el.className = 'cup-droplet';
        el.style.left = `${MOUTH.x + (Math.random() - 0.5) * 60}px`;
        el.style.top = `${MOUTH.y}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.marginLeft = `${-size / 2}px`;
        el.style.marginTop = `${-size / 2}px`;
        fx.appendChild(el);
        const dx = (Math.random() - 0.5) * (90 + power * 90);
        const dy = -(40 + power * 80) - Math.random() * 40;
        const cleanup = () => {
          if (el.parentNode) el.parentNode.removeChild(el);
        };
        const animation = runAnim(
          el,
          [
            { transform: 'translate(0,0) scale(.5)', opacity: 0 },
            { transform: `translate(${dx * 0.6}px,${dy}px) scale(1)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px,${dy + 140}px) scale(.7)`, opacity: 0 },
          ],
          { duration: 620, easing: 'cubic-bezier(.3,.1,.5,1)' },
        );
        if (animation) animation.finished.then(cleanup, cleanup);
        else setTimer(cleanup, 640);
      }, delay);
    }
  }

  function spawnTadpole() {
    const sp = speedFactor();
    const el = document.createElement('div');
    el.className = 'cup-tadpole';
    el.innerHTML = TADPOLE_SVG;
    el.style.left = `${MOUTH.x}px`;
    el.style.top = `${MOUTH.y}px`;
    fx.appendChild(el);

    const dir = tilt >= 0 ? 1 : -1;
    const dx = dir * (46 + Math.random() * 34);
    const hopUp = -86;
    const groundDelta = GROUND_Y - MOUTH.y;
    const dur = 940 * sp;

    const cleanup = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    const animation = runAnim(
      el,
      [
        { transform: 'translate(0,0) scale(.35) rotate(0deg)', opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.35}px,${hopUp * 0.72}px) scale(1.06) rotate(-14deg)`,
          opacity: 1, offset: 0.3, easing: 'cubic-bezier(.2,.7,.35,1)' },
        { transform: `translate(${dx * 0.8}px,${hopUp}px) scale(1.1) rotate(-6deg)`,
          opacity: 1, offset: 0.44 },
        { transform: `translate(${dx}px,${groundDelta}px) scale(1) rotate(10deg)`,
          opacity: 1, offset: 0.66, easing: 'cubic-bezier(.45,.05,.75,.5)' },
        { transform: `translate(${dx * 1.04}px,${groundDelta - 30}px) scale(1.06,.9) rotate(-4deg)`,
          opacity: 1, offset: 0.78, easing: 'cubic-bezier(.2,.7,.3,1)' },
        { transform: `translate(${dx * 1.06}px,${groundDelta}px) scale(1.12,.86) rotate(0deg)`,
          opacity: 1, offset: 0.86, easing: 'cubic-bezier(.4,.1,.7,.6)' },
        { transform: `translate(${dx * 1.08}px,${groundDelta - 12}px) scale(1) rotate(0deg)`,
          opacity: 1, offset: 0.93, easing: 'ease-out' },
        { transform: `translate(${dx * 1.08}px,${groundDelta}px) scale(1) rotate(0deg)`,
          opacity: 0, offset: 1 },
      ],
      { duration: dur, easing: 'linear', fill: 'forwards' },
    );
    if (animation) animation.finished.then(cleanup, cleanup);
    else setTimer(cleanup, dur + 60);

    setTimer(() => emit('hop'), dur * 0.66);
    // 落地瞬间算成功（每轮只回调一次，reset() 后可再次触发）
    setTimer(() => fireGoal(), dur * 0.7);
  }

  /* ------------------------------------------------------------ frogMilk 交互 */

  function startDrag(clientX) {
    dragging = true;
    dragStartX = clientX;
    bubbleFired = false;
    popFired = false;
    root.classList.add('is-active');
    if (round === 0) say(hints.idle, false);
    startLoop();
  }

  function moveDrag(clientX) {
    const dx = (clientX - dragStartX) / (scale || 1);
    const next = clamp(dx / DRAG_FULL_PX, -1, 1) * MAX_TILT;
    tilt = next;
    shiftX = clamp(dx * 0.06, -10, 10);
    const abs = Math.abs(tilt);
    if (abs >= BUBBLE_AT && !bubbleFired) {
      bubbleFired = true;
      bubbleBurst();
      say(hints.bubble, false);
    }
    if (abs >= POP_AT && !popFired) {
      popFired = true;
      leak();
    }
    startLoop();
  }

  /** 先冒泡 → 稍后“啵”地蹦出小蝌蚪；第二次起更快 */
  function leak() {
    const sp = speedFactor();
    if (!bubbleFired) {
      bubbleFired = true;
      bubbleBurst();
      say(hints.bubble, false);
    }
    setTimer(() => {
      emit('pop');
      spawnTadpole();
      say(round === 0 ? hints.pop : hints.again);
    }, 300 * sp);
  }

  function endDrag() {
    const wasTilted = Math.abs(tilt) >= BUBBLE_AT;
    const anyLeak = popFired;
    dragging = false;
    root.classList.remove('is-active');
    startLoop();
    if (!anyLeak) {
      say(wasTilted ? hints.notEnough : hints.idle, false);
    }
  }

  /* ------------------------------------------------------------ alarmMilk 交互 */

  function startCharge() {
    charging = true;
    chargeStartMs = nowMs();
    charge = 0;
    nextTickAt = nowMs() + 120;
    shakePhase = 0;
    readySaid = false;
    chargeEl.classList.add('is-charging');
    chargeEl.classList.remove('is-ready');
    say(hints.charge, false);
    emit('tick');
    startLoop();
  }

  function releaseCharge() {
    if (!charging) return;
    charging = false;
    const held = (nowMs() - chargeStartMs) / 1000;
    const ratio = clamp(held / CHARGE_FULL, 0, 1);
    const jump = 0.3 + 0.7 * ratio; // 0.3 ~ 1.0
    chargeEl.classList.remove('is-charging');
    chargeEl.classList.remove('is-ready');
    emit('ding');
    launchFoam(jump);
    dropletBurst(jump);

    if (held >= CHARGE_GOAL) {
      say(round === 0 ? hints.go : hints.again);
      fireGoal(); // 内部去重：每轮只通知一次，reset() 后重新可通知
    } else {
      say(hints.tooShort);
    }
    charge = 0;
    chargeFill.style.width = '0%';
    startLoop();
  }

  function launchFoam(jump) {
    if (!foamEl) return;
    const dist = 26 + 112 * jump;
    const dur = 440 + 160 * jump;
    // 奶泡冲到顶部时先把标题/提示淡出，别打架
    root.classList.add('is-launch');
    setTimer(() => root.classList.remove('is-launch'), dur + 120);
    if (foamAnim) {
      try {
        foamAnim.cancel();
      } catch (err) {
        /* ignore */
      }
      foamAnim = null;
    }
    foamAnim = runAnim(
      foamEl,
      [
        { transform: 'translateY(0) scale(1,1)', offset: 0 },
        { transform: `translateY(${-dist * 0.16}px) scale(1.16,0.82)`, offset: 0.1, easing: 'cubic-bezier(.2,.8,.3,1)' },
        { transform: `translateY(${-dist}px) scale(0.9,1.16)`, offset: 0.38, easing: 'cubic-bezier(.15,.6,.3,1)' },
        { transform: `translateY(${-dist * 0.9}px) scale(1.02,0.98)`, offset: 0.48, easing: 'ease-in' },
        { transform: 'translateY(0) scale(1.2,0.8)', offset: 0.76, easing: 'cubic-bezier(.3,.9,.4,1)' },
        { transform: `translateY(${-dist * 0.1}px) scale(0.97,1.03)`, offset: 0.88, easing: 'ease-out' },
        { transform: 'translateY(0) scale(1,1)', offset: 1 },
      ],
      { duration: dur, easing: 'linear' },
    );
  }

  /* ------------------------------------------------------------ rAF 循环 */

  function startLoop() {
    if (disposed || rafId) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function frame(ts) {
    rafId = 0;
    if (disposed) return;
    const dtRaw = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
    lastTs = ts;
    const dt = clamp(dtRaw, 0.001, 0.05);
    let busy = false;

    // 倾斜回弹
    if (!dragging && Math.abs(tilt) > 0.05) {
      tilt += (0 - tilt) * clamp(dt * 13, 0, 1);
      shiftX += (0 - shiftX) * clamp(dt * 13, 0, 1);
      if (Math.abs(tilt) < 0.12) {
        tilt = 0;
        shiftX = 0;
      }
      busy = true;
    } else if (!dragging && shiftX !== 0) {
      shiftX = 0;
    }

    if (mode === 'alarmMilk') {
      if (charging) {
        const held = (nowMs() - chargeStartMs) / 1000;
        charge = clamp(held / CHARGE_FULL, 0, 1);
        chargeFill.style.width = `${(charge * 100).toFixed(1)}%`;
        chargeEl.classList.toggle('is-ready', held >= CHARGE_GOAL);
        if (held >= CHARGE_GOAL && !readySaid) {
          readySaid = true;
          say(hints.ready, false); // 越过 0.6s 阈值给一次文字提醒
        }
        const now = nowMs();
        if (now >= nextTickAt) {
          emit('tick');
          nextTickAt = now + Math.round(170 - 80 * charge);
        }
        keySpin = 160 + 900 * charge;
        shakePhase += dt * (16 + 30 * charge);
        shakeAmp = 1.1 + 3.6 * charge;
        shakeX = Math.sin(shakePhase * 2.3) * shakeAmp;
        shakeY = Math.cos(shakePhase * 3.1) * shakeAmp * 0.55;
        busy = true;
      } else {
        if (keySpin > 1) {
          keyAngle += keySpin * dt;
          keySpin *= Math.pow(0.02, dt);
          busy = true;
        } else {
          keySpin = 0;
        }
        if (shakeAmp > 0.02) {
          shakeAmp *= Math.pow(0.0008, dt);
          shakeX = Math.sin(shakePhase * 2.3) * shakeAmp;
          shakeY = Math.cos(shakePhase * 3.1) * shakeAmp * 0.55;
          shakePhase += dt * 20;
          busy = true;
        } else if (shakeAmp !== 0) {
          shakeAmp = 0;
          shakeX = 0;
          shakeY = 0;
        }
      }
      keyEl.style.transform = `rotate(${keyAngle.toFixed(1)}deg)`;
      if (spinEl) spinEl.style.transform = `rotate(${keyAngle.toFixed(1)}deg)`;
    }

    artWrap.style.transform =
      `rotate(${tilt.toFixed(2)}deg) translate(${shakeX.toFixed(2)}px,${shakeY.toFixed(2)}px)`;

    if (busy) startLoop();
  }

  /* ------------------------------------------------------------ Pointer */

  function onPointerDown(e) {
    if (disposed || activePointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    activePointer = e.pointerId;
    try {
      root.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 某些环境不支持捕获，忽略 */
    }
    if (e.cancelable) e.preventDefault();
    if (mode === 'alarmMilk') startCharge();
    else startDrag(e.clientX);
  }

  function onPointerMove(e) {
    if (disposed || e.pointerId !== activePointer) return;
    if (mode === 'frogMilk') moveDrag(e.clientX);
  }

  function onPointerUp(e) {
    if (disposed || e.pointerId !== activePointer) return;
    activePointer = null;
    try {
      if (root.hasPointerCapture && root.hasPointerCapture(e.pointerId)) {
        root.releasePointerCapture(e.pointerId);
      }
    } catch (err) {
      /* ignore */
    }
    if (mode === 'alarmMilk') releaseCharge();
    else endDrag();
  }

  function onPointerCancel(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (mode === 'alarmMilk') releaseCharge();
    else endDrag();
  }

  function onLostCapture(e) {
    // 若因系统原因丢失捕获，按松手处理，避免卡在蓄力态
    if (e.pointerId !== activePointer) return;
    if (mode === 'alarmMilk' && charging) {
      activePointer = null;
      releaseCharge();
    }
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('lostpointercapture', onLostCapture);

  // 首帧先摆正
  artWrap.style.transform = 'rotate(0deg) translate(0px,0px)';
  say(hints.idle, false);

  /* ------------------------------------------------------------ 清理 */

  function clearFx() {
    anims.forEach((a) => {
      try {
        a.cancel();
      } catch (err) {
        /* ignore */
      }
    });
    anims.clear();
    while (fx.firstChild) fx.removeChild(fx.firstChild);
    foamAnim = null;
  }

  function reset() {
    if (disposed) return;
    clearTimers();
    clearFx();
    activePointer = null;
    dragging = false;
    tilt = 0;
    shiftX = 0;
    bubbleFired = false;
    popFired = false;
    charging = false;
    charge = 0;
    chargeStartMs = 0;
    nextTickAt = 0;
    shakeAmp = 0;
    shakeX = 0;
    shakeY = 0;
    shakePhase = 0;
    keySpin = 0;
    keyAngle = 0;
    readySaid = false;
    round = 0;
    goalFired = false;
    root.classList.remove('is-active');
    root.classList.remove('is-launch');
    artWrap.style.transform = 'rotate(0deg) translate(0px,0px)';
    if (keyEl) keyEl.style.transform = 'rotate(0deg)';
    if (spinEl) spinEl.style.transform = 'rotate(0deg)';
    if (foamEl) foamEl.style.transform = 'translateY(0)';
    if (chargeFill) chargeFill.style.width = '0%';
    if (chargeEl) {
      chargeEl.classList.remove('is-charging');
      chargeEl.classList.remove('is-ready');
    }
    say(hints.idle, false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    clearTimers();
    try {
      clearFx();
    } catch (err) {
      /* ignore */
    }
    if (ro) {
      try {
        ro.disconnect();
      } catch (err) {
        /* ignore */
      }
      ro = null;
    }
    window.removeEventListener('resize', onWinResize);
    if (artObjectUrl) {
      try {
        URL.revokeObjectURL(artObjectUrl);
      } catch (err) {
        /* ignore */
      }
      artObjectUrl = null;
    }
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('lostpointercapture', onLostCapture);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { dispose, reset, recipeKey: mode, get round() { return round; } };
}

export default createCupScene;
