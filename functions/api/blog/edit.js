/* ============================================================
   织雾满穗 · 编辑自己发的内容（需要登录，且必须是作者本人）
   ------------------------------------------------------------
   POST /api/blog/edit
   body: { postId, title, content, kind?, tags?, cover? }

   规则：
   · 只有作者本人能改（管理员有自己的处置手段：隐藏 / 删除 / 拉黑，不改人家的字）。
   · 只允许改主帖；评论不在这个接口范围内。
   · 被拉黑的账号不能改（和发帖一致）。
   · 校验和发帖完全一样：长度、敏感词、封面只收 http(s) 链接。
   · 会把 edited_at 记下来（字段没建就不记，不报错），
     前台据此显示「已编辑」，免得有人改完内容当作没改过。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin, tooLong } from '../_utils.js';
import { DEFAULT_KIND, LIMITS, cleanBody, findBlockedWord, normalizeKind } from './_moderation.js';
import { currentUser } from './_auth.js';
import { hasEditedAtColumn, hasKindColumn } from './_schema.js';

/* 改内容比发内容更该限速：10 分钟最多 20 次 */
const limiter = createRateLimiter(20, 10 * 60 * 1000);

function cleanCover(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length > 300) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function cleanTags(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const list = s.split(/[,，、\s]+/).map(function (t) {
    return t.replace(/[\u0000-\u001f\u007f#]/g, '').trim().slice(0, 12);
  }).filter(Boolean).slice(0, 5);
  return list.length ? list.join(',') : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: false, error: 'too_many_requests', wait: 0 }, 429);
  }

  try {
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, error: 'login_required' }, 401);
    if (user.banned) return json({ ok: false, error: 'banned' }, 403);

    const body = await readJsonBody(request);
    const postId = Number(body.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false }, 400);

    /* 先确认这条内容存在、还是主帖、并且是自己发的 */
    const row = await env.DB.prepare(
      'SELECT id, parent_id, user_id, status FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    if (row.parent_id) return json({ ok: false, error: 'not_editable' }, 400);
    if (Number(row.user_id) !== user.id) return json({ ok: false, error: 'not_mine' }, 403);

    const title = cleanBody(body.title).slice(0, LIMITS.title);
    const rawContent = cleanBody(body.content);
    const cover = cleanCover(body.cover);
    const tags = cleanTags(body.tags);
    const kind = normalizeKind(body.kind) || DEFAULT_KIND;

    if (!title) return json({ ok: false, error: 'empty title' }, 400);
    if (!rawContent) return json({ ok: false, error: 'empty content' }, 400);
    if (tooLong(rawContent, LIMITS.content)) {
      return json({ ok: false, error: 'too_long', max: LIMITS.content }, 400);
    }

    /* 敏感词：和发帖一样整条拒收，并把命中的词回给前端方便自己改 */
    const hit = findBlockedWord(user.username, title, rawContent, tags);
    if (hit) return json({ ok: false, error: 'blocked_word', word: hit }, 400);

    /* kind / edited_at 可能还没建（老库没跑迁移）——先探测再决定写不写 */
    const kindReady = await hasKindColumn(env);
    const editedReady = await hasEditedAtColumn(env);

    const sets = ['title = ?', 'content = ?', 'cover = ?', 'tags = ?'];
    const values = [title, rawContent, cover, tags];
    if (kindReady) { sets.push('kind = ?'); values.push(kind); }
    if (editedReady) { sets.push("edited_at = datetime('now', 'localtime')"); }
    values.push(postId);

    await env.DB.prepare(
      'UPDATE blog_posts SET ' + sets.join(', ') + ' WHERE id = ?'
    ).bind(...values).run();

    return json({ ok: true, id: postId, kind, kindReady, editedReady });
  } catch (err) {
    console.error('[blog/edit]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
