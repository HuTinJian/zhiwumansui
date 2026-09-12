/* ============================================================
   织雾满穗 · 后台管理
   反馈管理、版本管理、卡片管理（歌曲/隔离区/鸣谢）
   ============================================================ */

/* 缓存反馈列表，用于展开查看隔离区时定位 */
let feedbackCache = [];

/* ========== 初始化 ========== */
(async function init() {
  const ok = await requireAuth();
  if (!ok) return;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
  });

  /* 一级标签切换（通用写法：用 data-panel 找 #panel-xxx） */
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
  loadSongs();
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

  /* 歌曲管理按钮 */
  document.getElementById('addSongBtn').onclick = handleAddSong;
  document.getElementById('exportSongsBtn').onclick = handleExportSongs;
  document.getElementById('clearSongsBtn').onclick = handleClearSongs;

  /* 添加鸣谢弹窗 */
  const addThanksTrigger = document.getElementById('addThanksSelectTrigger');
  const addThanksDropdown = document.getElementById('addThanksSelectDropdown');

  document.getElementById('openAddThanksBtn').onclick = () => {
    document.getElementById('addThanksSelectedCat').textContent = '请选择类别';
    addThanksTrigger.classList.remove('selected');
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
    addThanksDropdown.classList.remove('open');
    addThanksTrigger.classList.remove('open');
    document.getElementById('addThanksName').value = '';
    document.getElementById('addThanksPlatform').value = '';
    document.getElementById('addThanksMessage').value = '';
    openModal('addThanksModal');
  };
  document.getElementById('cancelAddThanks').onclick = () => closeModal('addThanksModal');
  document.getElementById('confirmAddThanks').onclick = handleAddThanks;

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

  /* 点空白处收起下拉 */
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('addThanksSelectWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      addThanksTrigger.classList.remove('open');
      addThanksDropdown.classList.remove('open');
    }
  });
})();

/* ============================================================
   重置风险弹窗
   ============================================================ */
async function handleResetRisk() {
  const confirmed = await showConfirm(
    '重置风险弹窗',
    '确定重置吗？\n\n所有用户下次点"试听"时会重新看到完整的风险告知弹窗。'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/risk', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已重置，所有用户下次试听时将重新看到风险告知');
    } else {
      showToast('重置失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

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

    /* 接口直接返回数组 */
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
      const itemId = Number(item.id) || 0;

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
          ${hasQ ? '<button class="btn-expand" data-id="' + itemId + '">📦 展开隔离区</button>' : ''}
          ${item.want_thanks === 1 ? '<button class="btn-approve" data-id="' + itemId + '">❤️ 加入鸣谢</button>' : ''}
          <button class="btn-delete" data-id="${itemId}">🗑️ 删除</button>
        </div>
        ${hasQ ? '<div class="fb-quarantine" id="fbQ-' + itemId + '"></div>' : ''}
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

/* 展开/收起某条反馈的隔离区 */
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

/* 从反馈导入选中的隔离区 ID */
async function importSelectedQuarantine(feedbackId, ids) {
  if (ids.length === 0) {
    showToast('请至少勾选一个 ID');
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

/* 将反馈用户加入鸣谢 */
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

/* 删除反馈 */
async function deleteFeedback(id) {
  if (!id || isNaN(Number(id))) {
    showToast('⚠️ 反馈 ID 无效，无法删除');
    return;
  }

  const confirmed = await showConfirm('删除反馈', '确定要删除这条反馈吗？此操作不可撤销。');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(id) })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`🗑️ 已删除（共 ${data.deleted || 1} 条）`);
      loadFeedback();
    } else {
      showToast('删除失败：' + (data.message || data.error || '未知'));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   Roblox 数据（统计 + 开发者隔离区）
   ============================================================ */
async function loadRobloxStats() {
  try {
    /* 主数据（JSON） */
    const res1 = await fetch('data/roblox_music.json?t=' + Date.now());
    const musicData = await res1.json();

    /* D1 新歌 */
    let extraCount = 0;
    try {
      const extraRes = await fetch('/api/songs/list?t=' + Date.now());
      const extraData = await extraRes.json();
      if (extraData.ok && Array.isArray(extraData.data)) {
        extraCount = extraData.data.length;
      }
    } catch (e) {}

    const total = musicData.length + extraCount;
    const uniqueNames = new Set(musicData.map(i => i.name));
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statGroup').textContent = uniqueNames.size;

    /* 隔离区 */
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

/* 从隔离区移除单个 ID */
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

/* 批量导入隔离区（JSON 数组格式） */
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
   歌曲管理（D1）
   ============================================================ */
async function loadSongs() {
  const container = document.getElementById('songList');
  const countEl = document.getElementById('songCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/songs/list?t=' + Date.now());
    const data = await res.json();

    let list = [];
    if (data.ok && Array.isArray(data.data)) {
      list = data.data;
    }
    countEl.textContent = list.length;

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">D1 里还没有歌曲</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="type-tag">${escapeHtml(item.category)}</span>
        </div>
        <div class="meta">
          🆔 ${escapeHtml(item.id)}
          · 📌 lineIndex: ${escapeHtml(String(item.lineIndex || 0))}
        </div>
        <div class="actions">
          <button class="btn-delete" data-id="${escapeHtml(item.id)}">🗑️ 删除</button>
        </div>
      `;
      container.appendChild(el);
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteSong(btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

/* 单曲添加 */
async function handleAddSong() {
  const idInput = document.getElementById('addSongId');
  const nameInput = document.getElementById('addSongName');
  const catInput = document.getElementById('addSongCat');

  const musicId = idInput.value.trim();
  const name = nameInput.value.trim();
  const category = catInput.value.trim() || '未分类';

  if (!musicId) { showToast('请填写歌曲 ID'); return; }
  if (!name) { showToast('请填写歌曲名称'); return; }
  if (!/^\d+$/.test(musicId)) { showToast('ID 必须是纯数字'); return; }

  const data = await addSongToServer({ musicId, name, category });

  if (data && data.ok) {
    showToast('✅ 已添加');
    idInput.value = '';
    nameInput.value = '';
    catInput.value = '';
    loadSongs();
    loadRobloxStats();
  } else {
    showToast('添加失败：' + ((data && (data.message || data.error)) || '未知'));
  }
}

/* 调后端 /api/songs/add（单曲、批量导入都用它） */
async function addSongToServer({ musicId, name, category }) {
  try {
    const res = await fetch('/api/songs/add', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicId, name, category })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'network' };
  }
}

/* 删除单曲 */
async function deleteSong(musicId) {
  const confirmed = await showConfirm(
    '删除歌曲',
    `确定从 D1 删除 ID ${musicId} 吗？\n\n（不会影响 roblox_music.json 里的数据）`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/songs/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: musicId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('🗑️ 已删除');
      loadSongs();
      loadRobloxStats();
    } else {
      showToast('删除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 清空 D1 歌曲 */
async function handleClearSongs() {
  const confirmed = await showConfirm(
    '清空歌曲',
    '确定清空 D1 里的所有歌曲吗？\n\n（不会影响 roblox_music.json 里的数据）\n\n建议先导出，再清空。'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/songs/clear', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`🧹 已清空 ${data.deleted || 0} 条`);
      loadSongs();
      loadRobloxStats();
    } else {
      showToast('清空失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 导出 D1 歌曲 */
async function handleExportSongs() {
  try {
    const res = await fetch('/api/songs/export', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.data)) {
      showToast('导出失败');
      return;
    }
    if (data.data.length === 0) {
      showToast('D1 里没有歌曲可导出');
      return;
    }

    const confirmed = await showConfirm(
      '导出歌曲',
      `即将导出 ${data.data.length} 条歌曲。\n\n导出后，用 merge.html 工具合并到 roblox_music.json 中。\n\n是否下载？`
    );
    if (!confirmed) return;

    const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songs_extra_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast('📤 已下载');
  } catch (err) {
    showToast('网络异常');
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

    /* 接口直接返回数组（已按类别分组） */
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

/* 添加鸣谢 */
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

/* 删除鸣谢 */
async function deleteThanks(id) {
  if (!id || isNaN(Number(id))) {
    showToast('⚠️ ID 无效，无法删除');
    return;
  }

  const confirmed = await showConfirm('删除鸣谢', '确定要从鸣谢名单中删除这个人吗？');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: Number(id) })
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
   版本管理（按 page_key 分发到三个容器）
   ============================================================ */
async function loadUpdates() {
  const containerMap = {
    index:    document.getElementById('updatesListIndex'),
    feedback: document.getElementById('updatesListFeedback'),
    roblox:   document.getElementById('updatesListCard1')
  };

  Object.values(containerMap).forEach(el => {
    if (el) el.innerHTML = '<div class="loading">加载中...</div>';
  });

  try {
    const res = await fetch('/api/updates?all=1&t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.data)) {
      Object.values(containerMap).forEach(el => {
        if (el) el.innerHTML = '<div class="empty-state">加载失败</div>';
      });
      return;
    }

    Object.values(containerMap).forEach(el => { if (el) el.innerHTML = ''; });

    const rendered = { index: 0, feedback: 0, roblox: 0 };

    data.data.forEach(item => {
      const container = containerMap[item.page_key];
      if (!container) return;

      const el = document.createElement('div');
      el.className = 'update-edit-item';

      const isRoblox = item.page_key === 'roblox';

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
          ${isRoblox ? '<button class="btn-reset-risk">🔄 重置风险弹窗</button>' : ''}
          <button class="btn-save" data-page="${escapeHtml(item.page_key)}">💾 保存</button>
        </div>
      `;
      container.appendChild(el);
      rendered[item.page_key]++;
    });

    Object.entries(containerMap).forEach(([key, el]) => {
      if (el && rendered[key] === 0) {
        el.innerHTML = '<div class="empty-state">暂无版本信息</div>';
      }
    });

    document.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', () => saveUpdate(btn.dataset.page));
    });

    document.querySelectorAll('.btn-reset-risk').forEach(btn => {
      btn.addEventListener('click', handleResetRisk);
    });
  } catch (err) {
    Object.values(containerMap).forEach(el => {
      if (el) el.innerHTML = '<div class="empty-state">加载失败</div>';
    });
  }
}

/* 页面 key → 显示名 */
function getPageName(key) {
  if (key === 'index') return '🏠 主页';
  if (key === 'feedback') return '💬 反馈页';
  if (key === 'roblox') return '🎵 卡片1';
  return key;
}

/* 保存某个页面的版本信息 */
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

/* ============================================================
   全局暴露（供 admin.html 内联脚本批量导入使用）
   ============================================================ */
window.loadSongs = loadSongs;
window.loadRobloxStats = loadRobloxStats;
window.addSongToServer = addSongToServer;