/* ============================================================
   织雾满穗 · 博客内容治理（共享逻辑，不是路由）
   ------------------------------------------------------------
   文件名以 _ 开头 → Cloudflare Pages 不会把它当成接口。
   这里放三件事：敏感词过滤、昵称清洗、举报自动下线阈值。
   ============================================================ */

/* 举报达到这个条数就自动隐藏，等管理员复核（防止刷屏内容一直挂在首页） */
export const AUTO_HIDE_REPORTS = 3;

/* 正文最长 / 昵称最长 —— 和前端 maxlength 保持一致 */
export const LIMITS = {
  name: 20,
  title: 60,
  content: 1000,
  reply: 500
};

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

/* 正文清洗：保留换行（博客需要分段），但去掉多余空行与控制字符 */
export function cleanBody(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
