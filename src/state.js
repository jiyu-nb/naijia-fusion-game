// 全局状态 + 存档：v2「奶家人」存档；旧版 v0.1 存档继续读取
import { fusionForPartner } from "./recipes.js";

const RECORD_KEY = "zheizai.family.v2";
const DISCOVERED_KEY = "zheizai.family.discovered.v2";
const LEGACY_KEY = "zheizai.record.v1";

export const state = {
  partner: null,
  fusion: null,
  record: null,
  legacy: null,
  discovered: [],
  muted: false,
  modelSource: "unknown",
  hi3d: null,
};

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function loadRecord() {
  const record = readJson(RECORD_KEY);
  state.record = record && record.babyName && record.version === 2 ? record : null;
  const legacy = readJson(LEGACY_KEY);
  state.legacy = legacy && legacy.babyName && legacy.version !== 2 ? legacy : null;
  const discovered = readJson(DISCOVERED_KEY);
  state.discovered = Array.isArray(discovered) ? discovered.filter((id) => typeof id === "string") : [];
  if (state.record?.babyId && !state.discovered.includes(state.record.babyId)) {
    state.discovered.push(state.record.babyId);
  }
  return state.record;
}

export function saveRecord({ child, trait }) {
  const record = {
    version: 2,
    babyId: child.id,
    babyName: child.name,
    babyArt: child.art,
    tagline: child.tagline,
    traitId: trait.id,
    traitName: trait.name,
    traitDesc: trait.desc,
    traitFrom: trait.from || "",
    parents: child.parents,
    at: new Date().toISOString(),
  };
  state.record = record;
  writeJson(RECORD_KEY, record);
  if (!state.discovered.includes(child.id)) {
    state.discovered.push(child.id);
    writeJson(DISCOVERED_KEY, state.discovered);
  }
  return record;
}

export function clearRecord() {
  state.record = null;
  try {
    localStorage.removeItem(RECORD_KEY);
  } catch {
    /* ignore */
  }
}

export function selectPartner(partnerId) {
  state.partner = state.partner === partnerId ? null : partnerId;
  return state.partner;
}

export function resetSelection() {
  state.partner = null;
  state.fusion = null;
}

export function currentFusion() {
  if (!state.partner) return null;
  return fusionForPartner(state.partner);
}
