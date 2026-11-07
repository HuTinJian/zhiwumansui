/* ============================================================
   织雾满穗 · 处理赞助登记（后台专用）
   ------------------------------------------------------------
   动作（POST JSON { action, id, amount?, publicMessage? }）：
     confirm  确认入账：核对爱发电订单无误后，
                ① 往 thanks 表插一行「👑 赞助者」（鸣谢页立刻能看到）；
                ② 把 sponsor_regs 这条标 confirmed，记下金额与 thanks_id。
     reject   标记无效：状态改 rejected（订单号对不上 / 没付钱 / 乱填）。
     restore  撤销上一步：rejected 且尚未确认的，退回 pending 重新核对。
     delete   真删这条登记（thanks 表里已确认的那条不会跟着删，
              要删鸣谢名单请去「👑 赞助者」面板，两处互不牵连）。
   为什么确认时不自动写「感谢语」：
     鸣谢页允许空的感谢语；赞助者自己填过的话会带过来（后台弹窗里预填），
     站主可以改、也可以清空，最后存什么就是什么。
   【回退办法】删掉本文件；已确认的登记与鸣谢记录都留在 D1 里，不受影响。
     要撤销某次确认：在后台「👑 赞助者」里删掉那条鸣谢，再在「✅ 赞助登记」
     里对它点「↩️ 退回待核对」。两条链没有任何外键，互不阻塞。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';

/* 与 functions/api/thanks.js 里的赞助者类别保持一字不差（含那颗王冠 emoji） */
const SPONSOR_CATEGORY = '👑 赞助者';

const ACTIONS = ['confirm', 'reject', 'restore', 'delete'];

/* 金额归一：接受 '10' / '¥10' / '10.5' / '1,000'，统一成 '¥10.00'。
   返回空串表示不合法（0、负数、非数字、超过 100 万都算）。 */
function normalizeAmount(raw) {
  const s = String(raw == null ? '' : raw).replace(/[¥￥,，\s元]/g, '');
  if (!s) return '';
  const n = Number(s);
  if (!isFinite(n) || n <= 0 || n > 1000000) return '';
  return '¥' + n.toFixed(2);
}

/* 抹掉尖括号：昵称/感谢语最终会渲染进鸣谢页，绝不能把 HTML 存进去 */
function stripTags(value) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
}

/* D1 语句改了几行（判断「这条还在不在 / 是不是已经处理过」） */
function changes(result) {
  return (result && result.meta && Number(result.meta.changes)) || 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJsonBody(request);
  const action = String(body.action || '');
  const id = Number(body.id);

  if (ACTIONS.indexOf(action) === -1) {
    return json({ ok: false, error: 'bad action' }, 400);
  }
  if (!id || !isFinite(id) || id <= 0) {
    return json({ ok: false, error: 'invalid id' }, 400);
  }

  try {
    if (action === 'confirm') return await confirm(context, id, body);
    if (action === 'reject') return await setStatus(context, id, 'rejected');
    if (action === 'restore') return await setStatus(context, id, 'pending');
    return await remove(context, id);
  } catch (err) {
    console.error('[sponsor handle]', action, err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}

/* ---------- 确认入账 ---------- */
async function confirm(context, id, body) {
  const { env } = context;

  const row = await env.DB.prepare(
    'SELECT id, nickname, tier, message, public_message, amount, status FROM sponsor_regs WHERE id = ?'
  ).bind(id).first();

  if (!row) return json({ ok: false, error: 'not found' }, 404);
  if (row.status === 'confirmed') {
    return json({ ok: false, error: 'already confirmed' }, 409);
  }

  /* 金额优先级：站主在弹窗里填的 > 访客登记时自报的 > 旧数据的固定档位 */
  const amount = normalizeAmount(
    body.amount != null && String(body.amount).trim() !== ''
      ? body.amount
      : (row.amount || (row.tier === 'custom' ? '' : row.tier))
  );
  if (!amount) return json({ ok: false, error: 'bad amount' }, 400);

  const publicMessage = stripTags(
    body.publicMessage != null ? body.publicMessage : row.public_message
  );
  if (publicMessage.length > 200) {
    return json({ ok: false, error: 'message too long' }, 400);
  }

  /* 先写鸣谢名单：失败就直接返回，登记还停在 pending，站主可以再点一次 */
  const ins = await env.DB.prepare(
    `INSERT INTO thanks (category, name, platform, message)
     VALUES (?, ?, ?, ?)`
  ).bind(SPONSOR_CATEGORY, row.nickname, amount, publicMessage || null).run();

  const thanksId = ins && ins.meta && ins.meta.last_row_id
    ? Number(ins.meta.last_row_id)
    : null;

  try {
    const upd = await env.DB.prepare(
      `UPDATE sponsor_regs
       SET status = 'confirmed', amount = ?, thanks_id = ?,
           confirmed_at = datetime('now', 'localtime')
       WHERE id = ? AND status != 'confirmed'`
    ).bind(amount, thanksId, id).run();

    if (!changes(upd)) {
      /* 极端情况：两步之间被别人确认了。把刚插的鸣谢行删掉，避免名单里多一条。 */
      if (thanksId) {
        await env.DB.prepare('DELETE FROM thanks WHERE id = ?').bind(thanksId).run();
      }
      return json({ ok: false, error: 'already confirmed' }, 409);
    }
  } catch (err) {
    /* 更新失败 → 回滚刚插入的鸣谢行（尽力而为；即使删失败，也只是名单多一条，
       不会让登记状态错乱）。 */
    if (thanksId) {
      try { await env.DB.prepare('DELETE FROM thanks WHERE id = ?').bind(thanksId).run(); } catch (e2) {}
    }
    throw err;
  }

  return json({ ok: true, thanksId });
}

/* ---------- 改状态（reject / restore） ---------- */
async function setStatus(context, id, status) {
  const { env } = context;

  const result = await env.DB.prepare(
    `UPDATE sponsor_regs
     SET status = ?, confirmed_at = CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now', 'localtime') END
     WHERE id = ?`
  ).bind(status, status, id).run();

  if (!changes(result)) return json({ ok: false, error: 'not found' }, 404);
  return json({ ok: true });
}

/* ---------- 真删登记 ---------- */
async function remove(context, id) {
  const { env } = context;
  const result = await env.DB.prepare('DELETE FROM sponsor_regs WHERE id = ?').bind(id).run();
  if (!changes(result)) return json({ ok: false, error: 'not found' }, 404);
  return json({ ok: true });
}
