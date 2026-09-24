/* ============================================================
   织雾满穗 · 博客账号（共享逻辑，不是路由）
   ------------------------------------------------------------
   文件名以 _ 开头 → Cloudflare Pages 不会把它当成接口。

   设计要点：
   · 浏览不需要登录；发文章和发评论需要登录。
   · 密码只存「随机盐 + SHA-512 哈希」，绝不存明文，也不回传。
   · 登录态用签名 Cookie：zm_blog_user=<userId>.<过期秒>.<HMAC-SHA256>
     签名密钥复用站点已有的 AUTH_TOKEN，不额外引入新的密钥。
   · Cookie 属性 HttpOnly + Secure + SameSite=Strict，前端脚本读不到，防 XSS 窃取。
   ============================================================ */

import { toHex, timingSafeEqual, readCookie } from '../_utils.js';
import { hasAvatarColumn } from './_schema.js';

export const USER_COOKIE = 'zm_blog_user';

/* 登录保持 30 天 */
export const USER_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/* 用户名规则：3-20 位，中文/字母/数字/下划线/连字符 */
const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/;

export function normalizeUsername(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f]/g, '').trim();
  return USERNAME_RE.test(s) ? s : null;
}

/* 密码：6-64 位，不限制字符种类（中文密码也允许） */
export function checkPasswordStrength(raw) {
  const s = String(raw || '');
  if (s.length < 6) return 'too_short';
  if (s.length > 64) return 'too_long';
  return null;
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(message)));
  return toHex(sig);
}

async function sha512Hex(text) {
  const buf = await crypto.subtle.digest('SHA-512', encoder.encode(String(text)));
  return toHex(buf);
}

export function makeSalt() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/* 存库用：hash = SHA-512(salt + ':' + password) */
export async function hashPassword(password, salt) {
  return sha512Hex(salt + ':' + password);
}

/* 定长比较，避免通过耗时差异猜密码 */
export async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  return timingSafeEqual(actual.toLowerCase(), String(expectedHash || '').toLowerCase());
}

/* ---------- 会话 Cookie ---------- */

export async function makeUserCookie(env, userId, ttlSeconds) {
  if (!env || !env.AUTH_TOKEN) {
    throw new Error('[织雾满穗] AUTH_TOKEN 未配置，拒绝签发博客登录 Cookie');
  }
  const ttl = Math.max(0, Math.floor(Number(ttlSeconds) || USER_TTL_SECONDS));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = String(userId) + '.' + exp;
  const sig = await hmacHex(payload, env.AUTH_TOKEN);

  return [
    USER_COOKIE + '=' + encodeURIComponent(payload + '.' + sig),
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=' + ttl
  ].join('; ');
}

export function clearUserCookie() {
  return [
    USER_COOKIE + '=',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0'
  ].join('; ');
}

/* 从请求里解出 userId；签名不对或已过期都返回 null */
async function readUserId(request, env) {
  try {
    if (!env || !env.AUTH_TOKEN) return null;

    const raw = readCookie(request.headers.get('Cookie'), USER_COOKIE);
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 3) return null;

    const [idStr, expStr, sig] = parts;
    if (!/^[0-9]{1,12}$/.test(idStr)) return null;
    if (!/^[0-9]{1,15}$/.test(expStr)) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return null;

    const exp = Number(expStr);
    if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return null;

    const expected = await hmacHex(idStr + '.' + expStr, env.AUTH_TOKEN);
    if (!timingSafeEqual(sig.toLowerCase(), expected.toLowerCase())) return null;

    const id = Number(idStr);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch (e) {
    return null;
  }
}

/* 当前登录用户（未登录或会话无效返回 null）。
   被拉黑的账号也会返回，但带 banned:true —— 交给调用方给出更清楚的提示，
   而不是让用户看到一句没头没尾的「请先登录」。 */
export async function currentUser(request, env) {
  const id = await readUserId(request, env);
  if (!id) return null;

  try {
    /* 头像字段可能还没建（老库没跑迁移）：先探测，缺了就不查它 ——
       前端拿不到自定义头像时会回落到「按用户名算出来的默认 emoji」。 */
    const hasAvatar = await hasAvatarColumn(env);
    const row = await env.DB.prepare(
      'SELECT id, username, banned' + (hasAvatar ? ', avatar' : '') + ' FROM blog_users WHERE id = ?'
    ).bind(id).first();

    if (!row) return null;

    return {
      id: Number(row.id),
      username: String(row.username || ''),
      avatar: hasAvatar ? String(row.avatar || '') : '',
      banned: Number(row.banned) === 1
    };
  } catch (e) {
    /* 表还没建（老库没跑迁移）时当作未登录，而不是 500 */
    return null;
  }
}
