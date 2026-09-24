/* ============================================================
   织雾满穗 · 账号设置（需要登录）
   ------------------------------------------------------------
   POST /api/blog/auth/profile
     body: { action: 'profile',  username, avatar }
     body: { action: 'password', oldPassword, newPassword }

   三件事各自的要点：
   · 改名字 —— 除了改 blog_users，还要把这个人已发内容的 author 名字一起改。
     因为历史原因（每条内容都存了一份 name 快照），不改旧内容的话，
     会出现「自己主页显示新名字，旧帖子下面还是旧名字」的怪状。
   · 改密码 —— 必须验旧密码。新密码仍走「随机盐 + SHA-512」，
     并且【换新盐】再算哈希（复用旧盐等于白改）。
   · 改头像 —— 存一个 emoji 或图片直链（见 _moderation.js 的 cleanAvatar）。
     头像字段是后加的，没跑迁移时会被拒并回 avatarReady:false，页面会给提示。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../../_utils.js';
import {
  normalizeUsername, checkPasswordStrength, makeSalt, hashPassword,
  verifyPassword, currentUser
} from '../_auth.js';
import { cleanAvatar } from '../_moderation.js';
import { hasAvatarColumn } from '../_schema.js';

/* 账号操作不频繁，10 分钟 10 次足够，也顺便挡撞密码 */
const limiter = createRateLimiter(10, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: false, error: 'too_many_requests' }, 429);
  }

  try {
    const me = await currentUser(request, env);
    if (!me) return json({ ok: false, error: 'login_required' }, 401);

    const body = await readJsonBody(request);
    const action = String(body.action || 'profile');

    const row = await env.DB.prepare(
      'SELECT id, username, pass_hash, salt FROM blog_users WHERE id = ?'
    ).bind(me.id).first();

    if (!row) return json({ ok: false, error: 'login_required' }, 401);

    /* ---------------- 改密码 ---------------- */
    if (action === 'password') {
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');

      if (!oldPassword) return json({ ok: false, error: 'need_old_password' }, 400);

      const weak = checkPasswordStrength(newPassword);
      if (weak) return json({ ok: false, error: weak }, 400);

      const okOld = await verifyPassword(oldPassword, row.salt, row.pass_hash);
      if (!okOld) return json({ ok: false, error: 'bad_old_password' }, 403);

      /* 换新盐：同一个密码重算也要得到不同的哈希 */
      const salt = makeSalt();
      const passHash = await hashPassword(newPassword, salt);

      await env.DB.prepare(
        'UPDATE blog_users SET pass_hash = ?, salt = ? WHERE id = ?'
      ).bind(passHash, salt, me.id).run();

      return json({ ok: true, action: 'password' });
    }

    /* ---------------- 改名字 / 头像 ---------------- */
    const username = normalizeUsername(body.username);
    if (!username) return json({ ok: false, error: 'bad_username' }, 400);

    const nameChanged = username !== String(row.username || '');
    if (nameChanged) {
      const exists = await env.DB.prepare(
        'SELECT id FROM blog_users WHERE username = ? AND id <> ?'
      ).bind(username, me.id).first();
      if (exists) return json({ ok: false, error: 'username_taken' }, 409);
    }

    const avatarReady = await hasAvatarColumn(env);
    /* 头像传了空串 = 想恢复默认（用按用户名算出来的 emoji） */
    const wantsAvatarReset = body.avatar !== undefined && String(body.avatar).trim() === '';
    const avatar = cleanAvatar(body.avatar);
    if (body.avatar !== undefined && !wantsAvatarReset && !avatar) {
      return json({ ok: false, error: 'bad_avatar' }, 400);
    }
    if (body.avatar !== undefined && !avatarReady) {
      return json({ ok: false, error: 'avatar_not_ready' }, 400);
    }

    const sets = ['username = ?'];
    const values = [username];
    /* 算一下改完之后头像是什么，好回给前端直接更新界面 */
    let nextAvatar = me.avatar || '';
    if (body.avatar !== undefined && avatarReady) {
      nextAvatar = wantsAvatarReset ? '' : avatar;
      sets.push('avatar = ?');
      values.push(wantsAvatarReset ? null : avatar);
    }
    values.push(me.id);

    await env.DB.prepare(
      'UPDATE blog_users SET ' + sets.join(', ') + ' WHERE id = ?'
    ).bind(...values).run();

    /* 作者名是存在每条内容上的快照，改名要一起搬过去，
       否则旧内容下面还挂着旧名字。 */
    let renamed = 0;
    if (nameChanged) {
      const r = await env.DB.prepare(
        'UPDATE blog_posts SET name = ? WHERE user_id = ?'
      ).bind(username, me.id).run();
      renamed = Number(r.meta && r.meta.changes) || 0;
    }

    return json({
      ok: true,
      action: 'profile',
      user: {
        id: me.id,
        username,
        avatar: nextAvatar,
        banned: me.banned
      },
      renamed,
      avatarReady
    });
  } catch (err) {
    console.error('[blog/auth/profile]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
