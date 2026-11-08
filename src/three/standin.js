// src/three/standin.js —— 本地替身：奶白矮胖蛙「再睡五分蛙」（owner: three-frog）
// 契约：buildStandinFrog() -> THREE.Group
// 局部坐标：原点在「脚底中心」，+Y 向上，+Z 为脸朝向（正面）。
// 设计要点：圆润球体堆出体积感 + 反向外壳描边（#6B4B2A）+ 两颊小闹铃 + 肚皮贪睡键（金色圆环 + 薄荷绿按钮 + 时钟指针）。
import * as THREE from 'three';

// 美术规范色（docs/CONTRACT.md 第 3 节）
const C = {
  cream: 0xfff4e0,
  creamDeep: 0xe6cca3,
  belly: 0xfffaef,
  mint: 0x8fe3b8,
  mintDeep: 0x4fb98c,
  gold: 0xf3c463,
  goldDeep: 0xce9a2f,
  ink: 0x6b4b2a,
  blush: 0xf7b8a8,
  eyeDark: 0x4a3524,
  white: 0xfffdf8,
};

/**
 * 关键锚点（局部坐标）——frog.js 的热点判定必须用这套局部坐标，
 * 保证热区跟着模型旋转（翻面后依然正确），而不是屏幕坐标硬编码。
 */
export const STANDIN_ANCHORS = Object.freeze({
  /** 肚皮贪睡键中心（契约规定：(0, 0.55, 0.42) 附近） */
  belly: Object.freeze({ x: 0, y: 0.55, z: 0.42 }),
  /** 上述坐标对应的本体自然高度，frog.js 用它把热点换算到归一化空间 */
  naturalHeight: 1.75,
  /** 额头/头顶热区：局部 y 高于 高度 × 该比例即视为额头 */
  foreheadYRatio: 0.72,
});

// ---------------- 小工具 ----------------
function matte(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.04,
    ...extra,
  });
}

function metal(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.34,
    metalness: 0.55,
    emissive: new THREE.Color(color).multiplyScalar(0.16),
    emissiveIntensity: 1,
    ...extra,
  });
}

/** 反向外壳描边：把几何放大一点点、只画背面，得到卡通褐线轮廓 */
const outlineMat = new THREE.MeshBasicMaterial({
  color: C.ink,
  side: THREE.BackSide,
  transparent: false,
});

function outline(mesh, scale = 1.05) {
  if (!mesh.geometry) return mesh;
  const shell = new THREE.Mesh(mesh.geometry, outlineMat);
  shell.scale.setScalar(scale);
  shell.name = `${mesh.name || 'mesh'}-outline`;
  shell.userData.isOutline = true;
  shell.castShadow = false;
  mesh.add(shell); // 挂在父级下 → 自动继承父级的非等比缩放
  return mesh;
}

function mesh(geo, material, { pos, rot, scale, name = 'part', hull = 0 } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  if (hull > 0) outline(m, hull);
  return m;
}

const sphere = (r, w = 32, h = 24) => new THREE.SphereGeometry(r, w, h);

/** 小闹铃：薄荷绿半球 + 金边 + 金铃锤，钟面朝外 */
function buildCheekAlarm(side) {
  const g = new THREE.Group();
  g.name = side > 0 ? 'cheek-alarm-right' : 'cheek-alarm-left';

  // 半球罩（开口朝下，随后整组旋转到朝外）
  const dome = mesh(
    new THREE.SphereGeometry(0.19, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    matte(C.mint, { roughness: 0.45 }),
    { name: 'bell-dome', hull: 1.05 },
  );
  g.add(dome);

  // 金边（半球底沿）
  const rim = mesh(
    new THREE.TorusGeometry(0.19, 0.027, 12, 36),
    metal(C.gold),
    { pos: [0, 0.004, 0], rot: [Math.PI / 2, 0, 0], name: 'bell-rim' },
  );
  g.add(rim);

  // 铃锤：金球 + 小柄
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.07, 12), metal(C.goldDeep), {
    pos: [0, 0.215, 0],
    name: 'bell-stem',
  }));
  g.add(mesh(sphere(0.052, 20, 16), metal(C.gold), {
    pos: [0, 0.262, 0],
    name: 'bell-clapper',
  }));

  // 钟面上的两个小刻度（让「闹钟」更好认）
  const tickMat = matte(C.goldDeep, { roughness: 0.5 });
  for (const a of [-0.85, 0.85]) {
    g.add(mesh(new THREE.BoxGeometry(0.016, 0.062, 0.012), tickMat, {
      pos: [Math.sin(a) * 0.115, 0.105, Math.cos(a) * 0.115],
      rot: [0, a, 0],
      name: 'bell-tick',
    }));
  }

  // 整组：半球顶点朝外并稍微向前
  g.rotation.order = 'YXZ';
  g.rotation.set(Math.PI / 2 - 0.18, side * (Math.PI / 2 - 0.5), 0);
  g.position.set(side * 0.56, 0.9, 0.16);
  return g;
}

/** 肚皮中央的贪睡按键：金色圆环 + 薄荷绿按钮 + 时钟指针 */
function buildSnoozeButton() {
  const g = new THREE.Group();
  g.name = 'snooze-button';
  const { x, y, z } = STANDIN_ANCHORS.belly;
  g.position.set(x, y, z);

  // 金色圆环（外圈）
  g.add(mesh(new THREE.TorusGeometry(0.152, 0.033, 16, 44), metal(C.gold), {
    pos: [0, 0, 0.008],
    name: 'snooze-ring',
    hull: 1.08,
  }));

  // 深金底座，垫出「凸起」的厚度
  g.add(mesh(new THREE.CylinderGeometry(0.148, 0.158, 0.05, 36), metal(C.goldDeep), {
    pos: [0, 0, 0.012],
    rot: [Math.PI / 2, 0, 0],
    name: 'snooze-base',
  }));

  // 薄荷绿按钮帽
  g.add(mesh(new THREE.CylinderGeometry(0.126, 0.132, 0.075, 36), matte(C.mint, { roughness: 0.4 }), {
    pos: [0, 0, 0.052],
    rot: [Math.PI / 2, 0, 0],
    name: 'snooze-cap',
    hull: 1.06,
  }));

  // 按钮面上的两枚时钟指针（3D 里也读得出「闹钟」）
  const handMat = matte(C.ink, { roughness: 0.5 });
  const minuteHand = new THREE.BoxGeometry(0.018, 0.098, 0.008);
  minuteHand.translate(0, 0.049, 0); // 以一端为轴心
  g.add(mesh(minuteHand, handMat, {
    pos: [0, 0, 0.093],
    rot: [0, 0, -0.62],
    name: 'snooze-hand-minute',
  }));
  const hourHand = new THREE.BoxGeometry(0.022, 0.062, 0.008);
  hourHand.translate(0, 0.031, 0);
  g.add(mesh(hourHand, handMat, {
    pos: [0, 0, 0.096],
    rot: [0, 0, 1.15],
    name: 'snooze-hand-hour',
  }));

  // 指针轴心
  g.add(mesh(sphere(0.024, 16, 12), metal(C.gold), {
    pos: [0, 0, 0.098],
    name: 'snooze-pin',
  }));

  return g;
}

/**
 * 拼一只奶白矮胖蛙。
 * @returns {THREE.Group} 原点在脚底中心、面向 +Z
 */
export function buildStandinFrog() {
  const root = new THREE.Group();
  root.name = 'standin-frog';

  const creamMat = matte(C.cream, { roughness: 0.62 });
  const bellyMat = matte(C.belly, { roughness: 0.68 });
  const deepMat = matte(C.creamDeep, { roughness: 0.6 });

  // ---------- 身体：一个压扁的球，负责整体的圆润体积 ----------
  root.add(mesh(sphere(0.62, 48, 34), creamMat, {
    pos: [0, 0.62, 0],
    scale: [1.16, 0.94, 0.66],
    name: 'torso',
    hull: 1.045,
  }));

  // ---------- 肚皮：往前顶出来的一团，暖白 ----------
  root.add(mesh(sphere(0.56, 40, 28), bellyMat, {
    pos: [0, 0.5, 0.1],
    scale: [0.94, 0.82, 0.62],
    name: 'belly',
  }));

  // ---------- 头：接着身体往上，略小于躯干 ----------
  root.add(mesh(sphere(0.47, 44, 30), creamMat, {
    pos: [0, 1.12, 0.02],
    scale: [1.05, 0.86, 0.9],
    name: 'head',
    hull: 1.045,
  }));

  // ---------- 头顶两只大眼睛 ----------
  const eyeWhite = matte(C.white, { roughness: 0.28 });
  const pupilMat = matte(C.eyeDark, { roughness: 0.25 });
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lidMat = matte(C.cream, { roughness: 0.6 });

  for (const side of [-1, 1]) {
    const eyePos = [side * 0.27, 1.49, 0.09];
    root.add(mesh(sphere(0.245, 32, 24), eyeWhite, {
      pos: eyePos,
      name: `eye-${side > 0 ? 'r' : 'l'}`,
      hull: 1.05,
    }));

    // 瞳孔稍微朝下朝前 → 困倦感
    const pupil = mesh(sphere(0.118, 24, 18), pupilMat, {
      pos: [side * 0.285, 1.455, 0.265],
      scale: [1, 1, 0.62],
      name: `pupil-${side > 0 ? 'r' : 'l'}`,
    });
    root.add(pupil);

    // 高光小点
    root.add(mesh(sphere(0.035, 12, 10), highlightMat, {
      pos: [side * 0.325, 1.5, 0.345],
      name: 'eye-highlight',
    }));

    // 半垂的眼皮（上半球壳，往前压一点）→ 「困」
    root.add(mesh(
      new THREE.SphereGeometry(0.252, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      lidMat,
      {
        pos: [side * 0.27, 1.49, 0.09],
        rot: [-0.5, 0, 0],
        name: `eyelid-${side > 0 ? 'r' : 'l'}`,
      },
    ));
  }

  // ---------- 腮红 ----------
  const blushMat = matte(C.blush, { roughness: 0.7 });
  for (const side of [-1, 1]) {
    root.add(mesh(sphere(0.095, 20, 14), blushMat, {
      pos: [side * 0.33, 1.1, 0.3],
      scale: [1, 0.66, 0.32],
      name: 'blush',
    }));
  }

  // ---------- 嘴 + 鼻孔（贴在头面前沿，略微凸出才看得见）----------
  const mouth = new THREE.TorusGeometry(0.075, 0.018, 10, 24, Math.PI * 0.92);
  root.add(mesh(mouth, matte(C.ink, { roughness: 0.5 }), {
    pos: [0, 1.0, 0.414],
    rot: [0.34, 0, Math.PI * 1.04],
    name: 'mouth',
  }));
  for (const side of [-1, 1]) {
    root.add(mesh(sphere(0.019, 14, 12), matte(C.creamDeep, { roughness: 0.6 }), {
      pos: [side * 0.062, 1.135, 0.428],
      name: 'nostril',
      hull: 1.02,
    }));
  }

  // ---------- 两颊小闹铃 ----------
  root.add(buildCheekAlarm(-1));
  root.add(buildCheekAlarm(1));

  // ---------- 小短手 ----------
  for (const side of [-1, 1]) {
    root.add(mesh(new THREE.CapsuleGeometry(0.105, 0.12, 8, 20), creamMat, {
      pos: [side * 0.63, 0.44, 0.12],
      rot: [0.24, 0, side * 0.5],
      name: `arm-${side > 0 ? 'r' : 'l'}`,
      hull: 1.06,
    }));
  }

  // ---------- 小短腿（脚底正好落在 y=0）----------
  for (const side of [-1, 1]) {
    root.add(mesh(sphere(0.2, 26, 18), deepMat, {
      pos: [side * 0.31, 0.122, 0.11],
      scale: [0.95, 0.61, 1.24],
      name: `foot-${side > 0 ? 'r' : 'l'}`,
      hull: 1.07,
    }));
  }

  // ---------- 后背的上弦小钥匙（闹钟血统）----------
  const key = new THREE.Group();
  key.name = 'back-wind-key';
  key.position.set(0, 1.0, -0.4);
  key.rotation.set(-0.5, 0, 0);
  key.add(mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.13, 14), metal(C.goldDeep), {
    pos: [0, 0, 0],
    rot: [Math.PI / 2, 0, 0],
    name: 'key-stem',
  }));
  key.add(mesh(new THREE.TorusGeometry(0.075, 0.024, 12, 26), metal(C.gold), {
    pos: [0, 0, -0.13],
    name: 'key-ring',
  }));
  root.add(key);

  // ---------- 肚皮贪睡键 ----------
  root.add(buildSnoozeButton());

  // —— 元信息：让 frog.js 知道这是替身、以及热点锚点 ——
  root.userData.isStandin = true;
  root.userData.anchors = {
    belly: { ...STANDIN_ANCHORS.belly },
    naturalHeight: STANDIN_ANCHORS.naturalHeight,
    foreheadYRatio: STANDIN_ANCHORS.foreheadYRatio,
  };
  return root;
}

export default buildStandinFrog;
