// src/three/familyCore.js —— 「奶家人」公共底座（owner: three-frog）
// 配色 / 材质 / 释放 / 失败回退奶团 / 出生粒子 / 局部高光 / GLB 加载 / 归一化 / 取景 / 加载覆盖层。
// familyShowcase.js 与 familyChild.js 共用，不含任何具体玩法。
import * as THREE from 'three';

export const TARGET_HEIGHT = 2.2; // 统一归一化高度（底边贴地 y=0、xz 居中）
export const LOADING_TEXT = '正在把奶力揉成形状…';

export const FAMILY = {
  cream: '#F6D792',
  milk: '#FFF6E3',
  gold: '#F2BE55',
  goldDeep: '#CE9A2F',
  comb: '#E25A3F',
  ink: '#6B4B36',
  eye: '#3A2B22',
};

/** 奶家人统一哑光材质（roughness≈0.35、metalness 0） */
export function familyMat(hex, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: 0.35,
    metalness: 0,
    ...extra,
  });
}

/** 彻底释放一棵子树的几何体与材质（dispose 用） */
export function disposeObject3D(root) {
  const seenGeo = new Set();
  const seenMat = new Set();
  root.traverse((obj) => {
    if (obj.geometry && !seenGeo.has(obj.geometry)) {
      seenGeo.add(obj.geometry);
      obj.geometry.dispose();
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || seenMat.has(m)) continue;
      seenMat.add(m);
      if (m.map) m.map.dispose?.();
      m.dispose?.();
    }
  });
}

// ---------------- GLB 加载 ----------------
let loaderModulesPromise = null;

/** meshopt 压缩的 GLB 必须挂 MeshoptDecoder；模块只 import 一次并缓存 loader */
export function preloadLoaderModules() {
  if (!loaderModulesPromise) {
    loaderModulesPromise = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]).then(([gltfMod, meshoptMod]) => {
      const loader = new gltfMod.GLTFLoader();
      loader.setMeshoptDecoder(meshoptMod.MeshoptDecoder);
      return loader;
    });
  }
  return loaderModulesPromise;
}

export async function loadGLB(url, onProgress) {
  const loader = await preloadLoaderModules();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      (evt) => {
        if (!onProgress) return;
        if (evt && evt.lengthComputable && evt.total) onProgress((evt.loaded / evt.total) * 100);
        else onProgress(null);
      },
      (err) => reject(err),
    );
  });
}

export function countTriangles(obj) {
  let tris = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const idx = o.geometry.index;
      const pos = o.geometry.getAttribute('position');
      tris += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
    }
  });
  return Math.round(tris);
}

/** 归一化：xz 居中、底边贴地 y=0、高度 = targetHeight */
export function normalizeModel(obj, targetHeight = TARGET_HEIGHT) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = targetHeight / Math.max(size.y, 1e-4);
  const wrap = new THREE.Group();
  wrap.name = 'body-normalized';
  wrap.add(obj);
  wrap.scale.setScalar(k);
  wrap.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  return { wrap, scale: k, size: size.clone().multiplyScalar(k) };
}

/** 相机取景：迭代投影拟合，让整体 bbox 占满 fill（NDC 半空间比例），旋转过的模型也准 */
export function fitCameraToBox(camera, box, { elevDeg = 12, fill = 0.86, lookY = 0.97 } = {}) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const look = new THREE.Vector3(center.x, center.y * lookY, center.z);
  const elev = THREE.MathUtils.degToRad(elevDeg);
  const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev)).normalize();

  const corners = [];
  // 只用「贴近平面的 z」采样投影：包围盒里靠近相机的角会因为透视被放大，
  // 直接拿 8 个角拟合会把深机型（奶狗/奶鸡）越推越远。
  const zc = (box.min.z + box.max.z) * 0.5;
  const zh = Math.max((box.max.z - box.min.z) * 0.5 * 0.35, 1e-3);
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [zc - zh, zc + zh]) corners.push(new THREE.Vector3(x, y, z));
    }
  }

  let dist = Math.max(size.y, size.x, size.z) * 1.7;
  const v = new THREE.Vector3();
  for (let iter = 0; iter < 5; iter += 1) {
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let maxAbs = 0.001;
    for (const c of corners) {
      v.copy(c).project(camera);
      maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
    }
    const scale = maxAbs / fill;
    dist *= scale;
    if (Math.abs(scale - 1) < 0.01) break;
  }
  camera.position.copy(look).addScaledVector(dir, dist);
  camera.lookAt(look);
  return { dist, look };
}

/** 转台用的「旋转不变」包围盒：水平方向按最大半径铺开 */
export function spinBoxOf(box) {
  const r = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  return new THREE.Box3(new THREE.Vector3(-r, box.min.y, -r), new THREE.Vector3(r, box.max.y, r));
}

/** 奶家人专属补光：正面柔和补一档，避免 GLB 下缘发闷 */
export function addFamilyLights(scene) {
  const group = new THREE.Group();
  group.name = 'family-extra-lights';
  const front = new THREE.DirectionalLight(0xfff5e6, 0.42);
  front.position.set(0.5, 0.8, 3.4);
  group.add(front);
  const low = new THREE.DirectionalLight(0xffe9c9, 0.26);
  low.position.set(0, -1.4, 2.4);
  group.add(low);
  scene.add(group);
  return group;
}

// ---------------- DOM 小工具 ----------------
export function hasNoBirthQuery() {
  try {
    return new URLSearchParams(location.search).get('noBirth') === '1';
  } catch {
    return false;
  }
}

/** 覆盖层用绝对定位，容器必须是定位元素；返回还原函数 */
export function ensurePositioned(container) {
  const prev = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  return () => { container.style.position = prev; };
}

/** 加载覆盖层：「正在把奶力揉成形状… xx%」 */
export function buildLoadingOverlay(container) {
  const box = document.createElement('div');
  box.className = 'family-loading-overlay';
  box.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:6', 'display:flex',
    'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:10px', 'pointer-events:none', 'transition:opacity .28s ease',
    'font:700 13px/1.4 "PingFang SC","Microsoft YaHei",system-ui,sans-serif',
    'color:#8a6a45', 'text-align:center',
  ].join(';');

  const text = document.createElement('div');
  text.textContent = `${LOADING_TEXT} 0%`;
  text.style.cssText = 'padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.82);border:1.5px solid rgba(107,75,42,.25)';
  box.appendChild(text);

  const barWrap = document.createElement('div');
  barWrap.style.cssText = 'width:132px;height:7px;border-radius:999px;background:rgba(246,215,146,.55);overflow:hidden';
  const bar = document.createElement('div');
  bar.style.cssText = 'width:8%;height:100%;border-radius:999px;background:linear-gradient(90deg,#FFF6E3,#F2BE55);transition:width .2s ease';
  barWrap.appendChild(bar);
  box.appendChild(barWrap);
  container.appendChild(box);

  return {
    el: box,
    setProgress(pct) {
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      text.textContent = `${LOADING_TEXT} ${p}%`;
      bar.style.width = `${Math.max(8, p)}%`;
    },
    setText(msg) { text.textContent = msg; },
    remove() {
      box.style.opacity = '0';
      setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 300);
    },
    dispose() { if (box.parentNode) box.parentNode.removeChild(box); },
  };
}

// ---------------- 失败回退 ----------------
/** 程序化奶团（奶白圆团 + 圆眼 + 小脚），高度≈2.2、底边贴地 */
export function buildFallbackBody() {
  const g = new THREE.Group();
  g.name = 'fallback-milk-blob';
  const bodyMat = familyMat(FAMILY.milk, { roughness: 0.42 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), bodyMat);
  body.name = 'blob-body';
  body.scale.set(0.72, 1.1, 0.66);
  body.position.y = 1.1;
  g.add(body);

  const footMat = familyMat(FAMILY.cream, { roughness: 0.44 });
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 22, 16), footMat);
    foot.name = 'blob-foot';
    foot.scale.set(1, 0.62, 1.3);
    foot.position.set(side * 0.3, 0.16, 0.12);
    g.add(foot);
  }

  const eyeMat = familyMat(FAMILY.eye, { roughness: 0.2 });
  const eyeWhite = familyMat('#FFFDF6', { roughness: 0.25 });
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), eyeWhite);
    white.name = 'blob-eye-white';
    white.position.set(side * 0.26, 1.62, 0.48);
    g.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), eyeMat);
    pupil.name = 'blob-eye';
    pupil.position.set(side * 0.27, 1.6, 0.6);
    g.add(pupil);
  }
  g.userData.isFallback = true;
  return g;
}

// ---------------- 出生粒子 / 光圈 ----------------
export function createBirthBurst({ radius = 1.1, count = 28 } = {}) {
  const group = new THREE.Group();
  group.name = 'birth-burst';
  group.userData.isSpriteHelper = true;

  const positions = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const r = radius * (0.3 + Math.random() * 0.55);
    const x = Math.cos(a) * r * 0.75;
    const y = 0.25 + Math.random() * radius * 0.95;
    const z = Math.sin(a) * r * 0.5;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = y;
    basePositions[i * 3 + 2] = z;
    velocities.push(new THREE.Vector3(
      Math.cos(a) * (0.22 + Math.random() * 0.45),
      0.5 + Math.random() * 0.8,
      Math.sin(a) * (0.18 + Math.random() * 0.32),
    ));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pointsMat = new THREE.PointsMaterial({
    color: new THREE.Color(FAMILY.milk),
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, pointsMat);
  points.name = 'birth-points';
  points.userData.isSpriteHelper = true;
  group.add(points);

  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(FAMILY.milk),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.76, 48), haloMat);
  halo.name = 'birth-halo';
  halo.position.y = radius * 0.85;
  halo.userData.isSpriteHelper = true;
  group.add(halo);

  let t = -1;
  let active = false;
  return {
    group,
    play() {
      t = 0;
      active = true;
      pointsMat.opacity = 0.95;
      geo.getAttribute('position').array.set(basePositions);
      geo.getAttribute('position').needsUpdate = true;
    },
    update(dt) {
      if (!active) return;
      t += dt;
      const p = Math.min(t / 1.15, 1);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < count; i += 1) {
        const v = velocities[i];
        pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt);
        v.multiplyScalar(1 - 1.2 * dt);
      }
      pos.needsUpdate = true;
      pointsMat.opacity = 0.95 * (1 - p) ** 1.4;
      const hp = Math.min(t / 0.75, 1);
      halo.scale.setScalar(0.35 + hp * 1.9);
      haloMat.opacity = 0.7 * (1 - hp) ** 1.2;
      if (t > 1.25) {
        active = false;
        pointsMat.opacity = 0;
        haloMat.opacity = 0;
      }
    },
    reset() {
      t = -1;
      active = false;
      pointsMat.opacity = 0;
      haloMat.opacity = 0;
    },
    dispose() {
      geo.dispose();
      pointsMat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
    },
  };
}

// ---------------- 局部高光 ----------------
/** 面向相机的加色光斑：给「头发/尾羽/壳」区域高光闪一下用 */
export function createGlowSpot(color = FAMILY.milk, size = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(255,246,227,0.5)');
  grad.addColorStop(1, 'rgba(255,246,227,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'glow-spot';
  sprite.scale.setScalar(size);
  sprite.visible = false;
  sprite.userData.isSpriteHelper = true;

  let t = -1;
  const baseSize = size;
  return {
    sprite,
    play(intensity = 1) {
      t = 0;
      sprite.visible = true;
      material.opacity = 0.85 * intensity;
      sprite.scale.setScalar(baseSize * 0.7);
    },
    update(dt) {
      if (t < 0) return;
      t += dt;
      const p = Math.min(t / 0.6, 1);
      material.opacity = 0.85 * (1 - p) ** 1.6;
      sprite.scale.setScalar(baseSize * (0.7 + p * 0.75));
      if (p >= 1) {
        t = -1;
        sprite.visible = false;
        material.opacity = 0;
      }
    },
    reset() {
      t = -1;
      sprite.visible = false;
      material.opacity = 0;
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
