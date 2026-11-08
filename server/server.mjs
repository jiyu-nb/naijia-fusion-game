// 《这崽随谁》本地预览服务器：静态资源 + Hi3D 服务端代理（密钥只在服务端）
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCredentials, submitTask, queryTask, downloadAsset, HI3D_API_BASE } from "./hi3d.mjs";
import { createFusionJob, getFusionJob } from "./fusion-agent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.PORT || 5188);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
};

const ROUTES = [
  [/^\/vendor\//, "public"],
  [/^\/art\//, "public"],
  [/^\/assets\//, "public"],
  [/^\/public\//, ""],
  [/^\/src\//, ""],
];

function resolveStatic(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean === "/" || clean === "") return path.join(root, "index.html");
  if (clean.includes("..")) return null;
  for (const [pattern, prefix] of ROUTES) {
    if (pattern.test(clean)) {
      const rel = clean.replace(/^\//, "").replace(/^family\//, "");
      const base = path.isAbsolute(prefix) ? prefix : path.join(root, prefix);
      return path.join(base, rel);
    }
  }
  if (/^\/(index\.html|favicon\.ico|README\.md)$/.test(clean)) return path.join(root, clean.slice(1));
  return null;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readTaskState(recipe) {
  try {
    return JSON.parse(await readFile(path.join(root, "data", "hi3d", `${recipe}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function saveTaskState(recipe, stateObj) {
  await mkdir(path.join(root, "data", "hi3d"), { recursive: true });
  await writeFile(
    path.join(root, "data", "hi3d", `${recipe}.json`),
    JSON.stringify(stateObj, null, 2),
    "utf8",
  );
}

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function handleStatus(res, url) {
  const recipe = url.searchParams.get("recipe") || "zaishuiwufenwa";
  const creds = await loadCredentials();
  const task = await readTaskState(recipe);
  const modelPath = path.join(root, "public", "assets", "models", `${recipe}.glb`);
  const providedPath = path.join(root, "public", "assets", "family", `${recipe}.glb`);
  const exists = await fileExists(modelPath);
  const provided = await fileExists(providedPath);
  let account = null;
  try {
    account = JSON.parse(await readFile(path.join(root, "data", "hi3d", "account.json"), "utf8"));
  } catch {
    account = null;
  }
  sendJson(res, 200, {
    recipe,
    credentials: creds.accessKey && creds.secretKey ? "present" : "missing",
    taskId: task?.taskId || null,
    state: task?.state || "none",
    submittedAt: task?.submittedAt || null,
    account: account
      ? {
          provider: account.provider || "hitem3d",
          credentials: account.credentials || null,
          lastError: account.lastError || null,
          checkedAt: account.checkedAt || null,
        }
      : null,
    provided: provided
      ? {
          file: `public/assets/family/${recipe}.glb`,
          bytes: (await stat(providedPath)).size,
          source: "user-provided-family-asset",
        }
      : null,
    asset: exists
      ? {
          file: `public/assets/models/${recipe}.glb`,
          bytes: task?.asset?.bytes || null,
          glbValid: task?.asset?.glbValid ?? null,
          downloadedAt: task?.asset?.downloadedAt || null,
        }
      : null,
    note:
      task?.note ||
      (creds.accessKey ? null : "服务端未配置 HI3D_ACCESS_KEY / HI3D_SECRET_KEY"),
  });
}

async function pollInBackground(recipe, taskId) {
  const creds = await loadCredentials();
  for (let i = 0; i < 240; i += 1) {
    try {
      const data = await queryTask(creds, taskId);
      const st = data?.state || data?.status || "unknown";
      const current = (await readTaskState(recipe)) || { recipe, taskId };
      current.state = st;
      current.lastQueryAt = new Date().toISOString();
      await saveTaskState(recipe, current);
      console.log(`[hi3d] poll ${recipe} state=${st}`);
      const url = data?.url || data?.model_url || data?.download_url;
      if ((st === "success" || st === "succeed") && url) {
        const dest = path.join(root, "public", "assets", "models", `${recipe}.glb`);
        const dl = await downloadAsset(url, dest);
        current.state = dl.header === "glTF" ? "downloaded" : "downloaded_invalid";
        current.asset = {
          file: `public/assets/models/${recipe}.glb`,
          bytes: dl.bytes,
          magic: dl.header,
          glbValid: dl.header === "glTF",
          downloadedAt: new Date().toISOString(),
        };
        await saveTaskState(recipe, current);
        console.log(`[hi3d] downloaded ${recipe}.glb ${dl.bytes}B magic=${dl.header}`);
        return;
      }
      if (["failed", "fail", "error"].includes(st)) return;
    } catch (err) {
      console.warn(`[hi3d] poll error for ${recipe}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
}

async function handleSubmit(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid_json" });
  }
  const recipe = body.recipe || "zaishuiwufenwa";
  const existing = await readTaskState(recipe);
  if (existing?.taskId) {
    return sendJson(res, 200, {
      ok: true,
      reused: true,
      taskId: existing.taskId,
      state: existing.state,
      credentials: "present",
    });
  }
  const creds = await loadCredentials();
  if (!creds.accessKey || !creds.secretKey) {
    return sendJson(res, 503, {
      ok: false,
      error: "credentials_missing",
      message: "服务端未配置 HI3D_ACCESS_KEY / HI3D_SECRET_KEY",
    });
  }
  try {
    const candidates = [
      path.join(root, "public", "art", "family", `${recipe}_1024.png`),
      path.join(root, "public", "art", `${recipe}_1024.png`),
      path.join(root, "public", "art", "family", `${recipe}.png`),
    ];
    let art = null;
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        art = candidate;
        break;
      }
    }
    if (!art) {
      return sendJson(res, 400, { ok: false, error: "concept_art_missing", recipe });
    }
    const result = await submitTask(creds, { imagePath: art });
    const stateObj = {
      recipe,
      taskId: result.taskId,
      submittedAt: new Date().toISOString(),
      model: "hi3dv3.0",
      resolution: "2048quality",
      requestType: 3,
      format: "glb",
      sourceImage: path.basename(art),
      state: "submitted",
    };
    await saveTaskState(recipe, stateObj);
    console.log(`[hi3d] submitted ${recipe} task_id=${result.taskId}`);
    void pollInBackground(recipe, result.taskId);
    return sendJson(res, 200, { ok: true, reused: false, taskId: result.taskId, state: "submitted" });
  } catch (err) {
    const stateObj = (await readTaskState(recipe)) || { recipe };
    stateObj.state = "submit_failed";
    stateObj.lastError = { code: err.bizCode ?? null, message: err.message, at: new Date().toISOString() };
    await saveTaskState(recipe, stateObj);
    console.warn(`[hi3d] submit failed for ${recipe}: ${err.message}`);
    return sendJson(res, err.httpStatus === 200 ? 409 : 502, {
      ok: false,
      error: "submit_failed",
      bizCode: err.bizCode ?? null,
      message: String(err.message).slice(0, 200),
    });
  }
}

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error("请求内容过长");
  }
  try { return JSON.parse(body); }
  catch { throw new Error("请求格式无效"); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname === "/api/fusion/jobs" && req.method === "POST") {
      try {
        const { id, subject } = await readRequestJson(req);
        return sendJson(res, 202, await createFusionJob(id, subject));
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }
    const fusionMatch = url.pathname.match(/^\/api\/fusion\/jobs\/([0-9a-f-]+)$/i);
    if (fusionMatch && req.method === "GET") {
      const job = await getFusionJob(fusionMatch[1]);
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: "任务不存在" });
    }
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, service: "zheizai-v01", hi3dApi: HI3D_API_BASE, time: new Date().toISOString() });
    }
    if (url.pathname === "/api/hi3d/status") return await handleStatus(res, url);
    if (url.pathname === "/api/hi3d/submit" && req.method === "POST") return await handleSubmit(req, res);

    const filePath = resolveStatic(url.pathname);
    if (!filePath) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404");
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404 not found: " + url.pathname);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("[server] error", err.message);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const credsPresent = !!(process.env.HI3D_ACCESS_KEY || process.env.HI3D_SECRET_KEY || process.env.HI3D_ENV_FILE);
  console.log(`[zheizai] http://${HOST}:${PORT}/  (hi3d credentials source: ${credsPresent ? "configured" : "not in env"})`);
  console.log(`[zheizai] Hi3D API base ${HI3D_API_BASE}; secrets never leave the server.`);
});
