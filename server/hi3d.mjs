// Hi3D Open API client (server-side only).
// Credentials come from the process environment (HI3D_ACCESS_KEY / HI3D_SECRET_KEY)
// or from an env file pointed to by HI3D_ENV_FILE. They are never returned to the
// frontend, never written into the repo and never logged.
import { readFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = (process.env.HI3D_API_BASE || "").replace(/\/$/, "");

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function loadCredentials({ envFile } = {}) {
  const fromEnv = {
    accessKey: process.env.HI3D_ACCESS_KEY || "",
    secretKey: process.env.HI3D_SECRET_KEY || "",
  };
  if (fromEnv.accessKey && fromEnv.secretKey) {
    return { ...fromEnv, source: "process-env" };
  }
  const file = envFile || process.env.HI3D_ENV_FILE || "";
  if (!file) return { accessKey: "", secretKey: "", source: "missing" };
  try {
    const parsed = parseEnvFile(await readFile(file, "utf8"));
    return {
      accessKey: parsed.HI3D_ACCESS_KEY || fromEnv.accessKey,
      secretKey: parsed.HI3D_SECRET_KEY || fromEnv.secretKey,
      source: `env-file:${path.basename(file)}`,
    };
  } catch {
    return { accessKey: "", secretKey: "", source: "missing" };
  }
}

function basicAuth(accessKey, secretKey) {
  return "Basic " + Buffer.from(`${accessKey}:${secretKey}`, "utf8").toString("base64");
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: response.status, msg: text.slice(0, 300) };
  }
}

export async function fetchAccessToken(creds) {
  if (!API_BASE) throw new Error("请配置 HI3D_API_BASE");
  const response = await fetch(`${API_BASE}/open-api/v1/auth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds.accessKey, creds.secretKey),
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const body = await readJsonSafe(response);
  const token = body?.data?.accessToken || body?.data?.access_token;
  if (!response.ok || !token) {
    const err = new Error(`token_failed http=${response.status} code=${body?.code} msg=${body?.msg}`);
    err.httpStatus = response.status;
    err.bizCode = body?.code;
    throw err;
  }
  return token;
}

export async function submitTask(creds, { imagePath, model = "hi3dv3.0", resolution = "2048quality", requestType = "3", format = "2", face = "2000000" }) {
  const token = await fetchAccessToken(creds);
  const image = await readFile(imagePath);
  const form = new FormData();
  form.append("images", new Blob([image], { type: "image/png" }), path.basename(imagePath));
  form.append("request_type", String(requestType));
  form.append("model", model);
  form.append("resolution", resolution);
  form.append("format", String(format));
  form.append("pbr", "1");
  form.append("rmbg", "1");
  form.append("shading", "0.5");
  if (face) form.append("face", String(face));

  const response = await fetch(`${API_BASE}/open-api/v1/submit-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readJsonSafe(response);
  const taskId = body?.data?.task_id;
  if (!response.ok || !taskId) {
    const err = new Error(`submit_failed http=${response.status} code=${body?.code} msg=${body?.msg}`);
    err.httpStatus = response.status;
    err.bizCode = body?.code;
    err.body = body;
    throw err;
  }
  return { taskId, code: body?.code, msg: body?.msg, raw: body };
}

export async function queryTask(creds, taskId) {
  const token = await fetchAccessToken(creds);
  const url = `${API_BASE}/open-api/v1/query-task?task_id=${encodeURIComponent(taskId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await readJsonSafe(response);
  if (!response.ok || (body?.code && String(body.code) !== "200")) {
    const err = new Error(`query_failed http=${response.status} code=${body?.code} msg=${body?.msg}`);
    err.httpStatus = response.status;
    err.bizCode = body?.code;
    throw err;
  }
  return body?.data ?? body;
}

export async function queryBalance(creds) {
  const token = await fetchAccessToken(creds);
  const response = await fetch(`${API_BASE}/open-api/v1/balance`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJsonSafe(response);
}

export async function downloadAsset(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download_failed http=${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  return { bytes: buffer.length, header: buffer.subarray(0, 4).toString("ascii") };
}

export const HI3D_API_BASE = API_BASE;
