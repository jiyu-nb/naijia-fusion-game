// DOM 层：奶家人主题的六个屏幕 + HUD。只渲染与转发事件，不碰游戏逻辑。
import { FROG, PARTNERS, nameById, LEGACY_PARENT_NAMES } from "./recipes.js";

let root = null;
let handlers = {};
let currentScreen = "home";
let cancelVideo = null;
const refs = {};

const TEMPLATE = `
<div class="frame">
  <div class="hud">
    <button class="back-btn" id="backBtn" type="button" hidden aria-label="返回上一页">‹ 返回</button>
    <div class="brand">
      <span class="brand-mark">奶</span>
      <span class="brand-text">奶家人<em>NAI FAMILY</em></span>
    </div>
    <div class="hud-right">
      <button class="chip-btn" id="muteBtn" title="静音 / 恢复">🔊</button>
    </div>
  </div>

  <div class="screens">
    <section class="screen" data-screen="home">
      <div class="home">
        <div class="home-head">
          <p class="kicker">奶家人</p>
          <h1>给奶蛙挑个搭档</h1>
          <p class="sub">选择一位亲本，看看会诞生谁</p>
        </div>

        <div class="frog-card">
          <div class="frog-art"><img src="${FROG.card}" srcset="${FROG.card} 1x, ${FROG.thumb} 2x" alt="奶蛙" /></div>
          <div class="frog-copy">
            <span class="role-pill">亲本 ①</span>
            <b>奶蛙</b>
            <i>家里唯一的奶源 · 已在场</i>
          </div>
          <span class="fixed-mark">✓</span>
        </div>

        <div class="pick-head"><span>再挑一位现实亲本</span><em>亲本 ②</em></div>
        <div class="partner-grid" id="partnerGrid"></div>
        <label class="custom-parent-label" for="customParent">或输入你想融合的亲本</label>
        <input class="custom-parent-input" id="customParent" maxlength="100" autocomplete="off" placeholder="例如：美团袋鼠" />

      </div>
        <div class="fuse-area">
          <button class="cta" id="fuseBtn" disabled>揉一个新崽</button>
          <p class="tip" id="selectTip">先挑一位现实亲本</p>
        </div>
    </section>

    <section class="screen" data-screen="fusion">
      <div class="fusion">
        <p class="kicker" id="fusionKicker">奶力搅拌中</p>
        <div class="agent-wait" id="agentWait" hidden>
          <span class="agent-spinner" aria-hidden="true"></span>
          <p id="agentMessage" role="status" aria-live="polite"></p>
          <button class="ghost-btn" id="agentRetry" type="button" hidden>重新选择</button>
        </div>
        <div class="fusion-stage" id="fusionStage">
          <div class="showcase-stage" id="showcaseStage"></div>
          <img class="showcase-fallback" id="showcaseFrog" alt="奶蛙" />
          <div class="partner-sticker" id="partnerSticker">
            <img id="fusePartner" alt="" />
            <span id="fusePartnerName"></span>
            <em>现实亲本</em>
          </div>
          <div class="cream-flash"></div>
          <div class="splash-ring"></div>
          <div class="reveal" id="reveal">
            <div class="reveal-art-wrap">
              <span class="reveal-blob">奶</span>
              <img id="revealArt" class="reveal-art" alt="" />
            </div>
            <h2 id="revealName"></h2>
            <p class="sub" id="revealTag"></p>
            <div class="reveal-features" id="revealFeatures"></div>
            <button class="cta" id="playBtn">开始玩 →</button>
          </div>
        </div>
      </div>
    </section>

    <section class="screen" data-screen="play">
      <div class="play">
        <div class="play-top">
          <div class="gen-pill" id="genPill">第 2 代 · 奶家人</div>
          <div class="model-badge" id="modelBadge">模型加载中…</div>
        </div>
        <p class="rotate-note">左右拖动旋转角色 · 奶狗拖尾巴可以互动</p>
        <div class="play-stage" id="playStage"></div>
        <div class="play-bottom">
          <div class="hint" id="hint"></div>
        </div>
      </div>
    </section>

    <section class="screen" data-screen="traits">
      <div class="traits">
        <p class="kicker">你刚才亲眼看到的</p>
        <h2 id="traitsTitle">它露出两样本事</h2>
        <p class="sub">挑一个留给下一代（另一个就丢啦）</p>
        <div class="trait-list" id="traitList"></div>
      </div>
    </section>

    <section class="screen" data-screen="saved">
      <div class="saved">
        <p class="kicker">已存进奶家人的相册</p>
        <div class="saved-card">
          <div class="saved-art-wrap"><span class="saved-blob">奶</span><img id="savedArt" alt="" /></div>
          <div>
            <h2 id="savedName"></h2>
            <div class="trait-badge" id="savedTrait"></div>
            <p class="sub" id="savedParents"></p>
          </div>
        </div>
        <p class="sub">刷新页面，它和这个特征都还在</p>
        <button class="cta" id="againBtn">再揉一个</button>
        <button class="ghost-btn" id="hi3dBtn">Hi3D · 用这张设定图生成变体</button>
        <div class="hi3d-panel" id="hi3dPanel" hidden>
          <div class="hi3d-head"><span>Hi3D</span><b>新模型接入路径</b></div>
          <div class="hi3d-body">
            <img id="hi3dArt" alt="" />
            <div class="hi3d-copy">
              <p id="hi3dStatus">检查额度中…</p>
              <button class="mini-btn" id="hi3dSubmit">提交生成</button>
            </div>
          </div>
          <p class="hi3d-note">凭证只在服务端；额度不足时不会创建任务，也不会扣费。成功后才会标记为 Hi3D 新资产。</p>
        </div>
        <div class="saved-chip" id="savedChip2" hidden></div>
        <div class="legacy-chip" id="legacyChip2" hidden></div>
        <p class="foot-note" id="savedFoot"></p>
      </div>
    </section>
  </div>
  <div class="fusion-video-overlay" id="fusionVideoOverlay" hidden>
    <button class="back-btn video-back" id="videoBackBtn" type="button" aria-label="返回选择亲本">‹ 返回</button>
    <video id="fusionVideo" src="/assets/fusion.mp4" playsinline muted preload="auto" aria-label="奶家人融合动画"></video>
  </div>
  <div class="toast" id="toast"></div>
</div>
`;

export function mountUI(appRoot, cb) {
  root = appRoot;
  handlers = cb || {};
  root.innerHTML = TEMPLATE;

  const q = (sel) => root.querySelector(sel);
  refs.backBtn = q("#backBtn");
  refs.videoBackBtn = q("#videoBackBtn");
  refs.partnerGrid = q("#partnerGrid");
  refs.customParent = q("#customParent");
  refs.agentWait = q("#agentWait");
  refs.agentMessage = q("#agentMessage");
  refs.agentRetry = q("#agentRetry");
  refs.fuseBtn = q("#fuseBtn");
  refs.selectTip = q("#selectTip");
  refs.savedChip = q("#savedChip");
  refs.legacyChip = q("#legacyChip");
  refs.fusionVideoOverlay = q("#fusionVideoOverlay");
  refs.fusionVideo = q("#fusionVideo");
  refs.fusionKicker = q("#fusionKicker");
  refs.fusionStage = q("#fusionStage");
  refs.showcaseStage = q("#showcaseStage");
  refs.showcaseFrog = q("#showcaseFrog");
  refs.partnerSticker = q("#partnerSticker");
  refs.fusePartner = q("#fusePartner");
  refs.fusePartnerName = q("#fusePartnerName");
  refs.reveal = q("#reveal");
  refs.revealArt = q("#revealArt");
  refs.revealName = q("#revealName");
  refs.revealTag = q("#revealTag");
  refs.revealFeatures = q("#revealFeatures");
  refs.playBtn = q("#playBtn");
  refs.genPill = q("#genPill");
  refs.modelBadge = q("#modelBadge");
  refs.playStage = q("#playStage");
  refs.hint = q("#hint");
  refs.traitsTitle = q("#traitsTitle");
  refs.traitList = q("#traitList");
  refs.savedArt = q("#savedArt");
  refs.savedName = q("#savedName");
  refs.savedTrait = q("#savedTrait");
  refs.savedParents = q("#savedParents");
  refs.savedFoot = q("#savedFoot");
  refs.savedChip2 = q("#savedChip2");
  refs.legacyChip2 = q("#legacyChip2");
  refs.hi3dBtn = q("#hi3dBtn");
  refs.hi3dPanel = q("#hi3dPanel");
  refs.hi3dArt = q("#hi3dArt");
  refs.hi3dStatus = q("#hi3dStatus");
  refs.hi3dSubmit = q("#hi3dSubmit");
  refs.toast = q("#toast");
  refs.muteBtn = q("#muteBtn");

  refs.customParent.addEventListener("input", () => handlers.onCustomInput && handlers.onCustomInput(refs.customParent.value));
  refs.agentRetry.addEventListener("click", () => handlers.onBack && handlers.onBack("fusion"));
  refs.backBtn.addEventListener("click", () => handlers.onBack && handlers.onBack(currentScreen));
  refs.videoBackBtn.addEventListener("click", () => handlers.onBack && handlers.onBack("fusion"));
  refs.fuseBtn.addEventListener("click", () => handlers.onFuse && handlers.onFuse());
  refs.playBtn.addEventListener("click", () => handlers.onPlay && handlers.onPlay());
  q("#againBtn").addEventListener("click", () => handlers.onAgain && handlers.onAgain());
  refs.hi3dBtn.addEventListener("click", () => {
    refs.hi3dPanel.hidden = !refs.hi3dPanel.hidden;
    if (!refs.hi3dPanel.hidden && handlers.onHi3dOpen) handlers.onHi3dOpen();
  });
  refs.hi3dSubmit.addEventListener("click", () => handlers.onHi3dSubmit && handlers.onHi3dSubmit());
  refs.muteBtn.addEventListener("click", () => {
    const muted = handlers.onMuteToggle ? handlers.onMuteToggle() : false;
    refs.muteBtn.textContent = muted ? "🔇" : "🔊";
  });
  refs.partnerGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".pcard");
    if (!card) return;
    handlers.onSelectPartner && handlers.onSelectPartner(card.dataset.id);
  });
  refs.savedArt.addEventListener("error", () => refs.savedArt.classList.add("missing"));
  refs.savedArt.addEventListener("load", () => refs.savedArt.classList.remove("missing"));
  refs.revealArt.addEventListener("error", () => refs.revealArt.classList.add("missing"));
  refs.revealArt.addEventListener("load", () => refs.revealArt.classList.remove("missing"));
  return refs;
}

export function showScreen(name) {
  currentScreen = name;
  refs.backBtn.hidden = name === "home";
  root.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.dataset.screen === name);
  });
}

export function renderHome(partnerId) {
  refs.partnerGrid.innerHTML = PARTNERS.map((p) => {
    const picked = partnerId === p.id;
    return `
      <button class="pcard ${picked ? "selected" : ""}" data-id="${p.id}" style="--p-color:${p.color}">
        <span class="pick-num">${picked ? 2 : ""}</span>
        <span class="pcard-avatar"><img src="${p.thumb}" srcset="${p.thumb} 1x, ${p.avatar} 2x" alt="${p.name}" /></span>
        <span class="pcard-copy">
          <span class="pcard-name">${p.name}</span>
          <span class="pcard-note">${p.note}</span>
        </span>
        <span class="pcard-check">✓</span>
      </button>`;
  }).join("");

  refs.fuseBtn.disabled = !partnerId;
  refs.selectTip.textContent = partnerId
    ? `奶蛙 × ${(PARTNERS.find((p) => p.id === partnerId) || {}).name}（顺序不影响）`
    : "先挑一位现实亲本";


}

export function renderSavedChip(record) {
  [refs.savedChip, refs.savedChip2].forEach((el) => {
    if (!el) return;
    if (!record) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const parents = (record.parents || []).map(nameById).join(" × ");
    el.innerHTML = `上次留下的崽：<b>${record.babyName}</b> · 特征 <b>${record.traitName}</b>${
      parents ? `<br />${parents} 揉出来的 · ${new Date(record.at).toLocaleString("zh-CN", { hour12: false })}` : ""
    }`;
  });
}

export function renderLegacyChip(legacy) {
  [refs.legacyChip, refs.legacyChip2].forEach((el) => {
    if (!el) return;
    if (!legacy) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const parents = (legacy.parents || []).map((id) => LEGACY_PARENT_NAMES[id] || id).join(" × ");
    el.innerHTML = `旧版存档已保留：<b>${legacy.babyName}</b> · ${legacy.traitName}${
      parents ? `（${parents}）` : ""
    }<br /><span>v0.1 的崽不进新家族相册，但会一直显示在这里。</span>`;
  });
}

export function customParentValue() {
  return refs.customParent.value.trim();
}

export function clearCustomParent() {
  refs.customParent.value = "";
}

export function updateCustomParent(value) {
  const subject = value.trim();
  refs.partnerGrid.querySelectorAll(".pcard").forEach((card) => card.classList.remove("selected"));
  refs.fuseBtn.disabled = !subject;
  refs.selectTip.textContent = subject ? "奶蛙 × " + subject : "先挑选或输入一位亲本";
}

export function showAgentStatus(message, isError = false) {
  refs.fusionStage.hidden = true;
  refs.agentWait.hidden = false;
  refs.agentMessage.textContent = message;
  refs.agentRetry.hidden = !isError;
}

export function prepareFusion(partner, child) {
  refs.agentWait.hidden = true;
  refs.fusionStage.hidden = false;
  refs.fusePartner.src = partner.avatar;
  refs.fusePartnerName.textContent = partner.name;
  refs.showcaseFrog.src = FROG.art;
  refs.showcaseFrog.hidden = false;
  refs.showcaseStage.classList.remove("ready");
  refs.reveal.classList.remove("show");
  refs.fusionStage.classList.remove("merging", "merged");
  refs.fusionKicker.textContent = `${FROG.name} × ${partner.name} · 奶力搅拌中`;
}

export function playFusionVideo() {
  const video = refs.fusionVideo;
  const overlay = refs.fusionVideoOverlay;
  overlay.hidden = false;
  video.currentTime = 0;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (completed = true) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      cancelVideo = null;
      video.pause();
      overlay.hidden = true;
      resolve(completed);
    };
    const onEnded = () => finish(true);
    const onError = () => finish(true);
    const timeout = window.setTimeout(() => finish(true), 10000);
    cancelVideo = () => finish(false);
    video.addEventListener("ended", onEnded, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      const playback = video.play();
      if (playback) playback.catch(() => finish(true));
    } catch {
      finish();
    }
  });
}

export function cancelFusionVideo() {
  if (cancelVideo) cancelVideo();
}

export function showFusionResult(child) {
  refs.agentWait.hidden = true;
  refs.fusionStage.hidden = false;
  refs.fusionStage.classList.add("merged");
  renderReveal(child);
  refs.reveal.classList.add("show");
  refs.fusionKicker.textContent = "奶家人 · 新成员诞生";
}

export function startFusionMerge(child, onRevealed) {
  refs.fusionStage.classList.add("merging");
  window.setTimeout(() => {
    refs.fusionStage.classList.add("merged");
    refs.reveal.classList.add("show");
    renderReveal(child);
    onRevealed && onRevealed();
  }, 1500);
}

export function playFusion(partner, child, onRevealed) {
  prepareFusion(partner, child);
  startFusionMerge(child, onRevealed);
}

export function markShowcaseReady() {
  refs.showcaseStage.classList.add("ready");
  refs.showcaseFrog.hidden = true;
}

export function getShowcaseContainer() {
  return refs.showcaseStage;
}

export function renderReveal(child) {
  refs.revealArt.classList.remove("missing");
  refs.revealArt.src = child.art;
  refs.revealName.textContent = child.name;
  refs.revealTag.textContent = child.tagline;
  const feature = document.createElement("span");
  feature.textContent = child.featureLine;
  refs.revealFeatures.replaceChildren(feature);
}

export function renderTraits(child, onPick) {
  refs.traitsTitle.textContent = `${child.name} 露出两样本事`;
  refs.traitList.innerHTML = child.traits
    .map(
      (t) => `
      <button class="trait-card" data-id="${t.id}">
        <div class="trait-from">像 ${t.from}</div>
        <div class="tname"><span class="dot"></span>${t.name}</div>
        <div class="tdesc">${t.desc}</div>
        <div class="tkeep">✓ 就留它</div>
      </button>`,
    )
    .join("");
  refs.traitList.querySelectorAll(".trait-card").forEach((card) => {
    card.addEventListener("click", () => {
      refs.traitList.querySelectorAll(".trait-card").forEach((c) => c.classList.remove("picked"));
      card.classList.add("picked");
      window.setTimeout(() => onPick && onPick(child.traits.find((t) => t.id === card.dataset.id)), 260);
    });
  });
}

export function renderSaved(record) {
  refs.savedArt.classList.remove("missing");
  refs.savedArt.src = record.babyArt;
  refs.savedName.textContent = record.babyName;
  refs.savedTrait.textContent = `保留特征：${record.traitName}`;
  const parents = (record.parents || []).map(nameById).join(" × ");
  refs.savedParents.textContent = `${parents} 揉出来的 · ${record.traitDesc || ""}`;
  refs.savedFoot.textContent = `存档时间 ${new Date(record.at).toLocaleString("zh-CN", { hour12: false })}`;
  refs.hi3dPanel.hidden = true;
}

export function renderHi3d(child, status) {
  refs.hi3dArt.src = child.art;
  refs.hi3dArt.classList.remove("missing");
  const stateText = {
    none: "尚未提交",
    blocked_balance: "额度不足 · 未创建任务",
    submit_failed: "提交失败 · 未创建任务",
    submitted: "已创建任务",
    downloaded: "已生成并下载 GLB",
  }[status?.state] || status?.state || "未知";
  const creds = status?.credentials === "present" ? "服务端凭证已配置" : "服务端凭证未配置";
  const account = status?.account?.lastError?.code
    ? `<br /><span>账户最近错误 ${status.account.lastError.code} · ${status.account.lastError.message}</span>`
    : "";
  refs.hi3dStatus.innerHTML = `<b>${stateText}</b><br /><span>${creds}${
    status?.taskId ? ` · 任务 ${String(status.taskId).slice(0, 8)}` : ""
  }</span>${account}`;
  refs.hi3dSubmit.textContent = status?.taskId ? "查询任务" : "提交生成";
}

export function setHi3dBusy(text) {
  refs.hi3dStatus.innerHTML = `<b>${text}</b>`;
}

let toastTimer = 0;
export function toast(text, ms = 1800) {
  refs.toast.textContent = text;
  refs.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove("show"), ms);
}

export function setHint(text, flash = false) {
  refs.hint.innerHTML = text;
  if (flash) {
    refs.hint.classList.remove("flash");
    void refs.hint.offsetWidth;
    refs.hint.classList.add("flash");
  }
}

export function setModelBadge({ source, label, taskId, status, text }) {
  refs.modelBadge.classList.remove("real", "family", "fallback", "loading");
  if (source === "family-glb") refs.modelBadge.classList.add("family");
  else if (source === "hi3d-glb") refs.modelBadge.classList.add("real");
  else if (source === "loading") refs.modelBadge.classList.add("loading");
  else refs.modelBadge.classList.add("fallback");
  if (text) {
    refs.modelBadge.textContent = text;
    return;
  }
  const stateText = {
    "family-glb": "奶家人原始资产 · 已优化",
    "hi3d-glb": "Hi3D 新资产",
    loading: "模型加载中…",
    fallback: "2D 预览 · 模型未加载",
    error: "模型加载失败",
  }[source] || label || "模型";
  const tail = taskId ? ` · 任务 ${String(taskId).slice(0, 8)}` : status ? ` · ${status}` : "";
  refs.modelBadge.textContent = `${stateText}${tail}`;
}

export function setGenPill(text) {
  refs.genPill.textContent = text;
}

export function getPlayContainer() {
  return refs.playStage;
}

export function clearPlayStage() {
  refs.playStage.innerHTML = "";
}

export function setFusionTitle(text) {
  refs.fusionKicker.textContent = text;
}
