/* ============================================================
   织雾满穗 · 玩家歌曲投稿的后台管理（需认证 + 同源）
   2026-10-07 新增。给后台「🎶 D1歌曲管理」的「📥 玩家投稿」那一块用：
     GET  ?status=pending      → 列出待审核的投稿（按音乐 ID 聚合，带投稿条数/时间/投稿人）
     POST { action:'approve', ids:[...] } → 通过：插进 songs_extra（宝库立刻能搜到）并删掉投稿行
     POST { action:'delete',  ids:[...] } → 不要：只删投稿行（songs_extra 不动）
   ------------------------------------------------------------
   为什么通过时要删投稿行：投稿表只放「待审核」，一旦进了 songs_extra 就算落地了，
   再留着会和真正的歌曲列表重复；要撤就回 D1歌曲管理里删那首歌（那边本来就能删）。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';
import { toUtcIso } from '../_time.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_IDS = 200;

const ACTIONS = ['approve', 'delete'];

function changes(result) {
  return (result && result.meta && Number(result.meta.changes)) || 0;
}

function pickIds(body) {
  const raw = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
  const ids = [];
  for (const v of raw) {
    const id = String(v === undefined || v === null ? '' : v).trim();
    if (ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT music_id,
              COUNT(*) AS submit_count,
              MAX(created_at) AS last_at,
              (SELECT s2.name FROM song_submissions s2
                WHERE s2.music_id = s1.music_id ORDER BY s2.id DESC LIMIT 1) AS latest_name,
              (SELECT s2.category FROM song_submissions s2
                WHERE s2.music_id = s1.music_id ORDER BY s2.id DESC LIMIT 1) AS latest_category
         FROM song_submissions s1
        WHERE status = 'pending'
        GROUP BY music_id
        ORDER BY last_at DESC, music_id
        LIMIT 500`
    ).all();

    const data = (result.results || []).map(row => ({
      musicId: String(row.music_id),
      name: row.latest_name || '',
      category: row.latest_category || '',
      count: Number(row.submit_count) || 0,
      lastAt: toUtcIso(row.last_at)
    }));

    return json({ ok: true, data, summary: { pendingSongs: data.length } });
  } catch (err) {
    console.error('[songs/submissions]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }
  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await readJsonBody(request);
    const action = String(body.action || '').trim();
    if (!ACTIONS.includes(action)) {
      return json({ ok: false, error: 'unknown action' }, 400);
    }

    const ids = pickIds(body);
    if (ids.length === 0) return json({ ok: false, error: 'missing ids' }, 400);
    if (ids.length > MAX_IDS) return json({ ok: false, error: 'too many ids' }, 400);

    const idJson = JSON.stringify(ids);
    let changed = 0;

    if (action === 'approve') {
      /* 通过 = ① 把这条投稿插进 songs_extra（宝库立刻能搜到）② 删掉投稿行。
         为什么在 JS 里逐条拼 INSERT 而不是一条 SQL 搞定：
         line_index 要给这一批的每个 ID 分一个不重复的值，用子查询在一句里算很容易写错；
         这里先读一次 MAX(line_index)，再按顺序 +1 分配，逻辑一眼能看懂。
         （跟 songs/add.js 一样带 ON CONFLICT：这个 ID 已经在 D1 歌曲里就只更新歌名/分类。） */
      const rows = await env.DB.prepare(
        `SELECT s1.music_id AS music_id,
                (SELECT s2.name FROM song_submissions s2
                  WHERE s2.music_id = s1.music_id ORDER BY s2.id DESC LIMIT 1) AS name,
                (SELECT s2.category FROM song_submissions s2
                  WHERE s2.music_id = s1.music_id ORDER BY s2.id DESC LIMIT 1) AS category
           FROM song_submissions s1
          WHERE s1.music_id IN (SELECT value FROM json_each(?))
          GROUP BY s1.music_id`
      ).bind(idJson).all();

      const maxRow = await env.DB.prepare(
        `SELECT COALESCE(MAX(line_index), 99999) AS max_line FROM songs_extra`
      ).first();
      let next = Number(maxRow && maxRow.max_line) || 99999;

      const inserts = ((rows && rows.results) || []).map(r => {
        next += 1;
        return env.DB.prepare(
          `INSERT INTO songs_extra (music_id, name, category, line_index)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(music_id) DO UPDATE SET
             name = excluded.name,
             category = excluded.category`
        ).bind(String(r.music_id), r.name || '', r.category || '未分类', next);
      });

      await env.DB.batch([
        ...inserts,
        env.DB.prepare(
          `DELETE FROM song_submissions WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson)
      ]);
      changed = inserts.length;
    } else {
      const results = await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM song_submissions WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson)
      ]);
      changed = changes(results[0]);
    }

    return json({ ok: true, action, changed });
  } catch (err) {
    console.error('[songs/submissions]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
