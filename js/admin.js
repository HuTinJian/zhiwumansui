/* ============================================================
   织雾满穗 · 后台管理
   ============================================================ */

(async function init() {
  const ok = await requireAuth();
  if (!ok) return;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).classList.add('active');
    });
  });

  loadFeedback();
  loadRobloxStats();
  loadThanks();
  loadUpdates();
})();

/* ============================================================
   反馈管理
   ============================================================ */
async function loadFeedback() {
  const container = document.getElementById('feedbackList');
  const countEl = document.getElementById('feedbackCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/feedback/list', { credentials: 'include' });
    const data = await res.json();

    if (!Array.isArray(data)) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      countEl.textContent = '0';
      return;
    }

    countEl.textContent = data.length;

    if (data.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      return;
    }

    container.innerHTML = '';
    data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="type-tag">${escapeHtml(item.type)}</span>
        </div>
        <div class="meta">
          ${item.email ? '📧 ' + escapeHtml(item.email) + ' · ' : ''}
          🕒 ${escapeHtml(item.created_at)}
          ${item.want_thanks === 1 ? ' · ❤️ 愿意加入鸣谢' : ''}
        </div>
        <div class="message">${escapeHtml(item.message)}</div>
        <div class="actions">
          ${item.want_thanks === 1 ? '<button class="btn-approve" data-id="' + item.id + '">❤️ 加入鸣谢</button>' : ''}
          <button class="btn-delete" data-id="' + item.id + '">🗑️ 删除</button>
        </div>
      `;
      container.appendChild(el);
    });

    container.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', () => approveToThanks(Number(btn.dataset.id)));
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFeedback(Number(btn.dataset.id)));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

async function approveToThanks(feedbackId) {
  const confirmed = await showConfirm(
    '加入鸣谢',
    '确认将该反馈用户加入鸣谢名单？\n\n加入后可在"鸣谢管理"中编辑类别和描述。'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/list', { credentials: 'include' });
    const list = await res.json();
    const item = list.find(i => i.id === feedbackId);
    if (!item) { showToast('未找到反馈'); return; }

    const addRes = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        category: '💬 反馈贡献者',
        name: item.name,
        platform: '',
        message: '反馈了「' + item.type + '」相关问题',
        feedbackId: item.id
      })
    });
    const addData = await addRes.json();

    if (addData.ok) {
      showToast('✅ 已加入鸣谢名单');
      await fetch('/api/feedback/status', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status: 'approved' })
      });
      loadThanks();
    } else {
      showToast('加入失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

async function deleteFeedback(id) {
  const confirmed = await showConfirm('删除反馈', '确定要删除这条反馈吗？此操作不可撤销。');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('🗑️ 已删除');
      loadFeedback();
    } else {
      showToast('删除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   Roblox 数据
   ============================================================ */
async function loadRobloxStats() {
  try {
    const res1 = await fetch('data/roblox_music.json?t=' + Date.now());
    const musicData = await res1.json();
    const uniqueNames = new Set(musicData.map(i => i.name));
    document.getElementById('statTotal').textContent = musicData.length;
    document.getElementById('statGroup').textContent = uniqueNames.size;

    const res2 = await fetch('data/roblox_music_quarantine.json?t=' + Date.now());
    const quarantine = await res2.json();
    document.getElementById('statQuarantine').textContent = quarantine.length;

    const container = document.getElementById('quarantineList');
    const countEl = document.getElementById('quarantineCount');
    countEl.textContent = quarantine.length;

    if (quarantine.length === 0) {
      container.innerHTML = '<div class="empty-state">隔离区是空的</div>';
      return;
    }

    const sorted = [...quarantine].sort((a, b) => {
      const ta = a.quarantinedAt ? new Date(a.quarantinedAt) : new Date(0);
      const tb = b.quarantinedAt ? new Date(b.quarantinedAt) : new Date(0);
      return tb - ta;
    });

    container.innerHTML = '';
    sorted.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="type-tag">${escapeHtml(item.category || '未分类')}</span>
        </div>
        <div class="meta">
          🆔 ${escapeHtml(item.id)}
          ${item.quarantinedAt ? ' · ⛔ ' + escapeHtml(item.quarantinedAt) : ''}
        </div>
      `;
      container.appendChild(el);
    });
  } catch (err) {
    document.getElementById('quarantineList').innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

/* ============================================================
   鸣谢管理
   ============================================================ */
async function loadThanks() {
  const container = document.getElementById('thanksList');
  const countEl = document.getElementById('thanksCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/thanks?t=' + Date.now());
    const data = await res.json();

    if (!Array.isArray(data)) {
      container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
      countEl.textContent = '0';
      return;
    }

    let total = 0;
    data.forEach(cat => { total += (cat.people || []).length; });
    countEl.textContent = total;

    if (total === 0) {
      container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
      return;
    }

    container.innerHTML = '';
    data.forEach(cat => {
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700;color:var(--gold);margin:16px 0 8px;font-size:1rem;';
      title.textContent = cat.category;
      container.appendChild(title);

      (cat.people || []).forEach(person => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
          <div class="row1">
            <span class="name">${escapeHtml(person.name)}</span>
            ${person.platform ? '<span class="type-tag gold">' + escapeHtml(person.platform) + '</span>' : ''}
          </div>
          ${person.message ? '<div class="message">' + escapeHtml(person.message) + '</div>' : ''}
          <div class="actions">
            <button class="btn-delete" data-id="${person.id}">🗑️ 删除</button>
          </div>
        `;
        container.appendChild(el);
      });
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteThanks(Number(btn.dataset.id)));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

async function deleteThanks(id) {
  const confirmed = await showConfirm('删除鸣谢', '确定要从鸣谢名单中删除这个人吗？');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('🗑️ 已删除');
      loadThanks();
    } else {
      showToast('删除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   版本管理
   ============================================================ */
async function loadUpdates() {
  const container = document.getElementById('updatesList');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/updates?all=1&t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.data)) {
      container.innerHTML = '<div class="empty-state">加载失败</div>';
      return;
    }

    container.innerHTML = '';
    data.data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'update-edit-item';
      el.innerHTML = `
        <div class="head">
          <span class="page-name">${escapeHtml(getPageName(item.page_key))}</span>
          <span class="version-tag">${escapeHtml(item.version)}</span>
          <span class="date-info">📅 ${escapeHtml(item.date)}</span>
        </div>
        <div class="field">
          <label>版本号</label>
          <input type="text" class="edit-version" value="${escapeHtml(item.version)}" data-page="${escapeHtml(item.page_key)}" placeholder="例如 v1.0.1">
        </div>
        <div class="field">
          <label>更新内容（每行一条）</label>
          <textarea class="edit-updates" data-page="${escapeHtml(item.page_key)}" placeholder="每行写一条更新内容">${escapeHtml((item.updates || []).join('\n'))}</textarea>
        </div>
        <div class="actions">
          <button class="btn-save" data-page="${escapeHtml(item.page_key)}">💾 保存</button>
        </div>
      `;
      container.appendChild(el);
    });

    container.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', () => saveUpdate(btn.dataset.page));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function getPageName(key) {
  if (key === 'index') return '🏠 主页';
  if (key === 'feedback') return '💬 反馈页';
  if (key === 'roblox') return '🎵 宝库页';
  return key;
}

async function saveUpdate(pageKey) {
  const versionInput = document.querySelector(`.edit-version[data-page="${pageKey}"]`);
  const updatesInput = document.querySelector(`.edit-updates[data-page="${pageKey}"]`);

  const version = versionInput.value.trim();
  const updates = updatesInput.value.split('\n').map(s => s.trim()).filter(s => s);

  if (!version) { showToast('请填写版本号'); return; }
  if (updates.length === 0) { showToast('请至少填写一条更新内容'); return; }

  try {
    const res = await fetch('/api/updates', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pageKey, version, updates })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已保存，日期自动更新为今天');
      loadUpdates();
    } else {
      showToast('保存失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}