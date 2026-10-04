/* ============================================================
   织雾满穗 · D1 歌曲列表（公开）
   ============================================================ */

import { json } from '../_utils.js';

/* 2026-10-05：**故意不加缓存头**（保持 _utils.json() 默认的 no-store）。
   和 quarantine/list.js 同一个理由：后台「➕ 添加歌曲 / 🗑️ 删除」之后，
   站主刷新宝库页就该立刻看到变化 —— 缓存 60 秒会变成「刚加的歌不见了」的假 bug。
   这两个接口的耗时（实测 600ms 上下）用 loadData 里那句 1.5 秒超时兜底：
   慢就先画主数据，回来了再补一次重绘，不挡首屏。 */

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT music_id, name, category, line_index
       FROM songs_extra
       ORDER BY line_index ASC, id ASC`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      name: r.name,
      category: r.category || '未分类',
      lineIndex: r.line_index || 0
    }));

    return json({ ok: true, data: list });
  } catch (err) {
    console.error('[songs/list]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}