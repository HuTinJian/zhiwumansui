/* ============================================================
   织雾满穗 · 数据库结构探测（共享逻辑，不是路由）
   ------------------------------------------------------------
   文件名以 _ 开头 → Cloudflare Pages 不会把它当成接口。

   【为什么需要这个文件】
   给 blog_posts 加新字段时，老库必须人工跑一次迁移。
   一旦漏跑，用到该字段的接口就会整个 500 —— 这个坑已经踩过两次
   （第一次是 blog_users 表缺失，导致注册一律 500）。

   所以从这里开始，新字段一律「先探测、再使用」：
     · 字段在   → 正常读写，功能完整
     · 字段不在 → 自动降级（少一块功能，但页面不崩），
                  并由接口回一个 schemaOutdated 标记，
                  页面据此提示一句"跑一次迁移就能用上新功能"。

   探测结果缓存 5 分钟：PRAGMA 本身很便宜，但也用不着每次请求都问。
   用户跑完迁移后，最多 5 分钟自动恢复完整功能，不用重启任何东西。
   ============================================================ */

const TTL_MS = 5 * 60 * 1000;

/* 每个被探测的字段各自缓存一份，key 是 `表名.字段名` */
const cache = new Map();

/**
 * blog_posts.kind（板块）字段是否存在。
 * 不存在时调用方应降级：读的时候当默认板块，写的时候不写这个字段。
 */
export async function hasKindColumn(env) {
  return columnExists(env, 'blog_posts', 'kind');
}

async function columnExists(env, table, column) {
  const key = table + '.' + column;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  let value = false;
  try {
    /* 表名不能参数化，所以这里白名单校验一下再拼 */
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('bad table name');
    const res = await env.DB.prepare('PRAGMA table_info(' + table + ')').all();
    const cols = (res && res.results) || [];
    value = cols.some(function (c) { return String(c.name) === column; });
  } catch (e) {
    /* 表都不存在时也算"没有" —— 交给调用方降级 */
    value = false;
  }

  cache.set(key, { at: now, value: value });
  return value;
}
