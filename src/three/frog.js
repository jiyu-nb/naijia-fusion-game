// src/three/frog.js —— 「再睡五分蛙」3D 交互场景（owner: three-frog）
// 契约：createFrogScene(container, opts) ->
//   { dispose(), reset(), getModelSource(), tapForehead(), flip() }
// 玩法：
//   1) 点额头/头顶 -> 整只蛙横向蹦开（位移 + 压缩拉伸 + 落地回弹），onEvent('hop')
//   2) 在身体上拖动 > 18px -> 翻到肚皮朝上，onEvent('flip')；再拖一次翻回来
//   3) 肚皮朝上时点肚皮贪睡键 -> 关铃，onEvent('snooze') + onGoal({traitHits})
//   4) 肚皮朝下时点按键 -> onEvent('poke-back')，不关铃
//   5) 关铃后：安静趴下（压扁 y、微倾）、呼吸变慢；闹铃音由外部停
//   6) 点空 -> 轻微提示（hint + 涟漪 + 缩放脉冲，静音时也看得见）
//   7) 热点全部用「模型局部坐标」判定，跟随模型旋转（翻面后依然正确）
import * as THREE from 'three';
import { createStage } from './stage.js';
import { buildStandinFrog, STANDIN_ANCHORS } from './standin.js';

// ------------------------- 调参 -------------------------
const TARGET_HEIGHT = 2.2; // 契约：缩放至约 2.2 单位高
const DRAG_THRESHOLD_PX = 18; // 契约：拖动超过 ~18px 触发翻面
const FLIP_DUR = 0.62; // 翻面时长（秒）
const HOTSPOT_RADIUS = 0.36; // 肚皮按键命中半径（归一化空间，约等于按钮直径的 1.4 倍）
const FOREHEAD_RATIO = STANDIN_ANCHORS.foreheadYRatio; // 局部 y ≥ 高度×0.72 视为额头
const CAM_FRONT_ELEV = THREE.MathUtils.degToRad(15);
const CAM_BACK_ELEV = THREE.MathUtils.degToRad(52);

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

// ------------------------- 主入口 -------------------------
/**
 * @param {HTMLElement} container
 * @param {{modelUrl?: string|null, onGoal?: Function, onEvent?: Function, hint?: Function,
 *          modelYaw?: number|null}} opts
 */
export async function createFrogScene(container, opts = {}) {
  const options = {
    modelUrl: null,
    onGoal: () => {},
    onEvent: () => {},
    hint: () => {},
    modelYaw: null,
    ...opts,
  };

  const stage = createStage(container);
  const { scene, camera } = stage;

  // 安全回调：UI 层抛错不能炸掉 3D
  const emitHint = (text) => {
    try { options.hint(String(text)); } catch (err) { console.warn('[frog] hint 回调异常', err); }
  };
  const emitEvent = (name) => {
    try { options.onEvent(name); } catch (err) { console.warn('[frog] onEvent 回调异常', err); }
  };
  const emitGoal = (payload) => {
    try { options.onGoal(payload); } catch (err) { console.warn('[frog] onGoal 回调异常', err); }
  };

  // ---------------- 模型加载（GLB 失败必须回退，不能白屏） ----------------
  let modelSource = 'local-standin';
  let loadError = null;
  let sourceObject = null;

  async function loadSource() {
    if (!options.modelUrl) return { object: buildStandinFrog(), source: 'local-standin', error: null };
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(options.modelUrl, resolve, undefined, reject);
      });
      const obj = gltf?.scene || (gltf?.scenes && gltf.scenes[0]) || null;
      if (!obj) throw new Error('GLB 里没有可用 scene');
      return { object: obj, source: 'hi3d-glb', error: null };
    } catch (err) {
      const msg = (err && (err.message || err.type)) || String(err);
      console.warn('[frog] GLB 加载失败，回退本地替身：', msg);
      return { object: buildStandinFrog(), source: 'local-standin', error: msg };
    }
  }

  const loaded = await loadSource();
  sourceObject = loaded.object;
  modelSource = loaded.source;
  loadError = loaded.error;

  // ---------------- 归一化：居中 / 脚底贴地 / 缩放到 2.2 高 ----------------
  const pivot = new THREE.Group(); // 翻转 / 蹦跳 / 呼吸的作用点（原点 = 脚底中心）
  pivot.name = 'frog-pivot';
  pivot.rotation.order = 'YXZ';
  scene.add(pivot);

  const rawBox = new THREE.Box3().setFromObject(sourceObject);
  if (rawBox.isEmpty()) rawBox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5));
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawCenter = rawBox.getCenter(new THREE.Vector3());
  const fitScale = TARGET_HEIGHT / Math.max(rawSize.y, 1e-4);

  // 朝向校正：glTF 默认正面 +Z；若 bbox 明显「进深 > 宽度」，多半是侧着做的，转 90° 面向相机
  let yaw = 0;
  if (typeof options.modelYaw === 'number') {
    yaw = options.modelYaw;
  } else if (rawSize.z > rawSize.x * 1.12) {
    yaw = Math.PI / 2;
  }

  const normalized = new THREE.Group(); // 负责缩放与居中平移
  normalized.name = 'frog-model-normalized';
  normalized.add(sourceObject);
  normalized.scale.setScalar(fitScale);
  normalized.position.set(-rawCenter.x * fitScale, -rawBox.min.y * fitScale, -rawCenter.z * fitScale);

  const yawGroup = new THREE.Group(); // 只负责转向（单独一层，热点换算简单）
  yawGroup.name = 'frog-yaw';
  yawGroup.rotation.y = yaw;
  yawGroup.add(normalized);
  pivot.add(yawGroup);

  // 归一化后的实际尺寸（pivot 局部空间）
  const modelHeight = rawSize.y * fitScale; // ≈ TARGET_HEIGHT
  const modelDepth = rawSize.z * fitScale;
  const modelWidth = rawSize.x * fitScale;
  const foreheadY = modelHeight * FOREHEAD_RATIO;

  // ---------------- 肚皮贪睡键热点（局部坐标，跟随模型旋转） ----------------
  // 替身：契约给定 (0, 0.55, 0.42)；GLB：按 bbox 比例换算（同样的相对位置）
  const isStandin = modelSource === 'local-standin';
  const bellyHotspotSource = isStandin
    ? new THREE.Vector3(STANDIN_ANCHORS.belly.x, STANDIN_ANCHORS.belly.y, STANDIN_ANCHORS.belly.z)
    : new THREE.Vector3(
      rawCenter.x,
      rawBox.min.y + rawSize.y * (STANDIN_ANCHORS.belly.y / STANDIN_ANCHORS.naturalHeight),
      rawCenter.z + rawSize.z * 0.42,
    );

  // 源坐标 -> 归一化坐标（缩放 + 平移）-> 转向 -> pivot 局部坐标
  const bellyHotspotLocal = bellyHotspotSource
    .clone()
    .multiplyScalar(fitScale)
    .add(normalized.position)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  // 翻面时让「躺下」的蛙留在画面中央、背贴地
  const flipLiftY = Math.max(modelDepth * 0.5, 0.2);
  const flipShiftZ = Math.max(modelHeight * 0.5, 0.4);

  // ---------------- 材质表（emissive 闪烁，静音也有反馈） ----------------
  const flashEntries = [];
  const seenMaterials = new Set();
  pivot.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || !m.emissive || seenMaterials.has(m)) continue;
      seenMaterials.add(m);
      flashEntries.push({
        material: m,
        baseEmissive: m.emissive.clone(),
        baseIntensity: typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 1,
      });
    }
  });

  // ---------------- 状态 ----------------
  const state = {
    pose: 'front', // 'front' | 'back'
    bellyUp: false,
    snoozed: false,
    busy: false, // 翻面/关铃动画进行中
    goalFired: false,
    traitHits: new Set(),
    hops: 0,
  };

  // 动画运行时数值
  let flipAngle = 0;
  let tiltX = 0;
  let tiltZ = 0;
  let hopX = 0;
  let hopY = 0;
  let flipLift = 0;
  let flipZ = 0;
  let squash = 1; // 压缩/拉伸（1 = 常态）
  let pulse = 1; // 点击缩放脉冲
  let hopSide = 1;
  let tSec = 0;

  // ---------------- 极简补间 + 定时器 ----------------
  const tweens = [];
  const timers = [];

  function tween({ channel = 'default', dur = 0.3, ease = easeOutQuad, onUpdate, onDone }) {
    const item = { channel, dur: Math.max(dur, 1e-4), t: 0, ease, onUpdate, onDone };
    tweens.push(item);
    if (onUpdate) onUpdate(ease(0), 0);
    return item;
  }

  function after(delay, fn, channel = 'default') {
    const item = { channel, t: delay, fn };
    timers.push(item);
    return item;
  }

  function cancelChannel(channel) {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].channel === channel) tweens.splice(i, 1);
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].channel === channel) timers.splice(i, 1);
  }

  function updateTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
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
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) {
        const { fn } = timers[i];
        timers.splice(i, 1);
        if (fn) fn();
      }
    }
  }

  // ---------------- 相机取景 ----------------
  const camState = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    target: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  };
  let lastAspect = -1;

  function targetFor(pose) {
    const aspect = Math.max(camera.aspect, 0.2);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const needH = modelHeight * 1.16; // 上下留白
    const needW = Math.max(modelWidth, modelDepth) * 1.22;
    const distV = (needH / 2) / Math.tan(vFov / 2);
    const distH = (needW / 2) / Math.tan(hFov / 2);
    const baseDist = Math.max(distV, distH);

    if (pose === 'back') {
      const d = baseDist * 0.92;
      const look = new THREE.Vector3(0, Math.max(flipLiftY * 0.55, 0.42), 0);
      const pos = look.clone().add(new THREE.Vector3(
        0,
        Math.sin(CAM_BACK_ELEV) * d,
        Math.cos(CAM_BACK_ELEV) * d,
      ));
      return { pos, look };
    }
    const look = new THREE.Vector3(0, modelHeight * 0.47, 0);
    const pos = look.clone().add(new THREE.Vector3(
      0,
      Math.sin(CAM_FRONT_ELEV) * baseDist,
      Math.cos(CAM_FRONT_ELEV) * baseDist,
    ));
    return { pos, look };
  }

  function setCamera(pose, { immediate = false } = {}) {
    const t = targetFor(pose);
    camState.target.pos.copy(t.pos);
    camState.target.look.copy(t.look);
    if (immediate) {
      camState.pos.copy(t.pos);
      camState.look.copy(t.look);
      applyCamera();
      return;
    }
    cancelChannel('cam');
    const fromPos = camState.pos.clone();
    const fromLook = camState.look.clone();
    tween({
      channel: 'cam',
      dur: 0.7,
      ease: easeInOutCubic,
      onUpdate: (e) => {
        camState.pos.lerpVectors(fromPos, camState.target.pos, e);
        camState.look.lerpVectors(fromLook, camState.target.look, e);
      },
    });
  }

  function applyCamera() {
    camera.position.copy(camState.pos);
    camera.lookAt(camState.look);
  }

  setCamera('front', { immediate: true });

  // ---------------- 涟漪（点空/点中都有反馈）----------------
  const rippleGeo = new THREE.RingGeometry(0.085, 0.115, 40);
  const ripples = [];
  function spawnRipple(point, color = 0x8fe3b8) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(rippleGeo, mat);
    m.position.copy(point);
    m.renderOrder = 12;
    m.userData.life = 0.52;
    m.userData.age = 0;
    scene.add(m);
    ripples.push(m);
    if (ripples.length > 6) {
      const old = ripples.shift();
      scene.remove(old);
      old.material.dispose();
    }
    return m;
  }

  function updateRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const m = ripples[i];
      m.userData.age += dt;
      const p = clamp01(m.userData.age / m.userData.life);
      m.scale.setScalar(0.75 + p * 2.6);
      m.material.opacity = 0.85 * (1 - p);
      m.quaternion.copy(camera.quaternion); // 永远正面朝相机
      if (p >= 1) {
        scene.remove(m);
        m.material.dispose();
        ripples.splice(i, 1);
      }
    }
  }

  // ---------------- 高亮闪烁 ----------------
  const flashColor = new THREE.Color(0x8fe3b8);
  let flashT = 0;
  let flashStrength = 0;
  const tmpColor = new THREE.Color();

  function flash(color = 0x8fe3b8, strength = 0.55) {
    flashColor.set(color);
    flashStrength = strength;
    flashT = 1;
  }

  function updateFlash(dt) {
    if (flashT <= 0) return;
    flashT = Math.max(0, flashT - dt / 0.42);
    const k = flashT * flashStrength;
    for (const e of flashEntries) {
      e.material.emissive.copy(e.baseEmissive);
      if (k > 0.001) {
        tmpColor.copy(e.baseEmissive).lerp(flashColor, Math.min(k * 1.6, 1));
        e.material.emissive.copy(tmpColor);
        e.material.emissiveIntensity = 1 + k * 1.9;
      } else {
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

  // ---------------- 姿态应用（每帧）----------------
  function applyPose() {
    const breatheSpeed = state.snoozed ? 1.05 : 2.15; // 睡着后呼吸变慢
    const breatheAmp = state.snoozed ? 0.026 : 0.013;
    const breathe = Math.sin(tSec * breatheSpeed) * breatheAmp;

    const baseY = state.snoozed ? 0.84 : 1; // 趴下：整体压矮
    const pulseScale = 1 + (pulse - 1) * 0.55;

    let sy = baseY * squash * (1 + breathe) * pulseScale;
    sy = Math.max(sy, 0.05);
    const sxz = (1 / Math.sqrt(sy)) * (1 + (pulseScale - 1) * 0.25);

    pivot.rotation.x = flipAngle + tiltX;
    pivot.rotation.y = 0;
    pivot.rotation.z = tiltZ;
    pivot.position.set(hopX, hopY + flipLift, flipZ);
    pivot.scale.set(sxz, sy, sxz);

    // 脉冲衰减
    if (pulse > 1) pulse = Math.max(1, pulse - 0.045);
  }

  // ---------------- 跳跃（点额头）----------------
  function playHop() {
    if (state.snoozed) {
      emitHint('它睡着啦，别吵');
      pulse = 1.06;
      flash(0xbfe9ff, 0.2);
      return;
    }
    if (state.bellyUp) {
      emitHint('先按肚皮上的贪睡键');
      pulse = 1.06;
      flash(0xbfe9ff, 0.22);
      return;
    }

    cancelChannel('hop');
    state.hops += 1;
    state.traitHits.add('escape');
    emitEvent('hop');
    emitHint(state.hops === 1 ? '哎呀，它蹦开了！' : '又蹦！腿真快');
    flash(0x8fe3b8, 0.5);
    pulse = 1.1;

    const dir = hopSide;
    hopSide = -hopSide; // 左右交替，别总往一边逃
    const sideX = dir * (modelWidth * 0.42 + 0.28);
    const airH = modelHeight * 0.28;
    const fromX = hopX; // 连点时从当前位置继续蹦，不要瞬移

    tween({
      channel: 'hop',
      dur: 0.66,
      ease: (t) => t,
      onUpdate: (e) => {
        if (e < 0.14) {
          // 蓄力压缩
          const p = e / 0.14;
          squash = 1 - 0.26 * easeOutQuad(p);
          hopX = fromX;
          hopY = 0;
        } else if (e < 0.56) {
          // 起跳 + 空中拉伸
          const p = (e - 0.14) / 0.42;
          hopX = fromX + (sideX - fromX) * easeOutCubic(p);
          hopY = Math.sin(p * Math.PI) * airH;
          squash = 1 + 0.18 * Math.sin(p * Math.PI);
        } else if (e < 0.72) {
          // 落地压缩
          const p = (e - 0.56) / 0.16;
          hopX = sideX;
          hopY = 0;
          squash = 1 - 0.28 * Math.sin(p * Math.PI);
        } else if (e < 0.9) {
          // 回弹
          const p = (e - 0.72) / 0.18;
          hopX = sideX;
          hopY = Math.sin(p * Math.PI) * airH * 0.2;
          squash = 1 + 0.09 * Math.sin(p * Math.PI);
        } else {
          const p = (e - 0.9) / 0.1;
          hopX = sideX;
          hopY = 0;
          squash = 1;
          void p;
        }
      },
      onDone: () => {
        squash = 1;
        hopY = 0;
        // 蹦完回中间，方便继续玩（不改变玩家已看到的「蹦开」）
        after(1.15, () => {
          tween({
            channel: 'hop',
            dur: 0.46,
            ease: easeInOutCubic,
            onUpdate: (e) => {
              hopX = sideX * (1 - e);
              hopY = Math.sin(e * Math.PI) * airH * 0.45;
            },
            onDone: () => { hopX = 0; hopY = 0; },
          });
        }, 'hop');
      },
    });
  }

  // ---------------- 翻面（拖动）----------------
  function toggleFlip() {
    if (state.snoozed) {
      emitHint('它已经睡死了，翻不动');
      pulse = 1.06;
      return;
    }
    if (state.busy) return;

    cancelChannel('flip');
    cancelChannel('hop');
    hopX = 0;
    hopY = 0;
    squash = 1;

    const toBack = !state.bellyUp;
    // 绕 X 轴翻到躺平：肚皮朝上（+Y），相机随之抬高到头顶上方看肚皮
    const fromAngle = flipAngle;
    const toAngle = toBack ? -(Math.PI / 2) - 0.05 : 0;
    const fromLift = flipLift;
    const toLift = toBack ? flipLiftY : 0;
    const fromZ = flipZ;
    const toZ = toBack ? flipShiftZ : 0;
    const fromTiltZ = tiltZ;
    const toTiltZ = toBack ? 0.05 : 0;

    state.busy = true;
    tween({
      channel: 'flip',
      dur: FLIP_DUR,
      ease: easeInOutCubic,
      onUpdate: (e) => {
        flipAngle = fromAngle + (toAngle - fromAngle) * e;
        flipLift = fromLift + (toLift - fromLift) * e;
        flipZ = fromZ + (toZ - fromZ) * e;
        tiltZ = fromTiltZ + (toTiltZ - fromTiltZ) * e;
        squash = 1 + 0.06 * Math.sin(e * Math.PI);
      },
      onDone: () => {
        state.busy = false;
        state.bellyUp = toBack;
        state.pose = toBack ? 'back' : 'front';
        squash = 1;
        flash(0xf3c463, 0.4);
        pulse = 1.08;
        setCamera(state.pose);
      },
    });

    emitEvent('flip');
    flash(0xf3c463, 0.55);
    setCamera(toBack ? 'back' : 'front');
    if (toBack) {
      emitHint('翻过来啦！按肚皮上的贪睡键');
    } else {
      emitHint('翻回去了，肚皮藏起来了');
    }
  }

  // ---------------- 关铃（肚皮朝上点按键）----------------
  function snooze(hitPoint) {
    if (state.goalFired) {
      emitHint('已经关啦，它睡死了');
      pulse = 1.05;
      return;
    }
    state.goalFired = true;
    state.traitHits.add('belly');
    state.snoozed = true;
    state.bellyUp = false;
    state.pose = 'front';

    emitEvent('snooze');
    emitHint('闹铃关掉了…它趴下接着睡');
    flash(0x8fe3b8, 0.9);
    pulse = 1.12;
    if (hitPoint) spawnRipple(hitPoint, 0xf3c463);

    cancelChannel('flip');
    cancelChannel('hop');
    state.busy = true;

    const fromAngle = flipAngle;
    const fromLift = flipLift;
    const fromZ = flipZ;
    const fromTiltZ = tiltZ;

    tween({
      channel: 'sleep',
      dur: 0.9,
      ease: easeInOutCubic,
      onUpdate: (e) => {
        flipAngle = fromAngle * (1 - e);
        flipLift = fromLift * (1 - e);
        flipZ = fromZ * (1 - e);
        tiltZ = fromTiltZ + (0.055 - fromTiltZ) * e;
        tiltX = -0.04 * e;
      },
      onDone: () => {
        state.busy = false;
        flipAngle = 0;
        flipLift = 0;
        flipZ = 0;
        tiltZ = 0.055;
      },
    });
    setCamera('front');

    emitGoal({ traitHits: Array.from(state.traitHits) });
  }

  // ---------------- 拾取 ----------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpVec = new THREE.Vector3();

  function pick(clientX, clientY) {
    const rect = stage.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    scene.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(pivot, true);
    if (!hits.length) return null;
    const solid = hits.find((h) => !h.object.userData.isOutline) || hits[0];
    return { point: solid.point.clone(), object: solid.object, distance: solid.distance };
  }

  function localPointOf(worldPoint) {
    tmpVec.copy(worldPoint);
    return pivot.worldToLocal(tmpVec.clone());
  }

  // ---------------- 点击判定（热点：局部坐标 + 朝向） ----------------
  function handleTap(hit) {
    if (!hit) {
      emitHint('这边是空气，蛙在中间呢');
      pulse = 1.05;
      flash(0xbfe9ff, 0.18);
      return;
    }
    const local = localPointOf(hit.point);
    const distToButton = local.distanceTo(bellyHotspotLocal);
    const onButton = distToButton <= HOTSPOT_RADIUS;
    const onForehead = local.y >= foreheadY;
    spawnRipple(hit.point, onButton ? 0xf3c463 : 0x8fe3b8);

    if (state.snoozed) {
      emitHint(onButton || onForehead ? '铃已经关了，它睡得正香' : '嘘…它在补觉');
      pulse = 1.06;
      flash(0xbfe9ff, 0.2);
      return;
    }

    if (onButton) {
      if (state.bellyUp) {
        snooze(hit.point);
      } else {
        // 肚皮朝下：按的是「背面」的同一处 → 不关铃
        emitEvent('poke-back');
        emitHint('肚皮贴着地呢，先把它翻过来');
        flash(0xbfe9ff, 0.3);
        pulse = 1.07;
      }
      return;
    }

    if (onForehead) {
      playHop();
      return;
    }

    // 点在身上但不是热点
    emitHint('碰额头会蹦·拖动身体能翻面·肚皮上的键要翻过来才按得到');
    pulse = 1.04;
    flash(0xbfe9ff, 0.16);
  }

  // ---------------- Pointer Events（鼠标 / 触摸统一） ----------------
  let pointerState = null;

  function onPointerDown(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (pointerState) return; // 只跟第一根手指
    const hit = pick(ev.clientX, ev.clientY);
    pointerState = {
      id: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      hit,
      dragging: false,
    };
    try { stage.canvas.setPointerCapture(ev.pointerId); } catch { /* 老浏览器忽略 */ }
    if (hit) {
      stage.canvas.style.cursor = 'grab';
      flash(0xf3c463, 0.14); // 按下去就有反馈
    }
  }

  function onPointerMove(ev) {
    if (!pointerState || ev.pointerId !== pointerState.id) return;
    const dx = ev.clientX - pointerState.startX;
    const dy = ev.clientY - pointerState.startY;
    const dist = Math.hypot(dx, dy);
    if (!pointerState.dragging && dist > DRAG_THRESHOLD_PX) {
      pointerState.dragging = true;
      if (pointerState.hit) {
        toggleFlip();
      } else {
        emitHint('要拖蛙的身体才能把它翻过来');
      }
    }
  }

  function endPointer(ev, cancelled = false) {
    if (!pointerState || ev.pointerId !== pointerState.id) return;
    const st = pointerState;
    pointerState = null;
    stage.canvas.style.cursor = 'grab';
    try { stage.canvas.releasePointerCapture(ev.pointerId); } catch { /* 忽略 */ }
    if (cancelled) return;
    if (st.dragging) return;
    // 没拖动 = 一次点击；按下没命中就再取一次抬起的点
    const hit = st.hit || pick(ev.clientX, ev.clientY);
    handleTap(hit);
  }

  const onPointerUp = (ev) => endPointer(ev, false);
  const onPointerCancel = (ev) => endPointer(ev, true);
  const onPointerLeave = () => {
    if (!pointerState) stage.canvas.style.cursor = 'grab';
  };

  stage.canvas.addEventListener('pointerdown', onPointerDown);
  stage.canvas.addEventListener('pointermove', onPointerMove);
  stage.canvas.addEventListener('pointerup', onPointerUp);
  stage.canvas.addEventListener('pointercancel', onPointerCancel);
  stage.canvas.addEventListener('pointerleave', onPointerLeave);

  // ---------------- 主循环 ----------------
  const offFrame = stage.onFrame((dt) => {
    tSec += dt;
    updateTimers(dt);
    updateTweens(dt);
    updateFlash(dt);
    updateRipples(dt);
    if (Math.abs(camera.aspect - lastAspect) > 1e-4) {
      lastAspect = camera.aspect;
      const t = targetFor(state.pose);
      camState.target.pos.copy(t.pos);
      camState.target.look.copy(t.look);
      if (!tweens.some((tw) => tw.channel === 'cam')) {
        camState.pos.copy(t.pos);
        camState.look.copy(t.look);
      }
    }
    applyPose();
    applyCamera();
  });

  // ---------------- 对外 API ----------------
  function dispose() {
    try {
      offFrame();
      tweens.length = 0;
      timers.length = 0;
      pointerState = null;
      stage.canvas.removeEventListener('pointerdown', onPointerDown);
      stage.canvas.removeEventListener('pointermove', onPointerMove);
      stage.canvas.removeEventListener('pointerup', onPointerUp);
      stage.canvas.removeEventListener('pointercancel', onPointerCancel);
      stage.canvas.removeEventListener('pointerleave', onPointerLeave);

      // 释放模型资源
      const seenGeo = new Set();
      pivot.traverse((obj) => {
        if (!obj.isMesh && !obj.isPoints) return;
        if (obj.geometry && !seenGeo.has(obj.geometry)) {
          seenGeo.add(obj.geometry);
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) if (m && m.dispose) m.dispose();
      });
      for (const m of ripples) {
        scene.remove(m);
        if (m.material) m.material.dispose();
      }
      ripples.length = 0;
      rippleGeo.dispose();
      scene.remove(pivot);
      if (sourceObject) scene.remove(sourceObject); // 已经不是子节点时是安全空操作
    } finally {
      // 无论如何都要把 renderer / canvas / 循环收掉，避免 WebGL 上下文泄漏
      stage.dispose();
    }
  }

  function reset() {
    cancelChannel('hop');
    cancelChannel('flip');
    cancelChannel('cam');
    cancelChannel('sleep');
    tweens.length = 0;
    timers.length = 0;
    pointerState = null;

    state.pose = 'front';
    state.bellyUp = false;
    state.snoozed = false;
    state.busy = false;
    state.goalFired = false;
    state.traitHits.clear();
    state.hops = 0;

    flipAngle = 0;
    tiltX = 0;
    tiltZ = 0;
    hopX = 0;
    hopY = 0;
    flipLift = 0;
    flipZ = 0;
    squash = 1;
    pulse = 1;
    hopSide = 1;

    resetFlash();
    for (const m of ripples) {
      scene.remove(m);
      if (m.material) m.material.dispose();
    }
    ripples.length = 0;
    applyPose();
    setCamera('front', { immediate: true });
    stage.requestRender();
    emitHint('再来一次：碰额头它会逃，拖动翻面才能关铃');
  }

  // 程序化触发（UI / 自动化测试用）
  function tapForehead() {
    const head = new THREE.Vector3(0, foreheadY + (modelHeight - foreheadY) * 0.5, 0);
    // 额头点在模型正面上方：直接用世界坐标反推一次「命中」
    const world = pivot.localToWorld(head.clone());
    handleTap({ point: world, object: pivot, distance: camera.position.distanceTo(world) });
  }

  function flip() {
    toggleFlip();
  }

  function getModelSource() {
    return modelSource;
  }

  function getDebugState() {
    return {
      modelSource,
      loadError,
      bellyUp: state.bellyUp,
      snoozed: state.snoozed,
      busy: state.busy,
      goalFired: state.goalFired,
      pose: state.pose,
      hops: state.hops,
      traitHits: Array.from(state.traitHits),
      flipAngle,
      bellyHotspotLocal: {
        x: Number(bellyHotspotLocal.x.toFixed(3)),
        y: Number(bellyHotspotLocal.y.toFixed(3)),
        z: Number(bellyHotspotLocal.z.toFixed(3)),
      },
      hotspotRadius: HOTSPOT_RADIUS,
      foreheadY: Number(foreheadY.toFixed(3)),
      yaw,
      fitScale: Number(fitScale.toFixed(3)),
      modelSize: {
        x: Number((rawSize.x * fitScale).toFixed(3)),
        y: Number((rawSize.y * fitScale).toFixed(3)),
        z: Number((rawSize.z * fitScale).toFixed(3)),
      },
      tweenCount: tweens.length,
      timerCount: timers.length,
    };
  }

  emitHint('碰额头它会逃 · 拖动把它翻过来 · 点肚皮才能关铃');

  return {
    dispose,
    reset,
    getModelSource,
    tapForehead,
    flip,
    // 调试/自测便利接口（契约外增量，不影响调用方）
    getDebugState,
    scene,
    camera,
    renderer: stage.renderer,
    stage,
    pivot,
    colors: { mint: 0x8fe3b8, gold: 0xf3c463 },
  };
}

export default createFrogScene;
