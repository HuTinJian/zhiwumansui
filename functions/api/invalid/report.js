/* ============================================================
   织雾满穗 · 上报无效音乐 ID（公开，支持单个或批量）
   2026-10-05：新增。替代旧「访客隔离区 + 反馈上传」那条链路 ——
   访客只负责说「这个 ID 无效」，下不下架由管理员在后台定。
   ============================================================ */

import {
  json,
  checkTurnstile,
  clientIp,
  createRateLimiter,
  readJsonBody,
  requireSameOrigin,
  turnstileRejection
} from '../_utils.js';

/* 音乐 ID 形态：1~32 位字母 / 数字 / 下划线 / 连字符 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/* 浏览器匿名身份（前端 getClientId()）：小写字母数字 8~64 位 */
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

/* 一次最多 200 条，和前端的批量上限对齐 */
const MAX_ITEMS = 200;

/* 2026-10-07：上报类型 —— invalid = 🚫 无效ID（默认）；info = ✏️ 信息出错（歌名/分类不对） */
const REPORT_TYPES = ['invalid', 'info'];

/* 同一浏览器身份（拿不到身份时退化为单 IP）10 分钟最多 60 次上报，防刷 */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  /* 限速 key 优先用浏览器身份、缺失时退化为 IP，所以必须先读 body。
     readJsonBody 不会抛：非法 JSON 一律当空对象，交给下面的校验兜。 */
  const body = await readJsonBody(request);

  const reporter = String(body.reporter || '').trim().toLowerCase();
  /* 身份不合法不报错、只存空串（规格 3.1）—— 但去重键会退化成「全站同一条」，
     所以前端尽量带上 getClientId() */
  const validReporter = REPORTER_PATTERN.test(reporter) ? reporter : '';

  const limit = limiter.check(validReporter || clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 人机验证：配了 TURNSTILE_SECRET 才生效；strict 模式下没带有效 token 直接 403 */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  try {
    /* 两种写法都收：单条 { id, name, category, type, note } / 批量 { items: [...] }
       2026-10-07 站主要求：上报分两类 ——
         · type='invalid'（🚫 无效ID，默认）：这个 ID 放不出声 / 已经失效；
         · type='info'（✏️ 信息出错）：歌名或分类不对，玩家在弹窗里改了信息再点「确定上报」。
       两类都存在同一张表用 type 区分（页面上「问题上报」分两个标签显示）。 */
    const raw = Array.isArray(body.items) ? body.items : [body];
    if (raw.length > MAX_ITEMS) {
      return json({ ok: false, error: 'too many items' }, 400);
    }

    const stmts = [];
    const refreshes = [];
    /* 2026-10-07 站主定的规矩：「以无效为主，如果他点了无效，就不能修改信息」——
       已经报过无效的 ID，这次如果是 type='info'，**整条跳过**（不改、不新增），
       并计入 blocked 返回给前端，让页面提示「先撤回无效上报」。 */
    let blocked = 0;
    let existingTypes = Object.create(null);
    try {
      const idList = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
        if (ID_PATTERN.test(id) && !idList.includes(id)) idList.push(id);
      }
      if (idList.length > 0) {
        const rows = await env.DB.prepare(
          `SELECT music_id, type FROM invalid_reports
            WHERE reporter = ? AND status = 'pending'
              AND music_id IN (SELECT value FROM json_each(?))`
        ).bind(validReporter, JSON.stringify(idList)).all();
        for (const r of (rows.results || [])) {
          /* 同一 ID 可能有多条（不同状态/不同人），只要有一条是 invalid 就算已报无效 */
          if (String(r.type || 'invalid') === 'invalid') existingTypes[String(r.music_id)] = true;
        }
      }
    } catch (err) {
      /* 迁移还没跑（没有 type 列）时这里会报错 —— 当作「查不到已报无效」处理，
         上报照旧进后台（下面还有旧写法兜底）。 */
      existingTypes = Object.create(null);
    }

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;

      const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
      /* 非法 ID 直接丢，不打断整批（批量里混进坏数据是常事） */
      if (!ID_PATTERN.test(id)) continue;

      const name = String(item.name || '').trim().slice(0, 100);
      const category = String(item.category || '').trim().slice(0, 30);
      const type = REPORT_TYPES.includes(String(item.type || '').trim()) ? String(item.type).trim() : 'invalid';
      const note = String(item.note || '').trim().slice(0, 300);

      if (type === 'info' && existingTypes[id]) { blocked++; continue; }

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO invalid_reports (music_id, name, category, reporter, type, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, name || null, category || null, validReporter, type, note || null)
      );
      refreshes.push(
        env.DB.prepare(
          `UPDATE invalid_reports
              SET type = ?, name = ?, category = ?, note = ?,
                  status = 'pending', updated_at = datetime('now', 'localtime')
            WHERE music_id = ? AND reporter = ? AND status = 'pending'`
        ).bind(type, name || null, category || null, note || null, id, validReporter)
      );
    }

    if (stmts.length === 0) {
      /* 全被「已报无效」挡住了：不算错，如实告诉前端 blocked 有几条 */
      if (blocked > 0) return json({ ok: true, added: 0, duplicates: 0, blocked });
      return json({ ok: false, error: 'missing id' }, 400);
    }

    /* 唯一键 (music_id, reporter) 负责去重：INSERT OR IGNORE 命中的行 changes=0 */
    let added = 0;
    let duplicates = 0;
    let results;
    /* refreshLegacy：迁移没跑、退回旧写法时为 true（旧表没有 type/note 列，别去刷） */
    let refreshLegacy = false;
    try {
      results = await env.DB.batch(stmts);
    } catch (err) {
      /* 2026-10-07 加的 type / note 两列要靠 migrations.sql 第 3 组补上。
         万一是「代码先上线、SQL 还没跑」，这里的 INSERT 会报 no such column ——
         不能让玩家看到「上报失败」：**退回旧的 4 列写法**，上报照旧进后台（只是少了类型与说明），
         站主跑完 SQL 就自动走上面那条路。 */
      const legacy = raw
        .filter(item => item && typeof item === 'object')
        .map(item => String(item.id === undefined || item.id === null ? '' : item.id).trim())
        .filter(id => ID_PATTERN.test(id));
      if (legacy.length === 0) throw err;
      const legacyStmts = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
        if (!ID_PATTERN.test(id)) continue;
        legacyStmts.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO invalid_reports (music_id, name, category, reporter)
             VALUES (?, ?, ?, ?)`
          ).bind(
            id,
            String(item.name || '').trim().slice(0, 100) || null,
            String(item.category || '').trim().slice(0, 30) || null,
            validReporter
          )
        );
      }
      console.warn('[invalid/report] type/note 列还不存在（迁移没跑？），已退回旧写法：', err && err.message);
      results = await env.DB.batch(legacyStmts);
      refreshLegacy = true;
    }
    const refreshStmts = [];
    results.forEach((r, i) => {
      if (r && r.meta && r.meta.changes > 0) added++;
      else {
        /* 之前已经报过（同一个人同一个 ID）：按这次的内容刷新那条记录 ——
           这样「先报无效、后改成信息出错」也能生效，界面不会两边都留着。 */
        duplicates++;
        if (!refreshLegacy) refreshStmts.push(refreshes[i]);
      }
    });
    if (refreshStmts.length > 0) await env.DB.batch(refreshStmts);

    return json({ ok: true, added, duplicates, blocked });
  } catch (err) {
    console.error('[invalid/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
