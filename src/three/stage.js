// src/three/stage.js —— 三渲二底座（owner: three-frog）
// 契约：createStage(container) -> { scene, camera, renderer, onFrame, requestRender, setSize, dispose }
// 预置：柔和环境光 + 主光/补光/轮廓光（三点布光）、透明背景、透视相机、devicePixelRatio 上限 2、自动 resize。
import * as THREE from 'three';

const MAX_DPR = 2; // 硬约束：dpr ≤ 2
const FALLBACK_W = 390; // 抖音竖屏基准
const FALLBACK_H = 844;

/**
 * 创建一个自带灯光与渲染循环的舞台。
 * @param {HTMLElement} container 承载 canvas 的容器（父容器负责等比缩放）
 * @param {{preserveDrawingBuffer?: boolean, alpha?: boolean}} [options]
 *        preserveDrawingBuffer: 需要 canvas.toDataURL() 抓透明设定图时置 true（略降性能）
 */
export function createStage(container, options = {}) {
  if (!container || !container.appendChild) {
    throw new Error('[stage] createStage 需要一个可挂载的容器元素');
  }

  // ---------- 渲染器 ----------
  const renderer = new THREE.WebGLRenderer({
    alpha: options.alpha !== false,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
    preserveDrawingBuffer: !!options.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setClearColor(0x000000, 0); // 透明背景：透出 DOM 里的奶白/薄荷背景
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = false; // 透明底不铺地面投影，保持轻快

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none'; // 移动端：不让浏览器抢走手势
  canvas.style.userSelect = 'none';
  canvas.setAttribute('aria-label', '三维小蛙');
  container.appendChild(canvas);

  // ---------- 场景 ----------
  const scene = new THREE.Scene();
  scene.background = null; // 透明
  // 轻微雾化可让边缘柔一点，但透明底上会发灰，故不加雾。

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.position.set(0, 1.85, 4.6);
  camera.lookAt(0, 1.0, 0);

  // ---------- 三点柔光 ----------
  // 环境：天空奶白 / 地面焦糖，负责整体柔和的体积感
  const hemi = new THREE.HemisphereLight(0xfff6e6, 0xdcbf95, 1.25);
  hemi.name = 'stage-hemi';
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xfff1dc, 0.32);
  ambient.name = 'stage-ambient';
  scene.add(ambient);

  // 主光：右上前方，暖白，勾出蛙身的圆润高光
  const keyLight = new THREE.DirectionalLight(0xfff3e2, 2.15);
  keyLight.position.set(2.8, 5.2, 4.4);
  keyLight.name = 'stage-key';
  scene.add(keyLight);

  // 补光：左侧偏冷（薄荷偏蓝），压掉死黑
  const fillLight = new THREE.DirectionalLight(0xbfe9ff, 0.62);
  fillLight.position.set(-4.2, 2.0, 3.0);
  fillLight.name = 'stage-fill';
  scene.add(fillLight);

  // 轮廓光：后上方，金色，把蛙从奶白底里剥出来
  const rimLight = new THREE.DirectionalLight(0xf3c463, 1.05);
  rimLight.position.set(-1.8, 3.4, -4.6);
  rimLight.name = 'stage-rim';
  scene.add(rimLight);

  // 一点点正面补白，让肚皮不至于发闷
  const bounce = new THREE.PointLight(0xfff4e0, 8, 12, 2);
  bounce.position.set(0, 0.6, 3.4);
  bounce.name = 'stage-bounce';
  scene.add(bounce);

  // ---------- 尺寸 ----------
  function readSize() {
    const rect = typeof container.getBoundingClientRect === 'function'
      ? container.getBoundingClientRect()
      : { width: 0, height: 0 };
    const w = Math.round(rect.width || container.clientWidth || 0);
    const h = Math.round(rect.height || container.clientHeight || 0);
    return { w: w > 0 ? w : FALLBACK_W, h: h > 0 ? h : FALLBACK_H };
  }

  function setSize(w, h) {
    const size = (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0)
      ? { w: Math.round(w), h: Math.round(h) }
      : readSize();
    camera.aspect = size.w / Math.max(size.h, 1);
    camera.updateProjectionMatrix();
    // 第三个参数 false：CSS 已设 100%，不要被内联尺寸覆盖
    renderer.setSize(size.w, size.h, false);
    return size;
  }

  setSize();

  // ---------- 渲染循环 ----------
  const clock = new THREE.Clock();
  const frameCbs = new Set();
  let elapsed = 0;
  let dirty = true;
  let disposed = false;

  function tick() {
    if (disposed) return;
    // 切后台/长卡顿回来时不要「跳帧」；正常掉帧（软渲染 10fps）仍按真实时间推进，动画不变慢
    const rawDt = clock.getDelta();
    const dt = rawDt > 0.35 ? 0.05 : rawDt;
    elapsed += dt;

    for (const cb of frameCbs) {
      try {
        cb(dt, elapsed);
      } catch (err) {
        // 单个回调抛错不应该炸掉整个舞台
        console.error('[stage] onFrame 回调异常：', err);
      }
    }

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (w > 0 && h > 0) {
      try {
        renderer.render(scene, camera);
        dirty = false;
      } catch (err) {
        console.error('[stage] render 异常：', err);
      }
    }
  }

  renderer.setAnimationLoop(tick);

  // ---------- 自动 resize ----------
  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      setSize();
      dirty = true;
    });
    resizeObserver.observe(container);
  }
  const onWindowResize = () => {
    setSize();
    dirty = true;
  };
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onWindowResize);

  // WebGL 上下文丢失时不要让页面变白，只在回来时重绘
  const onContextLost = (event) => {
    event.preventDefault();
    console.warn('[stage] WebGL 上下文丢失，等待恢复');
  };
  const onContextRestored = () => {
    dirty = true;
  };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  // ---------- 对外 API ----------
  function onFrame(cb) {
    if (typeof cb !== 'function') return () => {};
    frameCbs.add(cb);
    return () => frameCbs.delete(cb);
  }

  // 循环常驻（呼吸/动画需要连续帧）；requestRender 只标脏，保证下次循环一定重绘。
  function requestRender() {
    if (disposed) return;
    dirty = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      renderer.setAnimationLoop(null);
    } catch { /* 忽略 */ }
    frameCbs.clear();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('orientationchange', onWindowResize);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    try {
      renderer.dispose();
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
    } catch { /* 忽略 */ }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return {
    scene,
    camera,
    renderer,
    onFrame,
    requestRender,
    setSize,
    dispose,
    // 便捷引用（非契约必需，但测试页/调试好用）
    canvas,
    container,
    lights: { hemi, ambient, keyLight, fillLight, rimLight, bounce },
    get isDirty() { return dirty; },
  };
}

export default createStage;
