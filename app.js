/* ==========================================================
   🌙 梦里有zhi - 核心逻辑
   数据全部存在 localStorage，纯本地运行
   ========================================================== */

// ========== 数据存储 ==========
const STORAGE_KEYS = {
  DIARIES: 'mlyz_diaries',
  PASSWORD: 'mlyz_password',
  BG_IMAGE: 'mlyz_bg_image',
  INVITED_VISIBLE: 'mlyz_invited_visible',
  GH_TOKEN: 'mlyz_gh_token',
  GIST_ID: 'mlyz_gist_id',
  AUTO_SYNC: 'mlyz_auto_sync',
  SYNC_LAST_TIME: 'mlyz_sync_last_time'
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
    return true;
  } catch (e) {
    console.error('saveData error:', e);
    return false;
  }
}

// 检测浏览器是否允许存储数据（无痕模式 / 存储被禁用时会失败）
function isStorageAvailable() {
  try {
    const testKey = '__mlyz_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

// ========== IndexedDB（放大容量，用来存日记和大文件）==========

const DB_NAME = 'mlyz_db';
const DB_STORE = 'kv';
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return _dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch (e) {
      resolve(undefined);
    }
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function idbDelete(key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// 读取全部日记（优先 IndexedDB，并自动迁移旧版 localStorage 数据）
async function loadDiaries() {
  let list = await idbGet('diaries');
  if (Array.isArray(list)) return list;

  const legacy = loadData(STORAGE_KEYS.DIARIES, []);
  const safeLegacy = Array.isArray(legacy) ? legacy : [];
  if (safeLegacy.length > 0) {
    await idbSet('diaries', safeLegacy);
  }
  return safeLegacy;
}

// 保存全部日记（优先 IndexedDB，失败再退回 localStorage）
async function saveDiaries(list) {
  const ok = await idbSet('diaries', list);
  if (ok) return true;
  return saveData(STORAGE_KEYS.DIARIES, list);
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

// 压缩图片：缩放到最大边 maxDim，转 JPEG，避免超出浏览器存储上限
function compressImage(file, maxDim = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
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

// ========== GitHub Gist 云同步 ==========

const GistSync = {
  // 获取配置
  getConfig() {
    return {
      token: loadData(STORAGE_KEYS.GH_TOKEN, ''),
      gistId: loadData(STORAGE_KEYS.GIST_ID, ''),
      autoSync: loadData(STORAGE_KEYS.AUTO_SYNC, false)
    };
  },

  // 保存配置
  saveConfig(token, gistId, autoSync) {
    saveData(STORAGE_KEYS.GH_TOKEN, token);
    saveData(STORAGE_KEYS.GIST_ID, gistId);
    saveData(STORAGE_KEYS.AUTO_SYNC, autoSync);
  },

  // 测试连接
  async testConnection(token, gistId) {
    try {
      const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        return { ok: true, message: `已连接 Gist「${data.description || '梦里有zhi'}」` };
      } else if (resp.status === 404) {
        return { ok: false, message: 'Gist ID 不存在' };
      } else if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: 'Token 无效' };
      } else {
        return { ok: false, message: `连接失败 (${resp.status})` };
      }
    } catch (e) {
      return { ok: false, message: '网络错误，请检查 Wi-Fi' };
    }
  },

  // 备份日记到 Gist（只备份文字，图片视频因为太大跳过）
  async backup(diaries) {
    const { token, gistId } = this.getConfig();
    if (!token || !gistId) {
      return { ok: false, message: '请先配置 Token 和 Gist ID' };
    }

    // 过滤掉 base64 图片/视频（Gist 有大小限制）
    const safeDiaries = diaries.map(d => ({
      ...d,
      image: d.image ? '[图片已省略，请手动导出完整备份]' : null,
      video: d.video ? '[视频已省略，请手动导出完整备份]' : null
    }));

    const payload = {
      description: '梦里有zhi - 日记数据同步',
      files: {
        'diaries.json': {
          content: JSON.stringify({
            version: 1,
            diaries: safeDiaries,
            updatedAt: Date.now()
          }, null, 2)
        }
      }
    };

    try {
      const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (resp.status === 200) {
        saveData(STORAGE_KEYS.SYNC_LAST_TIME, Date.now());
        return { ok: true, message: '✅ 已备份到云端' };
      } else {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, message: err.message || `备份失败 (${resp.status})` };
      }
    } catch (e) {
      return { ok: false, message: '网络错误' };
    }
  },

  // 从 Gist 恢复日记
  async restore() {
    const { token, gistId } = this.getConfig();
    if (!token || !gistId) {
      return { ok: false, message: '请先配置 Token 和 Gist ID' };
    }

    try {
      const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { 'Authorization': `token ${token}` }
      });

      if (resp.status !== 200) {
        return { ok: false, message: `恢复失败 (${resp.status})` };
      }

      const data = await resp.json();
      const file = data.files['diaries.json'];
      if (!file || !file.content) {
        return { ok: false, message: '云端没有数据' };
      }

      const parsed = JSON.parse(file.content);
      if (!parsed.diaries || !Array.isArray(parsed.diaries)) {
        return { ok: false, message: '云端数据格式不对' };
      }

      return { ok: true, diaries: parsed.diaries, message: `✅ 拉回 ${parsed.diaries.length} 篇日记` };
    } catch (e) {
      return { ok: false, message: '网络错误或数据损坏' };
    }
  },

  // 一键创建新的 Gist
  async createNewGist(token) {
    try {
      const resp = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: '梦里有zhi - 日记数据同步',
          public: false,
          files: {
            'diaries.json': {
              content: JSON.stringify({ version: 1, diaries: [], updatedAt: 0 })
            }
          }
        })
      });

      if (resp.status === 201) {
        const data = await resp.json();
        saveData(STORAGE_KEYS.GIST_ID, data.id);
        return { ok: true, gistId: data.id, htmlUrl: data.html_url };
      } else {
        return { ok: false, message: '创建失败' };
      }
    } catch (e) {
      return { ok: false, message: '网络错误' };
    }
  }
};

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

  // 图片上传（自动压缩，避免超出手机浏览器 5MB 存储上限）
  $('#btn-image').addEventListener('click', () => $('#file-image').click());
  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('⏳ 正在处理图片...', 1200);
    try {
      const base64 = await compressImage(file, 1200, 0.8);
      state.currentImage = base64;
      $('#preview-img').src = base64;
      $('#image-preview').classList.remove('hidden');
      const kb = Math.round(base64.length / 1024);
      showToast(`📷 图片已添加（${kb}KB）`);
    } catch (err) {
      console.error(err);
      showToast('❌ 图片处理失败，换一张试试');
    }
    e.target.value = '';
  });

  // 视频上传
  $('#btn-video').addEventListener('click', () => $('#file-video').click());
  $('#file-video').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 视频限制 50MB（存在 IndexedDB，容量比 localStorage 大很多）
    if (file.size > 50 * 1024 * 1024) {
      showToast('❌ 视频太大啦，最多 50MB（建议 15 秒以内）', 3000);
      e.target.value = '';
      return;
    }

    try {
      showToast('⏳ 正在处理视频...', 1500);
      const base64 = await fileToBase64(file);
      state.currentVideo = base64;
      $('#preview-video').src = base64;
      $('#video-preview').classList.remove('hidden');
      const mb = (base64.length / 1024 / 1024).toFixed(1);
      showToast(`🎬 视频已添加（${mb}MB）`);
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

async function publishDiary() {
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

  const diaries = await loadDiaries();
  diaries.unshift(diary); // 新日记放最前

  if (!(await saveDiaries(diaries))) {
    showToast('❌ 保存失败！手机存储空间不足，请先导出备份并删除一些旧日记', 4000);
    return;
  }

  showToast('✨ 发布成功！');
  resetPublishForm();

  // 自动同步到云端
  const syncOnPublish = $('#sync-on-publish').checked;
  const { autoSync } = GistSync.getConfig();
  if (syncOnPublish || autoSync) {
    setTimeout(async () => {
      const result = await GistSync.backup(diaries);
      if (result.ok) {
        showToast('☁️ 已同步到云端', 1500);
      } else {
        showToast('⚠️ 同步失败: ' + result.message, 2500);
      }
    }, 300);
  }
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

async function renderDiaryList() {
  const container = $('#diary-list');
  const emptyTip = $('#empty-tip');
  const countEl = $('#diary-count');
  container.innerHTML = '';

  const diaries = await loadDiaries();

  // 根据筛选过滤
  let filtered = diaries;
  if (state.currentFilter !== 'all') {
    filtered = diaries.filter(d => d.visibility === state.currentFilter);
  }

  if (countEl) {
    countEl.textContent = `共 ${filtered.length} 篇日记`;
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
      <button class="view-btn" data-view-detail="${diary.id}">👀 查看详情</button>
      <button class="delete-btn" data-delete="${diary.id}">🗑️ 删除</button>
    </div>
  `;

  // 图片点击放大
  const img = div.querySelector('img[data-view="image"]');
  if (img) {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageModal(diary.image);
    });
  }

  // 点整张卡片 / 查看详情 → 打开详情
  div.style.cursor = 'pointer';
  div.addEventListener('click', () => openDiaryDetail(diary));
  const viewBtn = div.querySelector('[data-view-detail]');
  if (viewBtn) {
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDiaryDetail(diary);
    });
  }

  // 删除按钮
  const delBtn = div.querySelector('[data-delete]');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
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

async function deleteDiary(id) {
  const diaries = await loadDiaries();
  const filtered = diaries.filter(d => d.id !== id);
  await saveDiaries(filtered);
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

// ========== 日记详情 ==========

function openDiaryDetail(diary) {
  const body = $('#detail-body');
  const visText = {
    private: '🔒 仅自己',
    invite: '📩 邀请可见',
    public: '🌐 公开'
  }[diary.visibility] || diary.visibility;

  let mediaHtml = '';
  if (diary.image) {
    mediaHtml = `<div class="detail-media"><img src="${diary.image}" alt="图片" id="detail-img"></div>`;
  } else if (diary.video) {
    mediaHtml = `<div class="detail-media"><video src="${diary.video}" controls playsinline></video></div>`;
  }

  let stickerHtml = '';
  if (diary.stickers && diary.stickers.length > 0) {
    stickerHtml = `<div class="detail-stickers">${diary.stickers.join('')}</div>`;
  }

  let inviteHtml = '';
  if (diary.visibility === 'invite' && diary.inviteCodes && diary.inviteCodes.length > 0) {
    inviteHtml = `<div class="detail-invite">邀请码：${escapeHtml(diary.inviteCodes.join('、'))}</div>`;
  }

  body.innerHTML = `
    <div class="detail-header">
      <span class="detail-date">${formatDate(diary.createdAt)}</span>
      <span class="diary-visibility ${diary.visibility}">${visText}</span>
    </div>
    ${diary.text ? `<div class="detail-text">${escapeHtml(diary.text)}</div>` : ''}
    ${mediaHtml}
    ${stickerHtml}
    ${inviteHtml}
  `;

  const detailImg = $('#detail-img');
  if (detailImg) {
    detailImg.addEventListener('click', () => openImageModal(diary.image));
  }

  $('#detail-modal').classList.remove('hidden');
}

function initDetailModal() {
  const modal = $('#detail-modal');
  $('#detail-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

// ========== 设置页 ==========

function initSettings() {
  // 背景上传
  $('#btn-bg-upload').addEventListener('click', () => $('#file-bg').click());
  $('#file-bg').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      showToast('❌ 图片太大啦，最多 20MB');
      e.target.value = '';
      return;
    }

    showToast('⏳ 正在处理背景图...', 1200);
    try {
      // 压缩后再存，避免超出浏览器存储上限
      const base64 = await compressImage(file, 1600, 0.8);
      if (!saveData(STORAGE_KEYS.BG_IMAGE, base64)) {
        showToast('❌ 背景保存失败，换张小一点的图片', 3000);
      } else {
        applyBackground();
        loadSettingsView();
        showToast('🖼️ 背景已更新');
      }
    } catch (err) {
      console.error(err);
      showToast('❌ 图片处理失败');
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

  // ===== 云同步按钮 =====
  // 保存同步配置
  $('#btn-save-sync').addEventListener('click', () => {
    const token = $('#gh-token').value.trim();
    const gistId = $('#gist-id').value.trim();
    const autoSync = $('#auto-sync').checked;

    if (!token) { showToast('❌ 请输入 GitHub Token'); return; }
    if (!gistId) { showToast('❌ 请输入 Gist ID'); return; }

    GistSync.saveConfig(token, gistId, autoSync);
    showToast('✅ 配置已保存');
    loadSettingsView();
  });

  // 测试连接
  $('#btn-test-sync').addEventListener('click', async () => {
    const token = $('#gh-token').value.trim() || loadData(STORAGE_KEYS.GH_TOKEN, '');
    const gistId = $('#gist-id').value.trim() || loadData(STORAGE_KEYS.GIST_ID, '');
    showToast('⏳ 正在连接...', 2000);
    const result = await GistSync.testConnection(token, gistId);
    showToast(result.message, 2500);
    loadSettingsView();
  });

  // 立即备份
  $('#btn-backup-now').addEventListener('click', async () => {
    const diaries = await loadDiaries();
    if (diaries.length === 0) { showToast('ℹ️ 没有日记可备份'); return; }
    showToast('⏳ 正在备份...', 2000);
    const result = await GistSync.backup(diaries);
    showToast(result.message, 2500);
    loadSettingsView();
  });

  // 从云端恢复
  $('#btn-restore-now').addEventListener('click', async () => {
    confirmModal('从云端恢复？', '会用云端数据覆盖本地日记，确定吗？', async () => {
      showToast('⏳ 正在拉取...', 2000);
      const result = await GistSync.restore();
      if (result.ok) {
        if (!(await saveDiaries(result.diaries))) {
          showToast('❌ 恢复失败：手机存储空间不足', 3000);
        } else {
          showToast(result.message, 2500);
          renderDiaryList();
        }
      } else {
        showToast(result.message, 2500);
      }
      loadSettingsView();
    });
  });

  // 导出
  $('#btn-export').addEventListener('click', exportData);
  // 导入
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importData);

  // 全部删除
  $('#btn-clear-all').addEventListener('click', async () => {
    const diaries = await loadDiaries();
    if (diaries.length === 0) {
      showToast('ℹ️ 还没有日记');
      return;
    }
    confirmModal('真的全部删除？', `共有 ${diaries.length} 篇日记，此操作不可恢复！`, async () => {
      await idbDelete('diaries');
      localStorage.removeItem(STORAGE_KEYS.DIARIES);
      showToast('🗑️ 已清空全部日记');
      renderDiaryList();
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

  // 同步配置
  const config = GistSync.getConfig();
  $('#gh-token').value = config.token;
  $('#gist-id').value = config.gistId;
  $('#auto-sync').checked = config.autoSync;

  // 同步状态显示
  const statusEl = $('#sync-status');
  const lastTime = loadData(STORAGE_KEYS.SYNC_LAST_TIME, 0);
  if (config.token && config.gistId) {
    if (lastTime > 0) {
      statusEl.textContent = `✅ 已配置 · 上次同步 ${formatDate(lastTime)}`;
      statusEl.className = 'sync-status ok';
    } else {
      statusEl.textContent = `✅ 已配置 · 还没同步过`;
      statusEl.className = 'sync-status ok';
    }
  } else {
    statusEl.textContent = '⚠️ 未配置（Token + Gist ID 必填）';
    statusEl.className = 'sync-status';
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

async function exportData() {
  const diaries = await loadDiaries();
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
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.diaries || !Array.isArray(data.diaries)) {
        throw new Error('格式不对');
      }
      confirmModal(
        '导入数据',
        `检测到 ${data.diaries.length} 篇日记，会追加到现有数据后面\n（不会覆盖已有日记）`,
        async () => {
          const existing = await loadDiaries();
          const merged = [...existing, ...data.diaries];
          if (await saveDiaries(merged)) {
            showToast(`✅ 导入成功，现有 ${merged.length} 篇日记`);
            renderDiaryList();
          } else {
            showToast('❌ 导入失败：手机存储空间不足', 3000);
          }
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

    // 检测存储是否可用（无痕模式 / 存储被禁用）
    if (!isStorageAvailable()) {
      const warn = $('#storage-warning');
      if (warn) warn.classList.remove('hidden');
    }

    initTabs();
    initPublish();
    initDiaryList();
    initImageModal();
    initDetailModal();
    initSettings();
    applyBackground();

    console.log('🌙 梦里有zhi 已启动！');
  };
  tryInit();
});
