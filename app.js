/* ==========================================================
   🌙 梦里有zhi - 核心逻辑
   数据全部存在 localStorage，纯本地运行
   ========================================================== */

// ========== 数据存储 ==========
const STORAGE_KEYS = {
  DIARIES: 'mlyz_diaries',
  PASSWORD: 'mlyz_password',
  BG_IMAGE: 'mlyz_bg_image',
  INVITED_VISIBLE: 'mlyz_invited_visible' // 标记是否"已输入邀请码"
};

// ========== 全局状态 ==========
let state = {
  currentTab: 'publish',
  currentFilter: 'all',
  currentImage: null,      // base64
  currentVideo: null,      // base64
  currentStickers: [],     // 贴纸数组
  authenticated: false     // 是否通过密码验证
};

// ========== 工具函数 ==========

function $(selector) { return document.querySelector(selector); }
function $$(selector) { return document.querySelectorAll(selector); }

function loadData(key, defaultValue) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.error('loadData error:', e);
    return defaultValue;
  }
}

function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('saveData error:', e);
    showToast('❌ 存储失败，可能是空间满了');
  }
}

function showToast(message, duration = 1800) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function confirmModal(title, text, onOk) {
  const modal = $('#confirm-modal');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  modal.classList.remove('hidden');

  const cancelBtn = $('#confirm-cancel');
  const okBtn = $('#confirm-ok');

  const cleanup = () => {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', cleanup);
    okBtn.removeEventListener('click', okHandler);
  };

  const okHandler = () => { cleanup(); onOk(); };

  cancelBtn.addEventListener('click', cleanup);
  okBtn.addEventListener('click', okHandler);
}

// ========== 启动密码验证 ==========

function initLockScreen() {
  const hasPassword = !!loadData(STORAGE_KEYS.PASSWORD, null);
  const lockScreen = $('#lock-screen');

  if (!hasPassword) {
    state.authenticated = true;
    lockScreen.classList.add('hidden');
    return;
  }

  lockScreen.classList.remove('hidden');

  $('#lock-unlock').addEventListener('click', () => {
    const inputPwd = $('#lock-password').value;
    const savedPwd = loadData(STORAGE_KEYS.PASSWORD, '');

    if (inputPwd === savedPwd) {
      state.authenticated = true;
      lockScreen.classList.add('hidden');
      $('#lock-hint').textContent = '';
      $('#lock-password').value = '';
      applyBackground();
    } else {
      $('#lock-hint').textContent = '❌ 密码不对哦，再试试';
      $('#lock-password').value = '';
    }
  });

  $('#lock-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') $('#lock-unlock').click();
  });
}

// ========== Tab 切换 ==========

function initTabs() {
  const tabs = ['publish', 'list', 'settings'];

  const switchTab = (tabName) => {
    state.currentTab = tabName;

    // 更新底部导航高亮
    $$('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新顶部导航按钮
    $$('.nav-btn[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 切换内容
    tabs.forEach(t => {
      $(`#tab-${t}`).classList.toggle('active', t === tabName);
    });

    // 特殊处理
    if (tabName === 'list') renderDiaryList();
    if (tabName === 'settings') loadSettingsView();
    if (tabName === 'publish') resetPublishForm();
  };

  // 底部导航点击
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 顶部按钮点击
  $$('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ========== 发布日记功能 ==========

function initPublish() {
  // 贴纸点击
  $$('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.textContent.trim();
      state.currentStickers.push(emoji);
      showToast(`✨ 已添加 ${emoji}`);
    });
  });

  // 图片上传
  $('#btn-image').addEventListener('click', () => $('#file-image').click());
  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      state.currentImage = base64;
      $('#preview-img').src = base64;
      $('#image-preview').classList.remove('hidden');
      showToast('📷 图片已添加');
    } catch (err) {
      showToast('❌ 图片读取失败');
    }
    e.target.value = '';
  });

  // 视频上传
  $('#btn-video').addEventListener('click', () => $('#file-video').click());
  $('#file-video').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 检查大小（5MB 限制，避免 localStorage 爆炸）
    if (file.size > 5 * 1024 * 1024) {
      showToast('❌ 视频太大啦，最多 5MB');
      e.target.value = '';
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      state.currentVideo = base64;
      $('#preview-video').src = base64;
      $('#video-preview').classList.remove('hidden');
      showToast('🎬 视频已添加');
    } catch (err) {
      showToast('❌ 视频读取失败');
    }
    e.target.value = '';
  });

  // 移除图片/视频
  $$('.remove-media').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      if (type === 'image') {
        state.currentImage = null;
        $('#image-preview').classList.add('hidden');
      } else {
        state.currentVideo = null;
        $('#video-preview').classList.add('hidden');
      }
    });
  });

  // 可见范围切换
  $('#visibility-select').addEventListener('change', (e) => {
    $('#invite-box').classList.toggle('hidden', e.target.value !== 'invite');
  });

  // 发布按钮
  $('#btn-publish').addEventListener('click', publishDiary);
}

function publishDiary() {
  const text = $('#diary-text').value.trim();
  const visibility = $('#visibility-select').value;
  const inviteCodes = visibility === 'invite'
    ? $('#invite-code').value.split(/[,，\s]+/).filter(c => c.trim())
    : [];

  if (!text && !state.currentImage && !state.currentVideo && state.currentStickers.length === 0) {
    showToast('❌ 写点东西或者加点图片吧～');
    return;
  }

  const diary = {
    id: generateId(),
    text: text,
    image: state.currentImage,
    video: state.currentVideo,
    stickers: [...state.currentStickers],
    visibility: visibility,
    inviteCodes: inviteCodes,
    createdAt: Date.now()
  };

  const diaries = loadData(STORAGE_KEYS.DIARIES, []);
  diaries.unshift(diary); // 新日记放最前
  saveData(STORAGE_KEYS.DIARIES, diaries);

  showToast('✨ 发布成功！');
  resetPublishForm();
}

function resetPublishForm() {
  $('#diary-text').value = '';
  $('#visibility-select').value = 'private';
  $('#invite-box').classList.add('hidden');
  $('#invite-code').value = '';

  state.currentImage = null;
  state.currentVideo = null;
  state.currentStickers = [];

  $('#image-preview').classList.add('hidden');
  $('#video-preview').classList.add('hidden');
}

// ========== 日记列表 ==========

function initDiaryList() {
  // 筛选按钮
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderDiaryList();
    });
  });
}

function renderDiaryList() {
  const container = $('#diary-list');
  const emptyTip = $('#empty-tip');
  container.innerHTML = '';

  const diaries = loadData(STORAGE_KEYS.DIARIES, []);

  // 根据筛选过滤
  let filtered = diaries;
  if (state.currentFilter !== 'all') {
    filtered = diaries.filter(d => d.visibility === state.currentFilter);
  }

  if (filtered.length === 0) {
    emptyTip.classList.remove('hidden');
    return;
  }
  emptyTip.classList.add('hidden');

  filtered.forEach(diary => {
    const item = createDiaryItem(diary);
    container.appendChild(item);
  });
}

function createDiaryItem(diary) {
  const div = document.createElement('div');
  div.className = 'diary-item';

  const visText = {
    private: '🔒 仅自己',
    invite: '📩 邀请可见',
    public: '🌐 公开'
  }[diary.visibility] || diary.visibility;

  let mediaHtml = '';
  if (diary.image) {
    mediaHtml = `<div class="diary-media"><img src="${diary.image}" alt="图片" data-view="image"></div>`;
  } else if (diary.video) {
    mediaHtml = `<div class="diary-media"><video src="${diary.video}" controls></video></div>`;
  }

  let stickerHtml = '';
  if (diary.stickers && diary.stickers.length > 0) {
    stickerHtml = `<div class="diary-stickers">${diary.stickers.join('')}</div>`;
  }

  div.innerHTML = `
    <div class="diary-header">
      <span class="diary-date">${formatDate(diary.createdAt)}</span>
      <span class="diary-visibility ${diary.visibility}">${visText}</span>
    </div>
    ${diary.text ? `<div class="diary-text-content">${escapeHtml(diary.text)}</div>` : ''}
    ${mediaHtml}
    ${stickerHtml}
    <div class="diary-actions">
      <button class="delete-btn" data-delete="${diary.id}">🗑️ 删除</button>
    </div>
  `;

  // 图片点击放大
  const img = div.querySelector('img[data-view="image"]');
  if (img) {
    img.addEventListener('click', () => openImageModal(diary.image));
  }

  // 删除按钮
  const delBtn = div.querySelector('[data-delete]');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      confirmModal('确认删除？', '这篇日记删了就找不回来了哦', () => {
        deleteDiary(diary.id);
      });
    });
  }

  return div;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function deleteDiary(id) {
  const diaries = loadData(STORAGE_KEYS.DIARIES, []);
  const filtered = diaries.filter(d => d.id !== id);
  saveData(STORAGE_KEYS.DIARIES, filtered);
  showToast('🗑️ 已删除');
  renderDiaryList();
}

// ========== 图片查看模态框 ==========

function initImageModal() {
  const modal = $('#image-modal');
  const closeBtn = modal.querySelector('.modal-close');

  const close = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}

function openImageModal(src) {
  $('#modal-img').src = src;
  $('#image-modal').classList.remove('hidden');
}

// ========== 设置页 ==========

function initSettings() {
  // 背景上传
  $('#btn-bg-upload').addEventListener('click', () => $('#file-bg').click());
  $('#file-bg').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      showToast('❌ 图片太大啦，最多 3MB');
      e.target.value = '';
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      saveData(STORAGE_KEYS.BG_IMAGE, base64);
      applyBackground();
      loadSettingsView();
      showToast('🖼️ 背景已更新');
    } catch (err) {
      showToast('❌ 图片读取失败');
    }
    e.target.value = '';
  });

  // 背景清除
  $('#btn-bg-reset').addEventListener('click', () => {
    confirmModal('清除背景？', '恢复默认渐变背景', () => {
      localStorage.removeItem(STORAGE_KEYS.BG_IMAGE);
      applyBackground();
      loadSettingsView();
      showToast('✨ 已恢复默认背景');
    });
  });

  // 密码设置
  $('#btn-set-password').addEventListener('click', () => {
    const pwd = $('#pwd-input').value;
    const confirm = $('#pwd-confirm').value;

    if (!pwd) {
      showToast('❌ 密码不能为空');
      return;
    }
    if (pwd !== confirm) {
      showToast('❌ 两次密码不一样');
      return;
    }
    if (pwd.length < 2) {
      showToast('❌ 密码太短了，至少 2 位');
      return;
    }

    saveData(STORAGE_KEYS.PASSWORD, pwd);
    $('#pwd-input').value = '';
    $('#pwd-confirm').value = '';
    showToast('✅ 密码已保存');
    loadSettingsView();
  });

  // 取消密码
  $('#btn-clear-password').addEventListener('click', () => {
    const hasPwd = !!loadData(STORAGE_KEYS.PASSWORD, null);
    if (!hasPwd) {
      showToast('ℹ️ 还没设置密码哦');
      return;
    }
    confirmModal('取消密码？', '以后打开不需要密码了', () => {
      localStorage.removeItem(STORAGE_KEYS.PASSWORD);
      showToast('🔓 密码已取消');
      loadSettingsView();
    });
  });

  // 导出
  $('#btn-export').addEventListener('click', exportData);
  // 导入
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importData);

  // 全部删除
  $('#btn-clear-all').addEventListener('click', () => {
    const diaries = loadData(STORAGE_KEYS.DIARIES, []);
    if (diaries.length === 0) {
      showToast('ℹ️ 还没有日记');
      return;
    }
    confirmModal('真的全部删除？', `共有 ${diaries.length} 篇日记，此操作不可恢复！`, () => {
      localStorage.removeItem(STORAGE_KEYS.DIARIES);
      showToast('🗑️ 已清空全部日记');
    });
  });
}

function loadSettingsView() {
  // 背景预览
  const bgImg = loadData(STORAGE_KEYS.BG_IMAGE, null);
  const preview = $('#bg-preview');
  if (bgImg) {
    preview.style.background = `url(${bgImg}) center/cover no-repeat`;
    preview.innerHTML = '';
  } else {
    preview.style.background = '';
    preview.innerHTML = '<span>默认渐变背景</span>';
  }
}

function applyBackground() {
  const bgImg = loadData(STORAGE_KEYS.BG_IMAGE, null);
  const layer = $('#bg-layer');
  if (bgImg) {
    layer.style.background = `url(${bgImg}) center/cover no-repeat fixed`;
  } else {
    layer.style.background = '';
  }
}

function exportData() {
  const diaries = loadData(STORAGE_KEYS.DIARIES, []);
  if (diaries.length === 0) {
    showToast('ℹ️ 没有数据可导出');
    return;
  }
  const data = {
    app: '梦里有zhi',
    version: 1,
    exportedAt: Date.now(),
    diaries: diaries
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `梦里有zhi_${formatDate(Date.now()).replace(/[:\s]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('💾 已开始下载');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.diaries || !Array.isArray(data.diaries)) {
        throw new Error('格式不对');
      }
      confirmModal(
        '导入数据',
        `检测到 ${data.diaries.length} 篇日记，会追加到现有数据后面\n（不会覆盖已有日记）`,
        () => {
          const existing = loadData(STORAGE_KEYS.DIARIES, []);
          const merged = [...existing, ...data.diaries];
          saveData(STORAGE_KEYS.DIARIES, merged);
          showToast(`✅ 导入成功，现有 ${merged.length} 篇日记`);
        }
      );
    } catch (err) {
      showToast('❌ 文件格式不对');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ========== PWA Service Worker ==========

function registerSW() {
  if ('serviceWorker' in navigator) {
    // 这里不强制注册，保持简单
  }
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  initLockScreen();

  // 等密码验证通过后再初始化主应用
  const tryInit = () => {
    if (!state.authenticated) {
      setTimeout(tryInit, 300);
      return;
    }

    initTabs();
    initPublish();
    initDiaryList();
    initImageModal();
    initSettings();
    applyBackground();

    console.log('🌙 梦里有zhi 已启动！');
  };
  tryInit();
});
