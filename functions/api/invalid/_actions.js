/* ============================================================
   织雾满穗 · 无效上报的两种「结案」动作（内部复用）
   ------------------------------------------------------------
   从 handle.js 抽出来，是因为现在有两条路会用到：
     · 站长在后台点「✅ 确认无效并下架 / ❌ 无效反馈」；
     · 访客提交无效上报后，后台自动审核（functions/api/invalid/_audit.js）。
   两条路必须写同一套表、发同一套通知，绝不能各写一份、慢慢长歪。
   ============================================================ */

/* 已下架记录里的来源标记：后台「已下架」段据此区分是谁下架的 */
export const SOURCE_INVALID = '无效上报';

function changes(result) {
  return (result && result.meta && Number(result.meta.changes)) || 0;
}

/* 确认无效并下架：
     1) 写 quarantine_admin（前台据此隐藏）；
     2) 如果这个 ID 是后台自己加进 songs_extra 的，一并删掉；
     3) 该 ID 的上报全部标成 removed；
     4) 给报过它的人各留一条「已下架」通知。
   返回真正新写进「已下架」的条数（原本已下架的不重复算）。 */
export async function removeIds(env, ids) {
  const idJson = JSON.stringify(ids);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO quarantine_admin (music_id, name, category, source)
       SELECT j.value,
              (SELECT r.name FROM invalid_reports r
                WHERE r.music_id = j.value ORDER BY r.id DESC LIMIT 1),
              (SELECT r.category FROM invalid_reports r
                WHERE r.music_id = j.value ORDER BY r.id DESC LIMIT 1),
              ?
       FROM json_each(?) AS j`
    ).bind(SOURCE_INVALID, idJson),

    env.DB.prepare(
      `DELETE FROM songs_extra WHERE music_id IN (SELECT value FROM json_each(?))`
    ).bind(idJson),

    env.DB.prepare(
      `UPDATE invalid_reports
       SET status = 'removed', updated_at = datetime('now', 'localtime')
       WHERE music_id IN (SELECT value FROM json_each(?))`
    ).bind(idJson),

    env.DB.prepare(
      `INSERT INTO report_notices (reporter, music_id, name, kind)
       SELECT DISTINCT r.reporter, r.music_id, r.name, 'removed'
         FROM invalid_reports r
        WHERE r.music_id IN (SELECT value FROM json_each(?))
          AND r.reporter <> ''
          AND NOT EXISTS (
            SELECT 1 FROM report_notices n
             WHERE n.reporter = r.reporter AND n.music_id = r.music_id AND n.seen = 0
          )`
    ).bind(idJson)
  ]);
  return changes(results[0]);
}

/* 判为「这条反馈不成立」：软删成 noted，歌本身不动。
   typeFilter：'' = 两类一起处理；'invalid' / 'info' = 只处理其中一类。
   返回被标记的行数。 */
export async function dismissIds(env, ids, typeFilter) {
  const idJson = JSON.stringify(ids);
  const filter = typeFilter === 'info' || typeFilter === 'invalid' ? typeFilter : '';
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO report_notices (reporter, music_id, name, kind)
       SELECT DISTINCT r.reporter, r.music_id, r.name, 'deleted'
         FROM invalid_reports r
        WHERE r.music_id IN (SELECT value FROM json_each(?))
          AND r.status = 'pending'
          AND (? = '' OR r.type = ?)
          AND r.reporter <> ''
          AND NOT EXISTS (
            SELECT 1 FROM report_notices n
             WHERE n.reporter = r.reporter AND n.music_id = r.music_id AND n.seen = 0
          )`
    ).bind(idJson, filter, filter),
    env.DB.prepare(
      `UPDATE invalid_reports
          SET status = 'noted', updated_at = datetime('now', 'localtime')
        WHERE status = 'pending'
          AND (? = '' OR type = ?)
          AND music_id IN (SELECT value FROM json_each(?))`
    ).bind(filter, filter, idJson)
  ]);
  return changes(results[1]);
}
