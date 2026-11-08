const pendingKey = "naijia.customFusion.pending";

export function getPendingFusion(subject) {
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
    return pending?.subject === subject ? pending.id : null;
  } catch {
    return null;
  }
}

export function clearPendingFusion() {
  sessionStorage.removeItem(pendingKey);
}

export async function startFusion(subject) {
  let id = getPendingFusion(subject);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(pendingKey, JSON.stringify({ id, subject }));
  }
  const response = await fetch("/api/fusion/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, subject }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "无法创建融合任务");
  return data;
}

export async function getFusion(id, signal) {
  const response = await fetch("/api/fusion/jobs/" + encodeURIComponent(id), { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "查询生成进度失败");
  return data;
}
