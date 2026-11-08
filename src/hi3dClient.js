// 前端只读 Hi3D 任务状态（服务端返回的内容已脱敏：无 token、无密钥）
export async function fetchHi3dStatus(recipeKey) {
  try {
    const res = await fetch(`/api/hi3d/status?recipe=${encodeURIComponent(recipeKey)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    console.log("[hi3d] status", {
      recipe: recipeKey,
      taskId: data.taskId || null,
      state: data.state || null,
      credentials: data.credentials,
      asset: data.asset ? { file: data.asset.file, glbValid: data.asset.glbValid } : null,
    });
    return data;
  } catch (err) {
    console.warn("[hi3d] status unavailable:", err.message);
    return { credentials: "unknown", taskId: null, state: null, asset: null, error: err.message };
  }
}

// 提交/幂等复用 Hi3D 任务；凭证只在服务端，前端不接触任何 key/token。
export async function submitHi3d(recipeKey) {
  const res = await fetch("/api/hi3d/submit", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ recipe: recipeKey }),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: "bad_json" };
  }
  console.log("[hi3d] submit", {
    recipe: recipeKey,
    http: res.status,
    ok: !!data?.ok,
    bizCode: data?.bizCode ?? null,
    reused: !!data?.reused,
  });
  return data || { ok: false, error: "empty" };
}
