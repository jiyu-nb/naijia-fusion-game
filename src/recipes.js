// 《这崽随谁 · 奶家人》数据表
// 关系：只有奶蛙是亲本；奶蛋/奶包/奶狗/奶鸡 = 奶蛙 × 鸡蛋/豆包/狗/鸡 的融合结果。
// 现实亲本头像由用户提供（见 public/art/partners/source_*.png），不是 3D 资产。
export const FROG = {
  id: "niwa",
  name: "奶蛙",
  role: "亲本",
  note: "家里唯一的奶源",
  tag: "奶白肚皮 · 一碰就弹",
  file: "/assets/family/niwa.glb",
  art: "/art/family/niwa_1024.png",
  thumb: "/art/family/niwa_512.png",
  card: "/art/family/niwa_256.png",
};

export const PARTNERS = [
  {
    id: "jidan",
    name: "鸡蛋",
    note: "现实亲本 · 溏心蛋",
    avatar: "/art/partners/egg_user_512.png",
    thumb: "/art/partners/egg_user_256.png",
    color: "#FFF3D6",
  },
  {
    id: "doubao",
    name: "豆包",
    note: "现实亲本 · 黑亮刘海",
    avatar: "/art/partners/doubao_user_512.png",
    thumb: "/art/partners/doubao_user_256.png",
    color: "#F6E6CF",
  },
  {
    id: "gou",
    name: "狗",
    note: "现实亲本 · 尾巴很忙",
    avatar: "/art/partners/dog_user_512.png",
    thumb: "/art/partners/dog_user_256.png",
    color: "#F3DFC4",
  },
  {
    id: "ji",
    name: "鸡",
    note: "现实亲本 · 起得最早",
    avatar: "/art/partners/chicken_user_512.png",
    thumb: "/art/partners/chicken_user_256.png",
    color: "#F7DFC7",
  },
];

export const CHILDREN = [
  {
    id: "naidan",
    name: "奶蛋",
    partner: "jidan",
    parents: ["niwa", "jidan"],
    art: "/art/family/naidan_1024.png",
    thumb: "/art/family/naidan_512.png",
    card: "/art/family/naidan_256.png",
    model: "/assets/family/naidan.glb",
    tagline: "奶蛙的软，鸡蛋的圆，一戳就弹",
    featureLine: "奶蛙的软肚皮 + 鸡蛋的圆壳",
    playHint: "戳戳它的蛋壳",
    doneText: "啵！它弹了三下",
    action: "tap-shell",
    traits: [
      { id: "shellbounce", name: "一戳就弹", desc: "手指刚碰到壳，它已经弹完了", from: "奶蛙" },
      { id: "round", name: "圆得没棱角", desc: "从哪个角度看都是一个圆", from: "鸡蛋" },
    ],
  },
  {
    id: "naibao",
    name: "奶包",
    partner: "doubao",
    parents: ["niwa", "doubao"],
    art: "/art/family/naibao_1024.png",
    thumb: "/art/family/naibao_512.png",
    card: "/art/family/naibao_256.png",
    model: "/assets/family/naibao.glb",
    tagline: "奶蛙的软，豆包的黑亮刘海",
    featureLine: "奶蛙的圆脸 + 豆包的黑亮刘海",
    playHint: "点点她的刘海",
    doneText: "嘿嘿！刘海先笑了",
    action: "tap-hair",
    traits: [
      { id: "hairbob", name: "刘海会弹", desc: "点一下头顶，整片刘海先跳", from: "奶蛙" },
      { id: "beanshine", name: "黑亮刘海", desc: "黑亮黑亮的，像刚熬好的豆沙", from: "豆包" },
    ],
  },
  {
    id: "naigou",
    name: "奶狗",
    partner: "gou",
    parents: ["niwa", "gou"],
    art: "/art/family/naigou_1024.png",
    thumb: "/art/family/naigou_512.png",
    card: "/art/family/naigou_256.png",
    model: "/assets/family/naigou.glb",
    tagline: "奶蛙的软，狗的垂耳和尾巴",
    featureLine: "奶蛙的圆身子 + 狗的垂耳、尾巴",
    playHint: "拖拖它的小尾巴",
    doneText: "汪！尾巴摇成螺旋桨",
    action: "drag-tail",
    traits: [
      { id: "tailfirst", name: "尾巴先摇", desc: "还没笑，尾巴已经摇成螺旋桨", from: "狗" },
      { id: "smileyes", name: "笑到没眼睛", desc: "一开心眼睛就眯成两条缝", from: "奶蛙" },
    ],
  },
  {
    id: "naiji",
    name: "奶鸡",
    partner: "ji",
    parents: ["niwa", "ji"],
    art: "/art/family/naiji_1024.png",
    thumb: "/art/family/naiji_512.png",
    card: "/art/family/naiji_256.png",
    model: "/assets/family/naiji.glb",
    tagline: "奶蛙的软，鸡的红冠和尾羽",
    featureLine: "奶蛙的圆身子 + 鸡冠、喙、尾羽",
    playHint: "点点它头顶的红冠",
    doneText: "喔喔——尾羽先炸开",
    action: "tap-comb",
    traits: [
      { id: "crowhop", name: "打鸣先蹦", desc: "喔喔还没落地，脚先离地", from: "鸡" },
      { id: "tailbloom", name: "尾羽开花", desc: "一叫，尾巴比嗓子先炸开", from: "奶蛙" },
    ],
  },
];

export const CHILDREN_BY_ID = Object.fromEntries(CHILDREN.map((c) => [c.id, c]));
export const PARTNERS_BY_ID = Object.fromEntries(PARTNERS.map((p) => [p.id, p]));

export function childById(id) {
  return CHILDREN_BY_ID[id] || null;
}

export function partnerById(id) {
  return PARTNERS_BY_ID[id] || null;
}

export function fusionForPartner(partnerId) {
  const child = CHILDREN.find((c) => c.partner === partnerId);
  if (!child) return null;
  return { ...child, key: `niwa+${partnerId}`, frog: "niwa", partnerId };
}

export function fusionForChild(childId) {
  const child = childById(childId);
  if (!child) return null;
  return { ...child, key: `niwa+${child.partner}`, frog: "niwa", partnerId: child.partner };
}

const NAMES = {
  niwa: "奶蛙",
  jidan: "鸡蛋",
  doubao: "豆包",
  gou: "狗",
  ji: "鸡",
  naidan: "奶蛋",
  naibao: "奶包",
  naigou: "奶狗",
  naiji: "奶鸡",
};

export function nameById(id) {
  return NAMES[id] || id;
}

// 旧版 v0.1 存档（zheizai.record.v1）：只读展示，不参与新配方。
export const LEGACY_BABY_NAMES = {
  zaishuiwufenwa: "再睡五分蛙",
  louyikou: "漏一口",
  xingnaibei: "醒奶杯",
};

export const LEGACY_PARENT_NAMES = {
  frog: "奶蛙",
  alarm: "闹钟",
  milk: "奶杯",
};

export const FUSION_BY_PARTNER = Object.fromEntries(PARTNERS.map((p) => [p.id, fusionForPartner(p.id)]));
