// 应用主控：奶家人屏幕流转 + 真实模型装配 + 存档
import * as ui from "./ui.js";
import { audio as gameAudio } from "./audio.js";
import {
  FROG,
  CHILDREN,
  partnerById,
  fusionForPartner,
  nameById,
} from "./recipes.js";
import {
  state,
  loadRecord,
  saveRecord,
  selectPartner,
  resetSelection,
  currentFusion,
} from "./state.js";
import { fetchHi3dStatus, submitHi3d } from "./hi3dClient.js";
import { startFusion, getFusion, clearPendingFusion } from "./fusionAgentClient.js";

let activeScene = null;
let activeShowcase = null;
let activeAudio = gameAudio;
let unlocked = false;
let sceneRequest = 0;
let fusionRequest = 0;

async function audio() {
  if (!activeAudio) {
    const mod = await import("./audio.js");
    activeAudio = mod.audio;
  }
  return activeAudio;
}

function teardownScene() {
  if (activeScene && typeof activeScene.dispose === "function") {
    try {
      activeScene.dispose();
    } catch (err) {
      console.warn("[scene] dispose failed", err);
    }
  }
  activeScene = null;
  ui.clearPlayStage();
}

function teardownShowcase() {
  if (activeShowcase && typeof activeShowcase.dispose === "function") {
    try {
      activeShowcase.dispose();
    } catch (err) {
      console.warn("[showcase] dispose failed", err);
    }
  }
  activeShowcase = null;
  ui.getShowcaseContainer().innerHTML = "";
}

function unlockAudioOnce() {
  if (unlocked) return;
  unlocked = true;
  audio().then((a) => a.unlock && a.unlock());
}

function selectPartnerId(id) {
  ui.clearCustomParent();
  const picked = selectPartner(id);
  ui.renderHome(picked, state.discovered);
}

async function mountShowcase() {
  const container = ui.getShowcaseContainer();
  container.innerHTML = "";
  try {
    const mod = await import("./three/familyShowcase.js");
    const scene = await mod.createShowcase(container, { id: "niwa" });
    if (scene.getModelSource && scene.getModelSource() === "family-glb") {
      activeShowcase = scene;
      ui.markShowcaseReady();
      return true;
    }
    scene.dispose && scene.dispose();
    return false;
  } catch (err) {
    console.warn("[showcase] 3D unavailable, keep 2D render:", err.message);
    return false;
  }
}

function onCustomInput(value) {
  state.partner = null;
  ui.updateCustomParent(value);
}

async function onCustomFuse(subject) {
  const request = ++fusionRequest;
  const partner = { name: subject, avatar: FROG.art };
  state.fusion = null;
  teardownShowcase();
  ui.prepareFusion(partner, null);
  ui.showScreen("fusion");
  activeAudio.fusion();
  const creation = startFusion(subject).then((job) => ({ job }), (error) => ({ error }));
  const played = await ui.playFusionVideo();
  if (!played || request !== fusionRequest) return;
  try {
    ui.showAgentStatus("正在准备生成任务");
    const created = await creation;
    if (created.error) throw created.error;
    let job = created.job;
    while (request === fusionRequest) {
      if (job.state === "complete") {
        const result = job.result;
        const child = {
          id: "custom-" + job.id,
          name: result.name,
          partnerName: subject,
          art: result.imageUrl,
          model: result.modelUrl,
          tagline: "奶蛙 × " + subject,
          featureLine: result.frogFeatures + " · " + result.subjectFeatures,
          playHint: "左右拖动，看看新成员的每一面",
          doneText: "",
          previewOnly: true,
        };
        state.fusion = child;
        clearPendingFusion();
        ui.showFusionResult(child);
        return;
      }
      if (job.state === "failed" || job.state === "submission_unknown") {
        if (job.state === "failed") clearPendingFusion();
        ui.showAgentStatus(job.error || "生成未完成", true);
        return;
      }
      ui.showAgentStatus(job.message || "正在生成");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (request !== fusionRequest) return;
      job = await getFusion(job.id);
    }
  } catch (error) {
    if (request === fusionRequest) ui.showAgentStatus(error.message || "生成暂时不可用", true);
  }
}

async function onFuse() {
  const subject = ui.customParentValue();
  if (subject) return onCustomFuse(subject);
  const child = currentFusion();
  if (!child) return;
  state.fusion = child;
  const partner = partnerById(child.partner);
  teardownShowcase();
  ui.prepareFusion(partner, child);
  ui.showScreen("fusion");
  activeAudio.fusion();
  const completed = await ui.playFusionVideo();
  if (!completed || state.fusion !== child) return;
  ui.showFusionResult(child);
}

function make2dChild(container, child, { onGoal, onEvent, hint }) {
  const hotspot = {
    "tap-shell": { top: 18, left: 12, right: 12, bottom: 12, label: "蛋壳" },
    "tap-hair": { top: 4, left: 24, right: 24, bottom: 58, label: "刘海" },
    "tap-comb": { top: 2, left: 30, right: 30, bottom: 66, label: "红冠" },
    "drag-tail": { top: 44, left: 52, right: 2, bottom: 10, label: "尾巴" },
  }[child.action] || { top: 20, left: 20, right: 20, bottom: 20, label: "身上" };

  container.innerHTML = `
    <div class="child2d" data-child="${child.id}">
      <img src="${child.art}" alt="${child.name}" draggable="false" />
      <div class="child2d-hotspot" style="top:${hotspot.top}%;left:${hotspot.left}%;right:${hotspot.right}%;bottom:${hotspot.bottom}%"></div>
      <div class="child2d-tag">2D 预览 · 真实模型加载中</div>
    </div>`;
  const wrap = container.querySelector(".child2d");
  const img = wrap.querySelector("img");
  const zone = wrap.querySelector(".child2d-hotspot");
  let done = false;
  let dragStart = null;
  let totalDrag = 0;
  let direction = 0;

  function fire(type) {
    onEvent && onEvent(type);
  }
  function goal() {
    if (done) return;
    done = true;
    onGoal && onGoal();
  }
  function bounce() {
    wrap.classList.remove("anim-bounce");
    void wrap.offsetWidth;
    wrap.classList.add("anim-bounce");
    fire("bounce");
    goal();
  }
  function giggle() {
    wrap.classList.remove("anim-giggle");
    void wrap.offsetWidth;
    wrap.classList.add("anim-giggle");
    fire("giggle");
    goal();
  }
  function crow() {
    wrap.classList.remove("anim-crow");
    void wrap.offsetWidth;
    wrap.classList.add("anim-crow");
    fire("crow");
    goal();
  }

  if (child.action === "tap-shell") {
    zone.addEventListener("pointerup", bounce);
  } else if (child.action === "tap-hair") {
    zone.addEventListener("pointerup", giggle);
  } else if (child.action === "tap-comb") {
    zone.addEventListener("pointerup", crow);
  } else {
    zone.addEventListener("pointerdown", (e) => {
      dragStart = e.clientX;
      totalDrag = 0;
      direction = 0;
      zone.setPointerCapture(e.pointerId);
      wrap.classList.add("dragging");
    });
    zone.addEventListener("pointermove", (e) => {
      if (dragStart == null) return;
      const dx = e.clientX - dragStart;
      const rot = Math.max(-10, Math.min(10, dx / 6));
      img.style.transform = `rotate(${rot}deg)`;
      if (Math.abs(dx) > 20) {
        const d = Math.sign(dx);
        if (direction && d !== direction) totalDrag += 40;
        direction = d;
      }
      totalDrag = Math.max(totalDrag, Math.abs(dx));
    });
    zone.addEventListener("pointerup", () => {
      wrap.classList.remove("dragging");
      img.style.transform = "";
      dragStart = null;
      if (totalDrag > 60) {
        wrap.classList.remove("anim-wag");
        void wrap.offsetWidth;
        wrap.classList.add("anim-wag");
        fire("wag");
        goal();
      } else {
        hint && hint("再拖远一点，尾巴才会摇起来");
        fire("miss");
      }
    });
  }

  container.addEventListener("pointerdown", (event) => {
    if (!zone.contains(event.target) && !done) {
      hint && hint("这边够不到，试试" + hotspot.label);
      fire("miss");
    }
  });

  return {
    getModelSource: () => "fallback-2d",
    dispose() {
      container.innerHTML = "";
    },
    reset() {
      done = false;
    },
    getDebugState: () => ({ childId: child.id, modelSource: "fallback-2d", done }),
  };
}

async function onPlay() {
  const request = ++sceneRequest;
  const child = state.fusion;
  if (!child) return;
  const partner = child.previewOnly ? { name: child.partnerName } : partnerById(child.partner);
  ui.showScreen("play");
  teardownScene();
  ui.setHint(child.playHint);
  ui.setGenPill(`奶蛙 × ${partner.name} · ${child.name}`);
  ui.setModelBadge({ source: "loading", text: "模型加载中…" });

  const container = ui.getPlayContainer();
  const onEvent = (name) => {
    audio().then((a) => {
      if (name === "bounce") a.bounce && a.bounce();
      if (name === "giggle") a.giggle && a.giggle();
      if (name === "wag") a.wag && a.wag();
      if (name === "crow") a.crow && a.crow();
      if (name === "birth") a.birth && a.birth();
      if (name === "miss") a.tick && a.tick();
      if (name === "bark") a.bark && a.bark();
    });
    if (name === "miss") ui.setHint(`这边够不到，试试${child.playHint}`, true);
    if (name === "bounce") ui.setHint("它弹起来了！<b>再戳一下试试</b>", true);
    if (name === "giggle") ui.setHint("刘海先笑了，<b>它自己也在笑</b>", true);
    if (name === "wag") ui.setHint("尾巴摇起来了！<b>它开心得直蹦</b>", true);
    if (name === "crow") ui.setHint("喔喔——<b>尾羽跟着炸开</b>", true);
  };
  const onGoal = () => {
    ui.setHint(`<b>${child.doneText}</b>`, true);
    audio().then((a) => a.ding && a.ding());
    window.setTimeout(() => proceedToTraits(), 550);
  };

  try {
    const mod = await import("./three/familyChild.js");
    const scene = await mod.createFamilyChild(container, {
      childId: child.id,
      modelUrl: child.previewOnly ? child.model : undefined,
      previewOnly: !!child.previewOnly,
      onGoal,
      onEvent,
      hint: (text) => ui.setHint(text, true),
      onLoad: (info) => {
        ui.setModelBadge({
          source: info?.ok === false ? "fallback" : "family-glb",
          text: info?.modelSource === "fallback" ? "模型加载失败" : child.previewOnly ? "Hi3D 新生成模型" : "奶家人原始资产 · 已优化",
        });
      },
    });
    if (request !== sceneRequest) {
      scene.dispose && scene.dispose();
      return;
    }
    activeScene = scene;
    const source =
      (activeScene && typeof activeScene.getModelSource === "function" && activeScene.getModelSource()) ||
      "family-glb";
    ui.setModelBadge({
      source: source === "family-glb" ? "family-glb" : "fallback",
      text: source === "family-glb" ? (child.previewOnly ? "Hi3D 新生成模型" : "奶家人原始资产 · 已优化") : "模型未加载",
    });
    console.log("[child] model source =", source);
  } catch (err) {
    if (request !== sceneRequest) return;
    console.warn("[child] 3D unavailable, use 2D preview:", err.message);
    activeScene = make2dChild(container, child, {
      onGoal,
      onEvent,
      hint: (text) => ui.setHint(text, true),
    });
    ui.setModelBadge({ source: "fallback", text: "2D 预览 · 3D 模块未就绪" });
  }
}

function proceedToTraits() {
  const child = state.fusion;
  if (!child) return;
  ui.showScreen("traits");
  ui.renderTraits(child, (trait) => {
    const record = saveRecord({ child, trait });
    ui.renderSaved(record);
    ui.renderSavedChip(record);
    ui.renderHome(state.partner, state.discovered);
    ui.showScreen("saved");
    void loadHi3d(child);
  });
}

async function loadHi3d(child) {
  const status = await fetchHi3dStatus(child.id);
  state.hi3d = status;
  ui.renderHi3d(child, status);
}

async function onHi3dSubmit() {
  const child = state.fusion;
  if (!child) return;
  ui.setHi3dBusy("提交中…（服务端处理）");
  try {
    const data = await submitHi3d(child.id);
    if (data.ok) {
      ui.toast("Hi3D 任务已创建", 2200);
    } else {
      ui.toast(data.bizCode === "30010000" ? "额度不足，未创建任务" : "提交未成功，详见面板", 2400);
    }
  } catch (err) {
    ui.toast("提交请求失败：" + err.message, 2400);
  }
  await loadHi3d(child);
}

function onAgain() {
  activeAudio.stopFusion();
  sceneRequest++;
  ui.cancelFusionVideo();
  teardownScene();
  teardownShowcase();
  resetSelection();
  ui.renderHome(null, state.discovered);
  ui.showScreen("home");
}

function onBack(screen) {
  if (screen === "fusion") {
    fusionRequest++;
    activeAudio.stopFusion();
    ui.cancelFusionVideo();
    ui.renderHome(state.partner, state.discovered);
    if (ui.customParentValue()) ui.updateCustomParent(ui.customParentValue());
    ui.showScreen("home");
  } else if (screen === "play") {
    sceneRequest++;
    teardownScene();
    ui.showScreen("fusion");
  } else if (screen === "traits") {
    ui.showScreen("play");
  } else if (screen === "saved") {
    onGoal();
  }
}

function boot() {
  const app = document.getElementById("app");
  ui.mountUI(app, {
    onSelectPartner: selectPartnerId,
    onCustomInput,
    onFuse,
    onPlay,
    onAgain,
    onBack,
    onHi3dOpen: () => {
      const child = state.fusion;
      if (child) void loadHi3d(child);
    },
    onHi3dSubmit,
    onMuteToggle: () => {
      const a = activeAudio;
      if (a && a.toggleMute) return a.toggleMute();
      audio().then((mod) => mod.toggleMute());
      return !state.muted;
    },
  });
  document.addEventListener("pointerdown", unlockAudioOnce, { once: true });
  loadRecord();
  if (state.record) {
    ui.renderSavedChip(state.record);
    ui.renderSaved(state.record);
  }
  if (state.legacy) ui.renderLegacyChip(state.legacy);
  ui.renderHome(state.partner, state.discovered);
  ui.showScreen("home");

  window.__zheizai = {
    state,
    get scene() {
      return activeScene;
    },
    get showcase() {
      return activeShowcase;
    },
    get audio() {
      return activeAudio;
    },
  };
  console.log("[zheizai] 奶家人 v0.2 ready · 亲本 奶蛙 + 4 位现实亲本");
}

boot();
