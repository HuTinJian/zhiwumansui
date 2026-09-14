/* ============================================================
   织雾满穗 · 共享工具
   所有页面共用：Toast、弹窗、复制、防抖、版本检查
   ============================================================ */

/* 显示 Toast 短提示 */
function showToast(msg, duration = 2500) {
  let el = document.getElementById('globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

/* 打开弹窗（同时锁住页面滚动） */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('show');
  modal.classList.remove('closing');
  document.body.classList.add('modal-open');
}

/* 关闭弹窗（带退出动画） */
function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('show', 'closing');
    /* 如果还有其他弹窗，保持滚动锁定 */
    if (!document.querySelector('.modal.show')) {
      document.body.classList.remove('modal-open');
    }
  }, 220);
}

/* 复制文本到剪贴板 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

/* 防抖函数 */
function debounce(fn, wait = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* 转义 HTML，防止 XSS */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

/* 显示顶部提示条（3 秒自动消失） */
function showNotice(msg) {
  let el = document.getElementById('globalNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalNotice';
    el.className = 'notice-bar';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* 确认弹窗（返回 Promise） */
function showConfirm(title, message) {
  return new Promise(resolve => {
    let modal = document.getElementById('globalConfirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'globalConfirm';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h2 id="gcTitle"></h2>
          <p id="gcMessage"></p>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="gcCancel">取消</button>
            <button class="btn btn-primary" id="gcOk">确认</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    document.getElementById('gcTitle').textContent = title;
    document.getElementById('gcMessage').textContent = message;
    openModal('globalConfirm');

    const ok = () => { closeModal('globalConfirm'); resolve(true); };
    const cancel = () => { closeModal('globalConfirm'); resolve(false); };
    document.getElementById('gcOk').onclick = ok;
    document.getElementById('gcCancel').onclick = cancel;
  });
}

/* ============================================================
   检查页面版本更新（图片弹窗版）
   ============================================================ */
async function checkPageUpdate(pageKey, options = {}) {
  const storageKey = `pageVersion_${pageKey}`;

  let version, date, updates;

  try {
    const res = await fetch(`/api/updates?page=${pageKey}&t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.data) return;
    version = data.data.version;
    date = data.data.date;
    updates = data.data.updates;
  } catch (e) {
    return;
  }

  const stored = localStorage.getItem(storageKey);
  if (stored === version) return;

  if (typeof options.onNewVersion === 'function') {
    options.onNewVersion();
  }

  /* 解析配置：updates[0] 是 JSON 字符串 */
  let cfg = null;
  if (Array.isArray(updates) && updates.length > 0) {
    const first = updates[0];
    if (typeof first === 'string') {
      try {
        const parsed = JSON.parse(first);
        if (parsed && typeof parsed === 'object' && parsed.theme) {
          cfg = parsed;
        }
      } catch (e) {}
    }
  }

  /* 拿不到图片配置 → 走旧文字弹窗（兼容用） */
  if (!cfg) {
    showOldTextModal(version, date, updates, storageKey);
    return;
  }

  /* 注入一次图片弹窗的 CSS */
  injectUpdateImageCSS();

  /* 移除旧的更新弹窗，避免重复 */
  const modalId = 'updateModal';
  const oldModal = document.getElementById(modalId);
  if (oldModal) oldModal.remove();

  /* 创建图片弹窗 */
  const modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal update-image-modal';
  modal.innerHTML = `
    <div class="modal-content update-image-content">
      <div class="update-image-inner">
        <div class="canvas-scaler">
          <div class="update-canvas ${cfg.theme || 'theme-pink'}">
            <div class="light-band"></div>
            <div class="strip strip-top"></div>
            <div class="wheat-deco left">🌾</div>
            <div class="wheat-deco right">🌾</div>
            <div class="content">
              <div class="info-left">
                <div class="title"></div>
                <div class="version"></div>
              </div>
              <div class="logo-center">
                <div class="logo-circle"></div>
              </div>
              <div class="info-right">
                <div class="line1"></div>
                <div class="line2"></div>
              </div>
            </div>
            <div class="strip strip-bottom"></div>
          </div>
        </div>
      </div>
      <div class="update-image-footer">
        <button class="btn btn-primary" id="updateOkBtn">我知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  /* 填充内容 */
  const stripText = cfg.strip || '织雾满穗 ZHIWU UPDATE';
  const repeated = (stripText + '　　').repeat(14);
  modal.querySelectorAll('.strip-top, .strip-bottom').forEach(el => {
    el.textContent = repeated;
  });
  modal.querySelector('.info-left .title').textContent   = cfg.title   || '新版本发布';
  modal.querySelector('.info-left .version').textContent = cfg.version || '';
  modal.querySelector('.logo-circle').textContent        = cfg.logo    || '穗';
  modal.querySelector('.info-right .line1').textContent  = cfg.line1   || '';
  modal.querySelector('.info-right .line2').textContent  = cfg.line2   || '';

  /* 打开弹窗 */
  openModal(modalId);

  /* 点"我知道了"记住版本、关闭 */
  document.getElementById('updateOkBtn').onclick = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
  };
}

/* ============================================================
   旧格式文字弹窗（兼容老数据用，不影响新流程）
   ============================================================ */
function showOldTextModal(version, date, updates, storageKey) {
  const modalId = 'updateModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal update-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="update-header">
          <h2>
            🎉 版本更新
            <span class="update-version" id="updateVersion"></span>
            <span class="update-date" id="updateDate"></span>
          </h2>
        </div>
        <div class="update-body" id="updateBody"></div>
        <div class="update-footer">
          <div class="update-thanks">感谢你的使用 ❤️</div>
          <button class="btn btn-primary" id="updateOkBtn">我已知晓</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('updateVersion').textContent = version;
  document.getElementById('updateDate').textContent = '📅 ' + date;
  document.getElementById('updateBody').innerHTML = (updates || [])
    .map(t => `<div class="update-item">• ${escapeHtml(t)}</div>`)
    .join('');

  openModal(modalId);
  document.getElementById('updateOkBtn').onclick = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
  };
}

/* ============================================================
   注入图片弹窗的 CSS（只需一次）
   ============================================================ */
function injectUpdateImageCSS() {
  if (document.getElementById('updateImageCSS')) return;
  const style = document.createElement('style');
  style.id = 'updateImageCSS';
  style.textContent = `
    .update-image-modal .modal-content {
      max-width: 1280px;
      width: 95vw;
      padding: 0;
      overflow: hidden;
      background: #fdf2f5;
      border-radius: 20px;
    }
    .update-image-modal .update-image-inner {
      padding: 16px;
      background: #fdf2f5;
      display: flex;
      justify-content: center;
      overflow: hidden;
    }
    .update-image-modal .canvas-scaler {
      width: 1200px;
      height: 300px;
      transform-origin: top left;
    }
    .update-image-modal .update-canvas {
      width: 1200px;
      height: 300px;
      position: relative;
      overflow: hidden;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .update-image-modal .update-canvas.theme-pink { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #e8a2b0 0%, #dc6b82 40%, #c7546a 75%, #a83e56 100%); }
    .update-image-modal .update-canvas.theme-purple { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #b6a8ee 0%, #8878d8 40%, #6d5bc4 75%, #5544a6 100%); }
    .update-image-modal .update-canvas.theme-blue { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #9ed2ee 0%, #5aa5d8 40%, #3d8dc0 75%, #2d6f9c 100%); }
    .update-image-modal .update-canvas.theme-gold { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.22), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.15), transparent 70%),
      linear-gradient(125deg, #eed4a8 0%, #d4a06a 40%, #b8894f 75%, #926a3a 100%); }
    .update-image-modal .update-canvas.theme-green { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #bcdccd 0%, #8cb8a8 40%, #72a392 75%, #567a6c 100%); }

    .update-image-modal .update-canvas::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Ccircle cx='24' cy='24' r='1.6' fill='rgba(255,255,255,0.20)'/%3E%3C/svg%3E");
      background-repeat: repeat;
      pointer-events: none;
      z-index: 1;
    }
    .update-image-modal .light-band {
      position: absolute;
      top: -50%; left: 30%;
      width: 220px; height: 200%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
      transform: rotate(20deg);
      pointer-events: none;
      z-index: 2;
    }
    .update-image-modal .strip {
      position: absolute;
      left: 0; right: 0;
      height: 26px; line-height: 26px;
      font-size: 10px; font-weight: 600;
      letter-spacing: 6px;
      color: rgba(255, 255, 255, 0.42);
      white-space: nowrap; overflow: hidden;
      text-align: center;
      z-index: 5;
    }
    .update-image-modal .strip-top {
      top: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.12), transparent);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .update-image-modal .strip-bottom {
      bottom: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.12), transparent);
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .update-image-modal .wheat-deco {
      position: absolute;
      font-size: 90px;
      opacity: 0.09;
      z-index: 3;
      pointer-events: none;
      color: #fff;
    }
    .update-image-modal .wheat-deco.left  { left: 8px;  bottom: 15px; transform: rotate(-18deg); }
    .update-image-modal .wheat-deco.right { right: 8px; top: 15px;    transform: rotate(18deg) scaleX(-1); }
    .update-image-modal .content {
      position: absolute;
      top: 26px; bottom: 26px;
      left: 0; right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 60px;
      gap: 60px;
      z-index: 6;
    }
    .update-image-modal .info-left { flex: 1; text-align: right; color: #fff; min-width: 0; }
    .update-image-modal .info-left .title {
      font-size: 34px; font-weight: 800;
      letter-spacing: 4px; margin-bottom: 10px;
      line-height: 1.15;
      text-shadow: 0 1px 0 rgba(255,255,255,0.15), 0 4px 18px rgba(0,0,0,0.30), 0 8px 30px rgba(0,0,0,0.15);
    }
    .update-image-modal .info-left .version {
      font-size: 23px; font-weight: 600;
      letter-spacing: 2px; opacity: 0.95;
      text-shadow: 0 2px 10px rgba(0,0,0,0.28);
    }
    .update-image-modal .logo-center {
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .update-image-modal .logo-circle {
      width: 148px; height: 148px;
      border-radius: 50%;
      position: relative;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 56px; font-weight: 900;
      letter-spacing: 2px;
      text-shadow: 0 1px 0 rgba(255,255,255,0.3), 0 4px 16px rgba(0,0,0,0.35);
      background:
        radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.20) 25%, transparent 60%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.16), rgba(255,255,255,0.06) 70%, rgba(0,0,0,0.10) 100%);
      border: 2px solid rgba(255,255,255,0.55);
      box-shadow:
        0 16px 50px rgba(0,0,0,0.28),
        0 0 0 8px rgba(255,255,255,0.05),
        0 0 0 20px rgba(255,255,255,0.025),
        inset 0 -10px 25px rgba(0,0,0,0.16),
        inset 0 10px 25px rgba(255,255,255,0.30);
    }
    .update-image-modal .logo-circle::after {
      content: '';
      position: absolute;
      inset: -18px;
      border-radius: 50%;
      border: 1px dashed rgba(255,255,255,0.30);
      animation: rotate-slow 40s linear infinite;
    }
    @keyframes rotate-slow {
      from { transform: rotate(0); }
      to   { transform: rotate(360deg); }
    }
    .update-image-modal .info-right { flex: 1; text-align: left; color: #fff; min-width: 0; }
    .update-image-modal .info-right .line1 {
      font-size: 23px; font-weight: 700;
      margin-bottom: 8px; letter-spacing: 1px; line-height: 1.35;
      text-shadow: 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.28);
    }
    .update-image-modal .info-right .line2 {
      font-size: 19px; font-weight: 500;
      letter-spacing: 1px; opacity: 0.92; line-height: 1.35;
      text-shadow: 0 3px 12px rgba(0,0,0,0.25);
    }

    .update-image-modal .update-image-footer {
      padding: 12px 20px 18px;
      text-align: center;
      background: #fdf2f5;
    }

    @media (max-width: 1240px) {
      .update-image-modal .canvas-scaler {
        transform: scale(calc((95vw - 40px) / 1200));
        width: calc(95vw - 40px);
        height: calc(300px * (95vw - 40px) / 1200);
      }
    }
  `;
  document.head.appendChild(style);
}