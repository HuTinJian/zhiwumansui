/* ============================================================
   织雾满穗 · 社区内容治理（共享逻辑，不是路由）
   ------------------------------------------------------------
   文件名以 _ 开头 → Cloudflare Pages 不会把它当成接口。
   这里放三件事：敏感词过滤、昵称/正文清洗、客户端身份校验。

   【注意】举报不再自动隐藏内容 —— 是否下架由站长在后台人工判断。
   所以这里没有「举报阈值」这个常量了。
   ============================================================ */

/* 正文最长 / 昵称最长 —— 和前端 maxlength 保持一致 */
export const LIMITS = {
  name: 20,
  title: 60,
  content: 1000,
  reply: 500
};

/* ---------- 板块 ----------
   社区按内容类型分板块，存的是这里的英文 id，中文名只在前端显示。
   顺序 = 页面上的显示顺序。想加板块：这里加一条，
   再到 blog.html 里搜 `var BOARDS` 加同名的一条（两边必须一致）。 */
export const KINDS = ['resource', 'game', 'bug', 'idea', 'chat'];

/* 没选、或选了不认识的值 → 落到「闲聊」，保证每条内容都有归属 */
export const DEFAULT_KIND = 'chat';

export function normalizeKind(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return KINDS.indexOf(s) !== -1 ? s : null;
}

/* ---------- 敏感词 ----------
   这是一份「最小可用」清单，覆盖最常见的几类：
   辱骂、色情、赌博、诈骗引流、广告刷屏。
   想加词直接往数组里塞即可，前后会自动做去空格/全角归一化处理。 */
const BLOCKED_WORDS = [
  /* 辱骂 */
  '傻逼', '煞笔', '沙比', '智障', '脑残', '废物', '贱人', '狗东西', '去死', '死全家',
  '妈的', '他妈', '尼玛', '草泥马', 'cnm', 'nmsl', 'sb玩意',
  /* 色情 */
  '色情', '裸聊', '约炮', '一夜情', '成人视频', '黄片', '做爱', '操逼', '嫩穴',
  /* 赌博 / 诈骗 */
  '赌博', '博彩', '下注', '六合彩', '时时彩', '私彩', '代充', '代练', '刷钻',
  '刷单', '兼职日结', '高薪日结', '点击领', '点击领取', '免费领皮肤',
  /* 引流广告 */
  '加微信', '加qq', '加vx', '微信号', '扫码进群', '进群领', '私聊我买', '出售账号',
  '低价出', '代刷', '外挂', '辅助脚本', '破解版'
];

/* 归一化：去掉空白与常见分隔符，全角转半角，小写化。
   目的是让「加 微 信」「加\u200b微信」这类绕过手段也能被命中。 */
function normalize(text) {
  return String(text || '')
    .replace(/[\u200b-\u200f\u2028-\u202f\ufeff]/g, '')
    .replace(/[\s._\-*·•|/\\+~^]+/g, '')
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/* 命中就返回那个词，没命中返回 null */
export function findBlockedWord(...texts) {
  const joined = normalize(texts.filter(Boolean).join('\n'));
  if (!joined) return null;
  for (const word of BLOCKED_WORDS) {
    if (joined.includes(normalize(word))) return word;
  }
  return null;
}

/* 昵称清洗：去掉控制字符和首尾空白，压掉连续空白 */
export function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 正文清洗：保留换行（帖子需要分段），但去掉多余空行与控制字符 */
export function cleanBody(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* 头像清洗：只接受两种形式 ——
     · 一个 emoji（最多 8 个字符，够放组合 emoji）
     · 一个 http(s) 图片直链
   其它一律拒绝（返回 null）。

   【为什么不做文件上传】本站没有配置对象存储（R2 之类），收了图片没地方放，
   硬塞进数据库又会被体积和流量拖垮。等哪天有存储了再换成上传，
   接口形状不用改（前端换个 input 就行）。 */
export function cleanAvatar(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length > 300) return null;
  if (/^https?:\/\//i.test(s)) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
  }
  const emoji = s.replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (!emoji || emoji.length > 8) return null;
  return emoji;
}

/* 客户端身份格式（32 位随机十六进制） */
const CLIENT_ID_PATTERN = /^[a-z0-9]{16,40}$/;

export function normalizeClientId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return CLIENT_ID_PATTERN.test(id) ? id : null;
}

/* 某个人是否已被拉黑 */
export async function isBanned(env, clientId) {
  if (!clientId) return false;
  try {
    const row = await env.DB.prepare(
      'SELECT client_id FROM blog_bans WHERE client_id = ?'
    ).bind(clientId).first();
    return !!row;
  } catch (e) {
    /* 表还没建（老库没跑迁移）时不拦人，只是失去这层保护 */
    return false;
  }
}
