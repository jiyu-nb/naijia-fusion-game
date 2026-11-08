// src/three/familyChild.js —— 四个子代共用的通用引擎（owner: three-frog）
// createFamilyChild(container, { childId:'naidan'|'naibao'|'naigou'|'naiji', onGoal, onEvent, hint, ... })
//
// 四个子代都是「奶蛙 × 现实亲本」的真实 GLB（无骨骼/无动画），所以动作用整体轻量运动实现：
//   naidan 奶蛋：点蛋壳 → 压扁回弹 +「啵」        onEvent('bounce')
//   naibao 奶包：点头顶刘海 → 上下弹 + 刘海高光 +「嘿嘿」 onEvent('giggle')
//   naigou 奶狗：横向拖尾巴 → 整体左右摆 +「汪」   onEvent('wag')  累计≥110px 或来回 2 次 → onGoal
//   naiji  奶鸡：点头顶红冠 → 振翅式弹 + 尾羽高光 +「喔喔」 onEvent('crow')
// 热点用「模型局部坐标」判定：跟着模型朝向/转台一起转；点空白或背面只 onEvent('miss')。
import * as THREE from 'three';
import { createStage } from './stage.js';
import {
  FAMILY,
  TARGET_HEIGHT,
  addFamilyLights,
  buildFallbackBody,
  buildLoadingOverlay,
  countTriangles,
  createBirthBurst,
  createGlowSpot,
  disposeObject3D,
  ensurePositioned,
  fitCameraToBox,
  hasNoBirthQuery,
  loadGLB,
  normalizeModel,
  preloadLoaderModules,
  spinBoxOf,
} from './familyCore.js';

const GOAL_DRAG_PX = 110; // 奶狗：累计拖动达标
const GOAL_REVERSALS = 2; // 奶狗：来回次数达标
const DRAG_START_PX = 8; // 奶狗：拖尾巴起手阈值
const WAG_STEP_PX = 36; // 奶狗：每甩这么多像素摇一次
const TAP_SLOP_PX = 44; // 热点屏幕容差：手指点到热点附近也算命中（保证 hotspots 坐标必中）

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

// ---------------- 四个子代规格 ----------------
// hotspot.kind:
//   'shell'  蛋壳：命中点在上半部且朝前（整片壳都算，符合「点壳任意处」）
//   'sphere' 局部球：anchor = (x*W/2, y*H, z*D/2)，跟着模型转
export const CHILD_SPECS = {
  naidan: {
    childId: 'naidan',
    name: '奶蛋',
    bodyId: 'naidan',
    action: 'bounce',
    event: 'bounce',
    hotspotKey: 'shell',
    hotspot: { kind: 'shell', yMin: 0.28, zMin: -0.05, anchorY: 0.6, anchorZ: 0.45 },
    camera: { elev: 12, yaw: 0, fill: 0.9 },
    hintMain: '啵！',
    hintIdle: '点它的蛋壳，会啵一声',
    hintMiss: '点在蛋壳上呀，这里是奶蛋的壳',
  },
  naibao: {
    childId: 'naibao',
    name: '奶包',
    bodyId: 'naibao',
    action: 'giggle',
    event: 'giggle',
    hotspotKey: 'fringe',
    hotspot: { kind: 'sphere', at: [0, 0.885, 0.3], radius: 0.42 },
    camera: { elev: 15, yaw: 0, fill: 0.9 },
    hintMain: '嘿嘿～',
    hintIdle: '点它头顶的刘海，会嘿嘿笑',
    hintMiss: '刘海在头顶上，再往上点点',
  },
  naigou: {
    childId: 'naigou',
    name: '奶狗',
    bodyId: 'naigou',
    action: 'wag',
    event: 'wag',
    hotspotKey: 'tail',
    hotspot: { kind: 'sphere', at: [0, 0.62, -0.95], radius: 0.55 },
    camera: { elev: 15, yaw: 0.62, fill: 0.98 },
    hintMain: '汪！',
    hintIdle: '抓住屁股后面的小尾巴，左右甩一甩',
    hintMiss: '尾巴在屁股后面，抓它甩一甩',
  },
  naiji: {
    childId: 'naiji',
    name: '奶鸡',
    bodyId: 'naiji',
    action: 'crow',
    event: 'crow',
    hotspotKey: 'comb',
    hotspot: { kind: 'sphere', at: [0, 0.95, 0.05], radius: 0.45 },
    // 打鸣时尾羽区域也闪一下（红冠在头顶、尾羽在身后）
    extraGlow: { at: [0, 0.62, -0.62], scale: 1.1 },
    camera: { elev: 14, yaw: 0, fill: 0.93 },
    hintMain: '喔喔——',
    hintIdle: '点它头顶的红冠，会喔喔叫',
    hintMiss: '红冠在头顶最高处',
  },
};

/**
 * @param {HTMLElement} container
 * @param {{childId:'naidan'|'naibao'|'naigou'|'naiji', onGoal?:Function, onEvent?:Function,
 *          hint?:Function, onLoad?:Function, noUI?:boolean, transparent?:boolean,
 *          noBirth?:boolean, turntable?:boolean}} opts
 */
export async function createFamilyChild(container, opts = {}) {
  const childId = CHILD_SPECS[opts.childId] ? opts.childId : 'naidan';
  const spec = CHILD_SPECS[childId];
  const noUI = !!opts.noUI;
  const noBirth = !!opts.noBirth || hasNoBirthQuery();
  // modelUrl：Hi3D 生成变体后覆盖用；默认取本家亲本 GLB
  const url = opts.modelUrl || `/assets/family/${spec.bodyId}.glb`;

  const state = {
    childId,
    loaded: false,
    modelSource: 'fallback',
    loadMs: 0,
    loadError: null,
    goalFired: false,
    actionCount: 0,
    lastEvent: null,
    dragAccum: 0,
    reversals: 0,
    busy: false,
    born: false,
    triangles: 0,
    modelSize: { x: 0, y: 0, z: 0 },
    prepMs: 0,
    totalMs: 0,
  };

  const emit = {
    event(type) {
      state.lastEvent = type;
      try { opts.onEvent && opts.onEvent(type); } catch (err) { console.warn('[family] onEvent 异常', err); }
    },
    hint(text) {
      if (noUI) return;
      try { opts.hint && opts.hint(String(text)); } catch (err) { console.warn('[family] hint 异常', err); }
    },
    goal(payload) {
      try { opts.onGoal && opts.onGoal(payload); } catch (err) { console.warn('[family] onGoal 异常', err); }
    },
  };

  const stage = createStage(container, { preserveDrawingBuffer: !!opts.transparent });
  const { scene, camera } = stage;
  const extraLights = addFamilyLights(scene);
  const restoreContainerStyle = ensurePositioned(container);
  const overlay = noUI ? null : buildLoadingOverlay(container);

  const root = new THREE.Group();
  root.name = `family-child-${childId}`;
  root.rotation.order = 'YXZ';
  scene.add(root);

  // ---------------- 加载身体 GLB ----------------
  // 计时拆分：prepMs = 建舞台 + GLTFLoader/meshopt 模块解析（每页只发生一次）；
  //           loadMs = 纯 GLB fetch + meshopt 解码；totalMs = 从调用到就绪
  const entryAt = performance.now();
  const modulesReady = preloadLoaderModules();
  const t0 = performance.now();
  let bodyWrap = null;
  let gltfMs = 0;
  try {
    await modulesReady;
    state.prepMs = Math.round(performance.now() - t0);
    const tFetch = performance.now();
    const gltf = await loadGLB(url, (pct) => {
      if (!overlay) return;
      if (pct == null) overlay.setProgress(60);
      else overlay.setProgress(Math.min(96, pct * 0.94));
    });
    gltfMs = performance.now() - tFetch;
    const body = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!body) throw new Error('GLB 里没有可用 scene');
    state.modelSource = 'family-glb';
    state.triangles = countTriangles(body);
    bodyWrap = normalizeModel(body, TARGET_HEIGHT);
  } catch (err) {
    state.loadError = (err && (err.message || err.type)) || String(err);
    console.warn(`[family] ${spec.name} GLB 加载失败，回退程序化奶团：`, state.loadError);
    bodyWrap = normalizeModel(buildFallbackBody(), TARGET_HEIGHT);
    if (overlay) overlay.setText('奶力没接上，先用奶团顶着');
  }
  state.loadMs = Math.round(gltfMs);
  state.totalMs = Math.round(performance.now() - entryAt);
  state.loaded = true;
  state.modelSize = {
    x: +bodyWrap.size.x.toFixed(3),
    y: +bodyWrap.size.y.toFixed(3),
    z: +bodyWrap.size.z.toFixed(3),
  };
  root.add(bodyWrap.wrap);

  // ---------------- 热点（归一化 bbox 比例 → 局部坐标）----------------
  const size = state.modelSize;
  const hotspot = { key: spec.hotspotKey, kind: spec.hotspot.kind };
  if (spec.hotspot.kind === 'sphere') {
    const [xf, yf, zf] = spec.hotspot.at;
    hotspot.anchor = new THREE.Vector3(xf * size.x * 0.5, yf * size.y, zf * size.z * 0.5);
    hotspot.radius = spec.hotspot.radius * (size.y / TARGET_HEIGHT);
  } else {
    hotspot.anchor = new THREE.Vector3(0, spec.hotspot.anchorY * size.y, spec.hotspot.anchorZ * size.z * 0.5);
    hotspot.radius = 0;
  }

  const glowSpots = [];
  function addGlowSpot(localPos, scaleFactor = 0.9) {
    const g = createGlowSpot(FAMILY.milk, Math.max(size.x, size.z) * scaleFactor);
    g.sprite.position.copy(localPos);
    root.add(g.sprite);
    glowSpots.push(g);
    return g;
  }
  const glow = addGlowSpot(hotspot.anchor, 0.9);
  if (spec.extraGlow) {
    const [exf, eyf, ezf] = spec.extraGlow.at;
    addGlowSpot(
      new THREE.Vector3(exf * size.x * 0.5, eyf * size.y, ezf * size.z * 0.5),
      spec.extraGlow.scale || 0.9,
    );
  }
  const playGlow = (intensity = 1) => { for (const g of glowSpots) g.play(intensity); };
  const updateGlow = (dt) => { for (const g of glowSpots) g.update(dt); };
  const resetGlow = () => { for (const g of glowSpots) g.reset(); };

  const burst = createBirthBurst({ radius: Math.max(size.x, size.z) * 0.62 });
  root.add(burst.group);

  // ---------------- 朝向 / 取景 ----------------
  const baseYaw = spec.camera.yaw || 0;
  root.rotation.y = baseYaw;
  root.updateMatrixWorld(true);
  // 取景框只按「身体 + 配件」算，别把出生粒子/光斑算进去（否则整体被推远、显得小）
  const fullBox = spinBoxOf(new THREE.Box3().setFromObject(bodyWrap.wrap));
  fullBox.expandByVector(new THREE.Vector3(0.06, 0.06, 0.06));
  let lastAspect = -1;
  const refit = () => {
    lastAspect = camera.aspect;
    fitCameraToBox(camera, fullBox, {
      elevDeg: spec.camera.elev,
      fill: spec.camera.fill,
    });
  };
  refit();

  // ---------------- 整体 emissive 反馈（静音也有反应）----------------
  const flashEntries = [];
  const seenMats = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || !m.emissive || seenMats.has(m)) continue;
      seenMats.add(m);
      flashEntries.push({
        material: m,
        baseEmissive: m.emissive.clone(),
        baseIntensity: typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 1,
      });
    }
  });
  const flashColor = new THREE.Color(FAMILY.milk);
  const tmpColor = new THREE.Color();
  let flashT = 0;
  let flashStrength = 0;
  function flash(color = FAMILY.milk, strength = 0.4) {
    flashColor.set(color);
    flashStrength = strength;
    flashT = 1;
  }
  function updateFlash(dt) {
    if (flashT <= 0) return;
    flashT = Math.max(0, flashT - dt / 0.42);
    const k = flashT * flashStrength;
    for (const e of flashEntries) {
      if (k > 0.004) {
        tmpColor.copy(e.baseEmissive).lerp(flashColor, Math.min(k * 1.6, 1));
        e.material.emissive.copy(tmpColor);
        e.material.emissiveIntensity = 1 + k * 1.8;
      } else {
        e.material.emissive.copy(e.baseEmissive);
        e.material.emissiveIntensity = e.baseIntensity;
      }
    }
  }
  function resetFlash() {
    flashT = 0;
    for (const e of flashEntries) {
      e.material.emissive.copy(e.baseEmissive);
      e.material.emissiveIntensity = e.baseIntensity;
    }
  }

  // ---------------- tween / timer ----------------
  const tweens = [];
  const timers = [];
  function tween({ dur = 0.3, ease = easeOutQuad, onUpdate, onDone, channel = 'default' }) {
    const item = { dur: Math.max(dur, 1e-4), t: 0, ease, onUpdate, onDone, channel };
    tweens.push(item);
    if (onUpdate) onUpdate(ease(0), 0);
    return item;
  }
  function after(delay, fn, channel = 'default') {
    timers.push({ t: delay, fn, channel });
  }
  function cancelChannel(channel) {
    for (let i = tweens.length - 1; i >= 0; i -= 1) if (tweens[i].channel === channel) tweens.splice(i, 1);
    for (let i = timers.length - 1; i >= 0; i -= 1) if (timers[i].channel === channel) timers.splice(i, 1);
  }
  function updateTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i -= 1) {
      const tw = tweens[i];
      tw.t += dt;
      const p = clamp01(tw.t / tw.dur);
      if (tw.onUpdate) tw.onUpdate(tw.ease(p), p);
      if (p >= 1) {
        tweens.splice(i, 1);
        if (tw.onDone) tw.onDone();
      }
    }
  }
  function updateTimers(dt) {
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) {
        const { fn } = timers[i];
        timers.splice(i, 1);
        if (fn) fn();
      }
    }
  }

  // ---------------- 运行时姿态 ----------------
  let tSec = 0;
  let bodySquash = 1;
  let hopY = 0;
  let swayZ = 0;
  let pitchX = 0;
  let birthScale = 1;
  let pulse = 1;
  let rotationOffset = 0;

  function applyPose() {
    const breath = 1 + Math.sin(tSec * 1.75) * 0.012;
    const idleYaw = Math.sin(tSec * 0.9) * (opts.turntable ? 0.14 : 0.035);
    root.rotation.y = baseYaw + rotationOffset + idleYaw;
    root.rotation.z = swayZ;
    root.rotation.x = pitchX;
    root.position.y = hopY;
    const sy = bodySquash * breath * birthScale;
    const sxz = birthScale * (1 / Math.sqrt(Math.max(sy, 0.06))) * pulse;
    root.scale.set(sxz, sy, sxz);
    if (pulse > 1) pulse = Math.max(1, pulse - 0.06);
  }

  // ---------------- 出生 ----------------
  function playBirth({ silent = false } = {}) {
    cancelChannel('birth');
    birthScale = 0.2;
    burst.reset();
    burst.play();
    if (!silent) emit.event('birth');
    emit.hint(opts.previewOnly ? "左右拖动，查看模型" : spec.hintIdle);
    tween({
      channel: 'birth',
      dur: 0.95,
      ease: easeOutBack,
      onUpdate: (e) => { birthScale = 0.2 + 0.8 * Math.max(0.02, e); },
      onDone: () => { birthScale = 1; state.born = true; },
    });
    after(0.88, () => {
      tween({
        channel: 'birth',
        dur: 0.32,
        ease: easeOutQuad,
        onUpdate: (e) => { bodySquash = 1 - 0.09 * Math.sin(e * Math.PI); },
        onDone: () => { bodySquash = 1; },
      });
    }, 'birth');
  }

  // ---------------- 主动作 ----------------
  function finishGoal() {
    if (state.goalFired) return;
    state.goalFired = true;
    after(0.16, () => emit.goal({
      childId,
      action: spec.action,
      actionCount: state.actionCount,
      traitHits: [spec.action],
    }), 'goal');
  }

  /** 奶蛋：压扁回弹 + 「啵」+ 轻微弹跳 */
  function doBounce() {
    if (state.busy) return;
    state.busy = true;
    state.actionCount += 1;
    emit.event('bounce');
    emit.hint(spec.hintMain);
    playGlow(1);
    flash(FAMILY.milk, 0.32);
    pulse = 1.05;
    tween({
      channel: 'bounce',
      dur: 0.62,
      ease: (t) => t,
      onUpdate: (e) => {
        if (e < 0.26) {
          const p = e / 0.26;
          bodySquash = 1 - 0.2 * Math.sin(p * Math.PI * 0.5);
          hopY = 0;
        } else if (e < 0.62) {
          const p = (e - 0.26) / 0.36;
          bodySquash = 1 + 0.1 * Math.sin(p * Math.PI);
          hopY = Math.sin(p * Math.PI) * 0.16;
        } else {
          const p = (e - 0.62) / 0.38;
          bodySquash = 1 - 0.12 * Math.sin(p * Math.PI);
          hopY = 0;
        }
      },
      onDone: () => { hopY = 0; bodySquash = 1; state.busy = false; },
    });
    finishGoal();
  }

  /** 奶包：整体上下弹两下 + 刘海高光 + 「嘿嘿」 */
  function doGiggle() {
    if (state.busy) return;
    state.busy = true;
    state.actionCount += 1;
    emit.event('giggle');
    emit.hint(spec.hintMain);
    playGlow(1);
    flash(FAMILY.milk, 0.24);
    tween({
      channel: 'giggle',
      dur: 0.78,
      ease: (t) => t,
      onUpdate: (e) => {
        const hops = Math.sin(e * Math.PI * 4);
        hopY = Math.max(0, Math.abs(hops)) * 0.13;
        bodySquash = 1 - 0.07 * Math.max(0, -hops);
        pitchX = hops * 0.035;
        swayZ = Math.sin(e * Math.PI * 2) * 0.03;
      },
      onDone: () => { hopY = 0; bodySquash = 1; pitchX = 0; swayZ = 0; state.busy = false; },
    });
    finishGoal();
  }

  /** 奶鸡：振翅式上下弹 + 尾羽高光 + 「喔喔」 */
  function doCrow() {
    if (state.busy) return;
    state.busy = true;
    state.actionCount += 1;
    emit.event('crow');
    emit.hint(spec.hintMain);
    playGlow(1.1);
    flash(FAMILY.gold, 0.34);
    tween({
      channel: 'crow',
      dur: 0.82,
      ease: (t) => t,
      onUpdate: (e) => {
        const flap = Math.sin(e * Math.PI * 3);
        hopY = Math.max(0, flap) * 0.22;
        bodySquash = 1 + 0.09 * flap;
        pitchX = -flap * 0.06;
        swayZ = Math.sin(e * Math.PI * 1.5) * 0.03;
      },
      onDone: () => { hopY = 0; bodySquash = 1; pitchX = 0; swayZ = 0; state.busy = false; },
    });
    finishGoal();
  }

  /** 奶狗：整体左右摆（±10°）+ 弹跳 + 「汪」 */
  function doWag({ cycles = 2.5, dur = 0.6 } = {}) {
    cancelChannel('wag');
    playGlow(0.9);
    tween({
      channel: 'wag',
      dur,
      ease: (t) => t,
      onUpdate: (e) => {
        const w = Math.sin(e * Math.PI * 2 * cycles);
        swayZ = w * 0.175; // ±10°
        hopY = Math.max(0, Math.abs(w) - 0.55) * 0.34;
        bodySquash = 1 - 0.05 * Math.max(0, -w);
      },
      onDone: () => { swayZ = 0; hopY = 0; bodySquash = 1; },
    });
  }

  function doMiss() {
    emit.event('miss');
    emit.hint(spec.hintMiss);
    flash(FAMILY.milk, 0.14);
  }

  // ---------------- 拾取 ----------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const rect = stage.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !state.loaded) return null;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    scene.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(root, true);
    for (const h of hits) {
      if (h.object && h.object.userData && h.object.userData.isSpriteHelper) continue;
      if (h.object && h.object.parent && h.object.parent.userData && h.object.parent.userData.isSpriteHelper) continue;
      return { point: h.point.clone(), object: h.object };
    }
    return null;
  }

  /** 局部坐标是否落在热点里（热点跟着模型转） */
  function isHotspot(local) {
    if (hotspot.kind === 'sphere') return local.distanceTo(hotspot.anchor) <= hotspot.radius;
    return local.y > spec.hotspot.yMin * size.y && local.z > spec.hotspot.zMin * size.z * 0.5;
  }

  /**
   * 统一命中判定：先 raycast（局部热点），再补一层屏幕容差——
   * 保证「点 getDebugState().hotspots 投影出来的坐标」必定命中，小朋友手指也不用抠像素。
   */
  function resolvePointer(clientX, clientY) {
    const hit = pick(clientX, clientY);
    let onHotspot = false;
    if (hit) onHotspot = isHotspot(root.worldToLocal(hit.point.clone()));
    if (!onHotspot) {
      const p = projectLocal(hotspot.anchor);
      if (p && p.visible && Math.hypot(p.x - clientX, p.y - clientY) <= TAP_SLOP_PX) onHotspot = true;
    }
    return { hit, onHotspot };
  }

  // ---------------- Pointer Events ----------------
  let pointer = null;
  let lastWagAt = 0;

  function onPointerDown(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (pointer) return;
    const resolved = resolvePointer(ev.clientX, ev.clientY);
    pointer = {
      id: ev.pointerId,
      startX: ev.clientX,
      lastX: ev.clientX,
      startY: ev.clientY,
      lastY: ev.clientY,
      rotating: false,
      hit: resolved.hit,
      onHotspot: opts.previewOnly ? false : resolved.onHotspot,
      dragging: false,
      dir: 0,
      accum: 0,
    };
    try { stage.canvas.setPointerCapture(ev.pointerId); } catch { /* 忽略 */ }
  }

  function onPointerMove(ev) {
    if (!pointer || ev.pointerId !== pointer.id) return;
    if (spec.action !== 'wag' || !pointer.onHotspot) {
      const dx = ev.clientX - pointer.startX;
      const dy = ev.clientY - pointer.startY;
      if (!pointer.rotating && Math.hypot(dx, dy) < DRAG_START_PX) return;
      pointer.rotating = true;
      pointer.dragging = true;
      rotationOffset += (ev.clientX - pointer.lastX) * 0.012;
      pointer.lastX = ev.clientX;
      pointer.lastY = ev.clientY;
      stage.requestRender();
      return;
    }
    const dx = ev.clientX - pointer.startX;
    if (!pointer.dragging) {
      if (Math.abs(dx) < DRAG_START_PX) return;
      pointer.dragging = true;
      state.actionCount += 1;
      state.dragAccum += Math.abs(dx);
      pointer.accum = Math.abs(dx);
      doWag({ cycles: 2, dur: 0.5 });
      emit.event('wag');
      emit.hint(spec.hintMain);
      return;
    }
    const step = Math.abs(ev.clientX - pointer.lastX);
    pointer.lastX = ev.clientX;
    state.dragAccum += step;
    pointer.accum += step;

    const dir = Math.sign(dx);
    if (pointer.dir === 0) pointer.dir = dir;
    else if (dir !== pointer.dir && Math.abs(dx) > 24) {
      state.reversals += 1;
      pointer.dir = dir;
      doWag({ cycles: 2, dur: 0.5 });
      const now = performance.now();
      if (now - lastWagAt > 160) {
        lastWagAt = now;
        emit.event('wag');
      }
    }

    if (pointer.accum >= WAG_STEP_PX) {
      pointer.accum = 0;
      doWag({ cycles: 2.2, dur: 0.52 });
      const now = performance.now();
      if (now - lastWagAt > 160) {
        lastWagAt = now;
        emit.event('wag');
      }
    }

    if (!state.goalFired && (state.dragAccum >= GOAL_DRAG_PX || state.reversals >= GOAL_REVERSALS)) {
      state.actionCount += 1;
      emit.event('wag');
      emit.hint(spec.hintMain);
      playGlow(1.15);
      flash(FAMILY.gold, 0.3);
      doWag({ cycles: 3.5, dur: 0.9 });
      finishGoal();
    }
  }

  function onPointerUp(ev) {
    if (!pointer || ev.pointerId !== pointer.id) return;
    const p = pointer;
    pointer = null;
    try { stage.canvas.releasePointerCapture(ev.pointerId); } catch { /* 忽略 */ }
    if (p.dragging || opts.previewOnly) return;
    const { onHotspot } = resolvePointer(ev.clientX, ev.clientY);
    if (!onHotspot) {
      doMiss();
      return;
    }
    switch (spec.action) {
      case 'bounce': doBounce(); break;
      case 'giggle': doGiggle(); break;
      case 'crow': doCrow(); break;
      case 'wag':
        // 点尾巴也算摇一下（不计入 goal 的累计拖动）
        state.actionCount += 1;
        emit.event('wag');
        emit.hint(spec.hintMain);
        doWag({ cycles: 1.6, dur: 0.5 });
        break;
      default: doMiss();
    }
  }

  function onPointerCancel(ev) {
    if (!pointer || ev.pointerId !== pointer.id) return;
    pointer = null;
    try { stage.canvas.releasePointerCapture(ev.pointerId); } catch { /* 忽略 */ }
  }

  stage.canvas.addEventListener('pointerdown', onPointerDown);
  stage.canvas.addEventListener('pointermove', onPointerMove);
  stage.canvas.addEventListener('pointerup', onPointerUp);
  stage.canvas.addEventListener('pointercancel', onPointerCancel);

  // ---------------- 主循环 + captureReady ----------------
  let captureResolve = null;
  const capturePromise = new Promise((res) => { captureResolve = res; });
  let framesReady = 0;
  let captureDone = false;

  const offFrame = stage.onFrame((dt) => {
    tSec += dt;
    updateTimers(dt);
    updateTweens(dt);
    updateFlash(dt);
    updateGlow(dt);
    burst.update(dt);
    if (Math.abs(camera.aspect - lastAspect) > 1e-4) refit();
    applyPose();
    if (!captureDone) {
      framesReady += 1;
      if (framesReady >= 2) {
        captureDone = true;
        captureResolve({
          childId,
          canvas: stage.canvas,
          renderer: stage.renderer,
          size: { width: stage.canvas.width, height: stage.canvas.height },
        });
      }
    }
  });

  // ---------------- 出生 / onLoad ----------------
  if (overlay) {
    overlay.setProgress(100);
    overlay.remove();
  }
  if (noBirth) {
    state.born = true;
    emit.hint(spec.hintIdle);
  } else {
    playBirth();
  }
  if (opts.onLoad) {
    try {
      opts.onLoad({
        childId,
        modelSource: state.modelSource,
        modelUrl: url,
        loadMs: state.loadMs,
        prepMs: state.prepMs,
        totalMs: state.totalMs,
        triangles: state.triangles,
        size: state.modelSize,
      });
    } catch (err) {
      console.warn('[family] onLoad 异常', err);
    }
  }
  if (state.modelSource === 'fallback') emit.hint('奶力没接上，先用奶团顶着');

  // ---------------- 公开 API ----------------
  function getModelSource() { return state.modelSource; }

  function projectLocal(localPoint) {
    if (!localPoint) return { x: 0, y: 0, visible: false };
    const world = root.localToWorld(localPoint.clone());
    const rect = stage.canvas.getBoundingClientRect();
    const v = world.clone().project(camera);
    return {
      x: +(rect.left + ((v.x + 1) / 2) * rect.width).toFixed(1),
      y: +(rect.top + ((1 - v.y) / 2) * rect.height).toFixed(1),
      visible: v.z < 1 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1,
      world: { x: +world.x.toFixed(3), y: +world.y.toFixed(3), z: +world.z.toFixed(3) },
    };
  }

  function getDebugState() {
    return {
      childId,
      modelSource: state.modelSource,
      loaded: state.loaded,
      actionCount: state.actionCount,
      goalFired: state.goalFired,
      hotspots: { [hotspot.key]: projectLocal(hotspot.anchor) },
      lastEvent: state.lastEvent,
      modelSize: state.modelSize,
      action: spec.action,
      event: spec.event,
      loadMs: state.loadMs,
      prepMs: state.prepMs,
      totalMs: state.totalMs,
      modelUrl: url,
      loadError: state.loadError,
      triangles: state.triangles,
      dragAccum: Math.round(state.dragAccum),
      reversals: state.reversals,
      born: state.born,
      busy: state.busy,
    };
  }

  function reset() {
    cancelChannel('bounce');
    cancelChannel('giggle');
    cancelChannel('crow');
    cancelChannel('wag');
    cancelChannel('birth');
    cancelChannel('goal');
    tweens.length = 0;
    timers.length = 0;
    pointer = null;

    state.goalFired = false;
    state.actionCount = 0;
    state.dragAccum = 0;
    state.reversals = 0;
    state.lastEvent = null;
    state.busy = false;
    state.born = false;
    rotationOffset = 0;

    bodySquash = 1;
    hopY = 0;
    swayZ = 0;
    pitchX = 0;
    birthScale = 1;
    pulse = 1;
    resetGlow();
    burst.reset();
    resetFlash();
    applyPose();
    refit();

    if (noBirth) {
      state.born = true;
      emit.hint(spec.hintIdle);
    } else {
      playBirth();
    }
    stage.requestRender();
  }

  function captureReady() { return capturePromise; }

  /** 调试用：身体包围盒在屏幕上的范围（CSS px，视口坐标） */
  function getModelScreenBox() {
    const rect = stage.canvas.getBoundingClientRect();
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const y of [fullBox.min.y, fullBox.max.y]) {
      for (const x of [fullBox.min.x, fullBox.max.x]) {
        for (const z of [fullBox.min.z, fullBox.max.z]) {
          p.set(x, y, z);
          root.localToWorld(p);
          p.project(camera);
          const sx = rect.left + ((p.x + 1) / 2) * rect.width;
          const sy = rect.top + ((1 - p.y) / 2) * rect.height;
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        }
      }
    }
    return {
      left: +minX.toFixed(1), top: +minY.toFixed(1),
      right: +maxX.toFixed(1), bottom: +maxY.toFixed(1),
      width: +(maxX - minX).toFixed(1), height: +(maxY - minY).toFixed(1),
    };
  }

  function dispose() {
    try {
      offFrame();
      tweens.length = 0;
      timers.length = 0;
      pointer = null;
      stage.canvas.removeEventListener('pointerdown', onPointerDown);
      stage.canvas.removeEventListener('pointermove', onPointerMove);
      stage.canvas.removeEventListener('pointerup', onPointerUp);
      stage.canvas.removeEventListener('pointercancel', onPointerCancel);
      if (overlay) overlay.dispose();
      for (const g of glowSpots) g.dispose();
      burst.dispose();
      disposeObject3D(root);
      scene.remove(root);
      scene.remove(extraLights);
    } finally {
      if (restoreContainerStyle) restoreContainerStyle();
      stage.dispose();
    }
  }

  return {
    dispose,
    reset,
    getModelSource,
    getDebugState,
    getModelScreenBox,
    captureReady,
    scene,
    camera,
    renderer: stage.renderer,
    // 调试便利（契约外）
    stage,
    root,
    hotspot,
    spec,
    colors: FAMILY,
  };
}

export default createFamilyChild;
