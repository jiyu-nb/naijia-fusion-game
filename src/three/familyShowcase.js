// src/three/familyShowcase.js —— 融合屏：展示一只真实亲本 GLB（owner: three-frog）
// createShowcase(container, { id:'niwa', angle:0, onReady, transparent })
// 缓慢转台 + 呼吸；无交互、无 UI；加载失败回退程序化奶团（getModelSource()==='fallback'）。
import * as THREE from 'three';
import { createStage } from './stage.js';
import {
  TARGET_HEIGHT,
  addFamilyLights,
  buildFallbackBody,
  countTriangles,
  disposeObject3D,
  ensurePositioned,
  fitCameraToBox,
  loadGLB,
  normalizeModel,
  spinBoxOf,
} from './familyCore.js';

const TURNTABLE_SPEED = 0.32; // rad/s ≈ 20 秒一圈
const BREATH_SPEED = 1.6;
const BREATH_AMP = 0.012;

/**
 * @param {HTMLElement} container
 * @param {{id?:string, angle?:number, onReady?:Function, transparent?:boolean}} opts
 *        id: 'niwa'（默认）或 '/assets/family/xxx.glb'；angle: 初始朝向（度，0 = 正面朝 +Z）
 * @returns {Promise<{dispose:Function, getModelSource:Function, getDebugState:Function,
 *                    scene:object, camera:object, renderer:object}>}
 */
export async function createShowcase(container, opts = {}) {
  const id = String(opts.id || 'niwa');
  const url = id.startsWith('/') ? id : `/assets/family/${id}.glb`;
  const angle = Number.isFinite(opts.angle) ? THREE.MathUtils.degToRad(opts.angle) : 0;

  const stage = createStage(container, { preserveDrawingBuffer: !!opts.transparent });
  const { scene, camera, renderer } = stage;
  const extraLights = addFamilyLights(scene);
  const restoreContainerStyle = ensurePositioned(container);

  const root = new THREE.Group();
  root.name = `showcase-${id}`;
  scene.add(root);

  let modelSource = 'fallback';
  let loadError = null;
  let triangles = 0;
  const t0 = performance.now();

  let model = null;
  try {
    const gltf = await loadGLB(url);
    model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!model) throw new Error('GLB 里没有可用 scene');
    modelSource = 'family-glb';
    triangles = countTriangles(model);
  } catch (err) {
    loadError = (err && (err.message || err.type)) || String(err);
    console.warn(`[showcase] ${id} 加载失败，回退程序化奶团：`, loadError);
    model = buildFallbackBody();
  }

  const norm = normalizeModel(model, TARGET_HEIGHT);
  const size = { x: +norm.size.x.toFixed(3), y: +norm.size.y.toFixed(3), z: +norm.size.z.toFixed(3) };
  root.add(norm.wrap);
  root.rotation.y = angle;
  root.updateMatrixWorld(true);

  // 转台会转一圈 → 取景用旋转不变的包围盒
  const box = spinBoxOf(new THREE.Box3().setFromObject(root));
  let lastAspect = -1;
  const refit = () => {
    lastAspect = camera.aspect;
    fitCameraToBox(camera, box, { elevDeg: 11, fill: 0.86 });
  };
  refit();

  let tSec = 0;
  const offFrame = stage.onFrame((dt) => {
    tSec += dt;
    root.rotation.y = angle + tSec * TURNTABLE_SPEED;
    const breath = 1 + Math.sin(tSec * BREATH_SPEED) * BREATH_AMP;
    norm.wrap.scale.setScalar(norm.scale * breath);
    if (Math.abs(camera.aspect - lastAspect) > 1e-4) refit();
  });

  const loadMs = Math.round(performance.now() - t0);
  const readyPayload = { ok: modelSource === 'family-glb', id, loadMs, triangles, size };
  if (opts.onReady) {
    try { opts.onReady(readyPayload); } catch (err) { console.warn('[showcase] onReady 异常', err); }
  }

  function getModelSource() { return modelSource; }

  function getDebugState() {
    return {
      id,
      modelSource,
      loaded: true,
      loadMs,
      loadError,
      triangles,
      size,
      angleDeg: Math.round(THREE.MathUtils.radToDeg(angle)),
      turntableDeg: +THREE.MathUtils.radToDeg(tSec * TURNTABLE_SPEED).toFixed(1),
      readyPayload,
    };
  }

  function dispose() {
    try {
      offFrame();
      disposeObject3D(root);
      scene.remove(root);
      scene.remove(extraLights);
    } finally {
      if (restoreContainerStyle) restoreContainerStyle();
      stage.dispose();
    }
  }

  return { dispose, getModelSource, getDebugState, scene, camera, renderer, stage, root };
}

export default createShowcase;
