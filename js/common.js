/* ============================================================
   织雾满穗 · 共享工具
   所有页面共用：Toast、弹窗、复制、防抖
   ============================================================ */

/**
 * 显示 Toast 短提示
 */
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

/**
 * 打开弹窗
 */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('show');
  modal.classList.remove('closing');
}

/**
 * 关闭弹窗（带退出动画）
 */
function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('show', 'closing');
  }, 250);
}

/**
 * 复制文本到剪贴板
 */
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

/**
 * 防抖函数
 */
function debounce(fn, wait = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * 转义 HTML，防止 XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

/**
 * 显示顶部提示条（3 秒自动消失）
 */
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

/**
 * 确认弹窗（返回 Promise<boolean>）
 */
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

    const ok = () => {
      closeModal('globalConfirm');
      resolve(true);
    };
    const cancel = () => {
      closeModal('globalConfirm');
      resolve(false);
    };
    document.getElementById('gcOk').onclick = ok;
    document.getElementById('gcCancel').onclick = cancel;
  });
}