/* ============================================================
   织雾满穗 · 后台管理
   ============================================================ */

/* 缓存反馈列表 */
let feedbackCache = [];

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

  /* 导入隔离区弹窗 */
  document.getElementById('openImportQuarantineBtn').onclick = () => {
    document.getElementById('importQuarantineText').value = '';
    document.getElementById('importQuarantineStatus').textContent = '';
    document.getElementById('importQuarantineStatus').className = 'import-status';
    openModal('importQuarantineModal');
  };
  document.getElementById('cancelImportQuarantine').onclick = () => closeModal('importQuarantineModal');
  document.getElementById('confirmImportQuarantine').onclick = handleImportQuarantine;

  /* 添加鸣谢弹窗 */
  const addThanksTrigger = document.getElementById('addThanksSelectTrigger');
  const addThanksDropdown = document.getElementById('addThanksSelectDropdown');

  document.getElementById('openAddThanksBtn').onclick = () => {
    /* 重置下拉 */
    document.getElementById('addThanksSelectedCat').textContent = '请选择类别';
    addThanksTrigger.classList.remove('selected');
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
    addThanksDropdown.classList.remove('open');
    addThanksTrigger.classList.remove('open');
    /* 清空其他字段 */
    document.getElementById('addThanksName').value = '';
    document.getElementById('addThanksPlatform').value = '';
    document.getElementById('addThanksMessage').value = '';
    openModal('addThanksModal');
  };
  document.getElementById('cancelAddThanks').onclick = () => closeModal('addThanksModal');
  document.getElementById('confirmAddThanks').onclick = handleAddThanks;

  /* 添加鸣谢下拉交互 */
  addThanksTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    addThanksTrigger.classList.toggle('open');
    addThanksDropdown.classList.toggle('open');
  });

  addThanksDropdown.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', () => {
      addThanksDropdown.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      document.getElementById('addThanksSelectedCat').textContent = opt.textContent;
      addThanksTrigger.classList.add('selected');
      addThanksTrigger.classList.remove('open');
      addThanksDropdown.classList.remove('open');
    });
  });

  /* 点击弹窗外收起下拉 */
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('addThanksSelectWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      addThanksTrigger.classList.remove('open');
      addThanksDropdown.classList.remove('open');
    }
  });
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

    feedbackCache = data;
    countEl.textContent = data.length;

    if (data.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      return;
    }

    container.innerHTML = '';
    data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';

      const hasQ = item.upload_quarantine === 1 && Array.isArray(item.quarantine_ids) && item.quarantine_ids.length > 0;
      const qCount = hasQ ? item.quarantine_ids.length : 0;

      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          <span>
            <span class="type-tag">${escapeHtml(item.type)}</span>
            ${hasQ ? '<span class="type-tag blue" style="margin-left:6px;">📦 ' + qCount + ' 个隔离区 ID</span>' : ''}
          </span>
        </div>
        <div class="meta">
          ${item.email ? '📧 ' + escapeHtml(item.email) + ' · ' : ''}
          🕒 ${escapeHtml(item.created_at)}
          ${item.want_thanks === 1 ? ' · ❤️ 愿意加入鸣谢' : ''}
        </div>
        <div class="message">${escapeHtml(item.message)}</div>
        <div class="actions">
          ${hasQ ? '<button class="btn-expand" data-id="' + item.id + '">📦 展开隔离区</button>' : ''}
          ${item.want_thanks === 1 ? '<button class="btn-approve" data-id="' + item.id + '">❤️ 加入鸣谢</button>' : ''}
          <button class="btn-delete" data-id="' + item.id + '">🗑️ 删除</button>
        </div>
        ${hasQ ? '<div class="fb-quarantine" id="fbQ-' + item.id + '"></div>' : ''}
      `;
      container.appendChild(el);
    });

    container.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', () => approveToThanks(Number(btn.dataset.id)));
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFeedback(Number(btn.dataset.id)));
    });
    container.querySelectorAll('.btn-expand').forEach(btn => {
      btn.addEventListener('click', () => toggleFeedbackQuarantine(Number(btn.dataset.id), btn));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function toggleFeedbackQuarantine(feedbackId, btn) {
  const panel = document.getElementById('fbQ-' + feedbackId);
  if (!panel) return;

  if (panel.classList.contains('show')) {
    panel.classList.remove('show');
    btn.textContent = '📦 展开隔离区';
    return;
  }

  if (!panel.dataset.rendered) {
    const item = feedbackCache.find(i => i.id === feedbackId);
    if (!item || !Array.isArray(item.quarantine_ids)) return;

    const listHtml = item.quarantine_ids.map((q, i) => `
      <label class="fb-q-item">
        <input type="checkbox" data-index="${i}" data-id="${escapeHtml(q.id)}">
        <span class="q-name">${escapeHtml(q.name || '未知歌名')}</span>
        <span class="q-id">${escapeHtml(q.id)}</span>
        <span class="q-cat">${escapeHtml(q.category || '未分类')}</span>
      </label>
    `).join('');

    panel.innerHTML = `
      <div class="q-head">
        <span class="q-info">共 <strong>${item.quarantine_ids.length}</strong> 个 ID，勾选后点击导入</span>
        <div class="q-actions">
          <button class="btn-sel-all">全选</button>
          <button class="btn-sel-none">取消</button>
          <button class="btn-import-sel" data-id="${feedbackId}">✅ 导入选中</button>
        </div>
      </div>
      <div class="q-list">${listHtml}</div>
    `;

    panel.querySelector('.btn-sel-all').onclick = () => {
      panel.querySelectorAll('.fb-q-item input').forEach(cb => cb.checked = true);
    };
    panel.querySelector('.btn-sel-none').onclick = () => {
      panel.querySelectorAll('.fb-q-item input').forEach(cb => cb.checked = false);
    };
    panel.querySelector('.btn-import-sel').onclick = () => {
      const ids = Array.from(panel.querySelectorAll('.fb-q-item input:checked'))
        .map(cb => cb.dataset.id);
      importSelectedQuarantine(feedbackId, ids);
    };

    panel.dataset.rendered = '1';
  }

  panel.classList.add('show');
  btn.textContent = '📦 收起隔离区';
}

async function importSelectedQuarantine(feedbackId, ids) {
  if (ids.length === 0) {
    showToast('请至少勾选一个ID');
    return;
  }

  const confirmed = await showConfirm(
    '导入隔离区',
    `确定将选中的 ${ids.length} 个 ID 导入到开发者隔离区吗？\n\n导入后宝库页将不再显示这些 ID。`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/import-quarantine', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId, ids })
    });
    const data = await res.json();

    if (data.ok) {
      showToast(`✅ 已导入 ${data.added} 个，跳过 ${data.skipped} 个`);
      loadRobloxStats();
      loadFeedback();
    } else {
      showToast('导入失败：' + (data.error || '未知错误'));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

async function approveToThanks(feedbackId) {
  const confirmed = await showConfirm(
    '加入鸣谢',
    '确认将该反馈用户加入鸣谢名单？\n\n加入后可在"鸣谢管理"中编辑类别和描述。'
  );
  if (!confirmed) return;

  try {
    const item = feedbackCache.find(i => i.id === feedbackId);
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

    const res2 = await fetch('/api/quarantine/list?t=' + Date.now());
    const qData = await res2.json();

    let quarantine = [];
    if (qData.ok && Array.isArray(qData.data)) {
      quarantine = qData.data;
    }

    document.getElementById('statQuarantine').textContent = quarantine.length;

    const container = document.getElementById('quarantineList');
    const countEl = document.getElementById('quarantineCount');
    countEl.textContent = quarantine.length;

    if (quarantine.length === 0) {
      container.innerHTML = '<div class="empty-state">隔离区是空的</div>';
      return;
    }

    container.innerHTML = '';
    quarantine.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name || '未知歌名')}</span>
          <span class="type-tag">${escapeHtml(item.category || '未分类')}</span>
        </div>
        <div class="meta">
          🆔 ${escapeHtml(item.id)}
          ${item.source ? ' · 📌 ' + escapeHtml(item.source) : ''}
          ${item.quarantinedAt ? ' · 🕒 ' + escapeHtml(item.quarantinedAt) : ''}
        </div>
        <div class="actions">
          <button class="btn-delete" data-id="${escapeHtml(item.id)}">🗑️ 移除</button>
        </div>
      `;
      container.appendChild(el);
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteQuarantineItem(btn.dataset.id));
    });
  } catch (err) {
    document.getElementById('quarantineList').innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

async function deleteQuarantineItem(musicId) {
  const confirmed = await showConfirm(
    '移除隔离',
    `确定将 ID ${musicId} 从开发者隔离区移除吗？\n\n移除后宝库页会重新显示该 ID。`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/quarantine/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: musicId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已移除');
      loadRobloxStats();
    } else {
      showToast('移除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

async function handleImportQuarantine() {
  const text = document.getElementById('importQuarantineText').value.trim();
  const status = document.getElementById('importQuarantineStatus');
  status.className = 'import-status';
  status.textContent = '';

  if (!text) {
    status.classList.add('err');
    status.textContent = '⚠️ 请粘贴 JSON 数据';
    return;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch (e) {
    status.classList.add('err');
    status.textContent = '⚠️ JSON 格式错误：' + e.message;
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    status.classList.add('err');
    status.textContent = '⚠️ 请提供一个非空数组';
    return;
  }

  const valid = [];
  for (const it of items) {
    if (!it || !it.id) continue;
    valid.push({
      id: String(it.id).trim(),
      name: String(it.name || '').trim().slice(0, 100),
      category: String(it.category || '').trim().slice(0, 30)
    });
  }

  if (valid.length === 0) {
    status.classList.add('err');
    status.textContent = '⚠️ 没有有效的记录（每条必须包含 id）';
    return;
  }

  status.textContent = `正在导入 ${valid.length} 条...`;

  try {
    const res = await fetch('/api/quarantine/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid, source: '手动导入' })
    });
    const data = await res.json();

    if (data.ok) {
      status.classList.add('ok');
      status.textContent = `✅ 导入完成：新增 ${data.added} 条，跳过 ${data.skipped} 条（已存在）`;
      loadRobloxStats();
      setTimeout(() => closeModal('importQuarantineModal'), 2000);
    } else {
      status.classList.add('err');
      status.textContent = '❌ 导入失败：' + (data.error || '未知错误');
    }
  } catch (err) {
    status.classList.add('err');
    status.textContent = '❌ 网络异常';
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

async function handleAddThanks() {
  const selectedCatEl = document.getElementById('addThanksSelectedCat');
  const category = (selectedCatEl.textContent || '').trim();
  const name = document.getElementById('addThanksName').value.trim();
  const platform = document.getElementById('addThanksPlatform').value.trim();
  const message = document.getElementById('addThanksMessage').value.trim();

  if (!category || category === '请选择类别') { showToast('请选择类别'); return; }
  if (!name) { showToast('请填写名字'); return; }

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        category,
        name,
        platform,
        message
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已添加');
      closeModal('addThanksModal');
      loadThanks();
    } else {
      showToast('添加失败：' + (data.error || '未知错误'));
    }
  } catch (err) {
    showToast('网络异常');
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
  if (key === 'roblox') return '🎵 卡片1';
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