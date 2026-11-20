// ===== 梦里有zhi 社交版 - GitHub as Database =====

const GH = {
  token: String.fromCharCode(103,104,112,95,111,81,69,84,56,53,80,49,90,119,119,73,68,80,50,101,88,82,109,67,65,113,118,116,119,100,65,65,121,101,49,117,67,97,89,89),
  owner: '1024z-del',
  repo: 'mengli-youzhi',
  branch: 'main',
  base: 'https://api.github.com'
};

const headers = {
  'Authorization': `Bearer ${GH.token}`,
  'Accept': 'application/vnd.github.v3+json',
  'Content-Type': 'application/json'
};

// ---- GitHub API helpers ----
async function ghGetFile(path) {
  const url = `${GH.base}/repos/${GH.owner}/${GH.repo}/contents/social/${path}?ref=${GH.branch}&t=${Date.now()}`;
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error(`读取失败 ${r.status}`);
  const j = await r.json();
  const content = j.content ? JSON.parse(decodeURIComponent(escape(atob(j.content)))) : null;
  return { content, sha: j.sha };
}

async function ghPutFile(path, data, sha, options) {
  const url = `${GH.base}/repos/${GH.owner}/${GH.repo}/contents/social/${path}`;
  const body = {
    message: `update ${path}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data)))),
    branch: GH.branch
  };
  if (sha) body.sha = sha;
  let r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  // 409: SHA mismatch, retry once with fresh SHA
  if (r.status === 409) {
    const fresh = await ghGetFile(path);
    body.sha = fresh.sha;
    // merge: if data is array, combine with fresh content（覆盖模式除外）
    if (!(options && options.replace) && Array.isArray(data) && Array.isArray(fresh.content)) {
      const existing = fresh.content;
      const existingIds = new Set(existing.map(x => x.id));
      for (const item of data) {
        if (!item.id || !existingIds.has(item.id)) {
          existing.push(item);
        }
      }
      body.content = btoa(unescape(encodeURIComponent(JSON.stringify(existing))));
    }
    r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  }
  if (!r.ok) throw new Error(`写入失败 ${r.status}`);
  const j = await r.json();
  return j.content.sha;
}

// 上传超时或响应丢失后，确认文件是否其实已经写入成功
async function ghMediaExists(path) {
  try {
    const r = await fetch(`${GH.base}/repos/${GH.owner}/${GH.repo}/contents/social/${path}?ref=${GH.branch}&t=${Date.now()}`, { headers, cache: 'no-store' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function ghUploadMedia(name, base64, options) {
  const safeName = String(name || 'file').replace(/[^\w.\-]+/g, '_');
  const path = `media/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeName}`;
  const rawUrl = `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/social/${path}`;
  const url = `${GH.base}/repos/${GH.owner}/${GH.repo}/contents/social/${path}`;
  const bodyStr = JSON.stringify({
    message: `upload media`,
    content: base64,
    branch: GH.branch
  });
  const timeoutMs = (options && options.timeout) || 120000;
  let lastErr = null;
  // 大视频/音乐上传容易超时/冲突，最多重试 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let fatal = null;
    try {
      const r = await fetch(url, { method: 'PUT', headers, body: bodyStr, signal: ctrl.signal });
      if (r.ok) return rawUrl;
      // 409/422：上一次请求可能其实已写入成功（超时或响应丢失），文件已存在时直接复用
      if ([409, 422].includes(r.status)) {
        if (await ghMediaExists(path)) return rawUrl;
      }
      const err = new Error(`上传失败 ${r.status}`);
      // 409/422/5xx 多为并发提交冲突或服务端临时问题，可以重试
      if ([409, 422, 500, 502, 503, 504].includes(r.status)) lastErr = err;
      else fatal = err;
    } catch (e) {
      // 网络中断或超时后服务端可能已完成写入，先确认再重试
      if (await ghMediaExists(path)) return rawUrl;
      lastErr = (e && e.name === 'AbortError') ? new Error('上传超时，请检查网络后重试') : e;
    } finally {
      clearTimeout(timer);
    }
    if (fatal) throw fatal;
    if (attempt < 3) await new Promise(res => setTimeout(res, 1000 * attempt));
  }
  throw lastErr || new Error('上传失败');
}

// ---- 媒体地址：优先 jsDelivr CDN（国内更快），失败再回退 Pages / raw ----
const MEDIA_RAW_PREFIX = `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/social/`;
const MEDIA_PAGES_PREFIX = `https://${GH.owner}.github.io/${GH.repo}/social/`;
const MEDIA_CDN_PREFIX = `https://cdn.jsdelivr.net/gh/${GH.owner}/${GH.repo}@${GH.branch}/social/`;
function mediaRelPath(u) {
  return (u && u.indexOf(MEDIA_RAW_PREFIX) === 0) ? u.slice(MEDIA_RAW_PREFIX.length) : null;
}
// 国内网络下 Pages 最稳（App 本身就是从 Pages 加载的），CDN 作为备用
function mediaRenderUrl(u) {
  const rel = mediaRelPath(u);
  return rel ? MEDIA_PAGES_PREFIX + rel : u;
}
function mediaPagesUrl(u) {
  const rel = mediaRelPath(u);
  return rel ? MEDIA_PAGES_PREFIX + rel : u;
}
function mediaCdnUrl(u) {
  const rel = mediaRelPath(u);
  return rel ? MEDIA_CDN_PREFIX + rel : u;
}
function mediaFallbackAttr(rawUrl) {
  const rel = mediaRelPath(rawUrl);
  if (!rel) return '';
  const cdn = MEDIA_CDN_PREFIX + rel;
  // 依次回退：Pages → CDN → raw
  return ` onerror="if(!this.dataset.f){this.dataset.f='1';this.src='${cdn}';}else if(this.dataset.f==='1'){this.dataset.f='2';this.src='${rawUrl}';}"`;
}

// 图片兜底：Pages 刚部署时新文件会短暂 404，先用 raw 拿到，再换回 Pages / CDN
function fastImgFallbackAttr(rawUrl) {
  const rel = mediaRelPath(rawUrl);
  if (!rel) return '';
  const pages = MEDIA_PAGES_PREFIX + rel;
  const raw = MEDIA_RAW_PREFIX + rel;
  // CDN 失败 → Pages → raw
  return ` onerror="if(!this.dataset.f){this.dataset.f='1';this.src='${pages}';}else if(this.dataset.f==='1'){this.dataset.f='2';this.src='${raw}';}"`;
}
function imgFallbackAttr(u) {
  const rel = mediaRelPath(u);
  if (!rel) return '';
  const raw = MEDIA_RAW_PREFIX + rel;
  const pages = MEDIA_PAGES_PREFIX + rel;
  const cdn = MEDIA_CDN_PREFIX + rel;
  return ` onerror="imgRetry(this)" data-fb='${JSON.stringify([raw, pages, cdn, pages])}'`;
}

function imgRetry(img) {
  let list = [];
  try { list = JSON.parse(img.dataset.fb || '[]'); } catch (e) { return; }
  const i = +(img.dataset.fi || 0);
  if (i >= list.length) return;
  img.dataset.fi = i + 1;
  const delay = i === 3 ? 3000 : 0;
  setTimeout(() => { img.src = list[i]; }, delay);
}
// 缩略图已在显示，原图预加载完成后再无感替换（避免闪烁）
function imgUpgrade(img) {
  const full = img.dataset.full;
  if (!full || img.dataset.up || img.src === full) return;
  img.dataset.up = '1';
  const pre = new Image();
  pre.onload = () => {
    if (img.dataset.up === '1') img.src = full;
  };
  pre.onerror = () => {
    const pages = img.dataset.fullPages;
    if (pages && pre.src !== pages) pre.src = pages;
  };
  pre.src = full;
}
function getPostMedia(p) {
  if (Array.isArray(p.media) && p.media.length) return p.media;
  const list = [];
  if (p.image) list.push({ type: 'image', url: p.image });
  if (p.video) list.push({ type: 'video', url: p.video, live: !!p.live, sound: p.liveSound !== false });
  return list;
}
// 动态里多张图片：朋友圈式九宫格；点开可左右滑动查看
const galleryStore = {};
function mediaListHtml(p, cls) {
  const list = getPostMedia(p);
  const allImgs = list.length >= 1 && list.every(m => m.type === 'image');
  if (cls !== 'post' || !allImgs) return list.map(m => mediaHtml(m, cls)).join('');
  galleryStore[p.id] = list.map(m => ({ url: m.url, thumb: m.thumb || null }));
  const cols = list.length === 1 ? 1 : (list.length === 4 ? 2 : 3);
  const cells = list.map((m, i) => `<div class="img-cell" onclick="event.stopPropagation();openImageGallery('${p.id}',${i})">
      <img src="${mediaPagesUrl(m.thumb || m.url)}" loading="lazy" decoding="async"${imgFallbackAttr(m.thumb || m.url)}>
    </div>`).join('');
  return `<div class="img-grid cols-${cols}">${cells}</div>`;
}

function openImageGallery(pid, start) {
  const urls = galleryStore[pid] || [];
  if (!urls.length) return;
  renderGallery(urls, start, true);
}

// 头像、主页背景等单张图片：点开看全图，点空白关闭
function openSingleImage(url) {
  if (!url) return;
  renderGallery([url], 0, false);
}

function renderGallery(urls, start, showIdx) {
  const viewer = document.getElementById('media-viewer');
  const content = document.getElementById('media-viewer-content');
  if (!viewer || !content) return;
  const items = (urls || []).map(u => typeof u === 'string' ? { url: u, thumb: null } : u);
  if (!items.length) return;
  content.style.width = '100%';
  content.style.height = '92vh';
  // 先用缩略图铺底，大图加载完成后再淡入，避免出现长时间空白
  content.innerHTML = `<div class="gal-track">${items.map((it, i) => `
    <div class="gal-slide">
      ${it.thumb ? `<img class="gal-ph" src="${mediaPagesUrl(it.thumb)}" decoding="async" alt="">` : ''}
      <span class="gal-spin" aria-hidden="true"></span>
      <img class="gal-img" src="${mediaCdnUrl(it.url)}" data-pages="${mediaPagesUrl(it.url)}" loading="${i === start ? 'eager' : 'lazy'}" decoding="async">
      ${showIdx ? `<span class="gal-idx">${i + 1}/${items.length}</span>` : ''}
    </div>`).join('')}</div>`;
  // 大图优先走 jsDelivr（国内通常比 Pages 快），3.5 秒没加载完或失败就切回 Pages
  content.querySelectorAll('.gal-img').forEach(img => {
    let settled = false;
    const pages = img.dataset.pages;
    const timer = setTimeout(() => {
      if (!settled && pages && img.src !== pages) img.src = pages;
    }, 3500);
    img.addEventListener('load', () => {
      settled = true;
      clearTimeout(timer);
      if (img.parentNode) img.parentNode.classList.add('ready');
    });
    img.addEventListener('error', () => {
      if (pages && img.src !== pages) img.src = pages;
    });
  });
  viewer.style.display = 'flex';
  const track = content.querySelector('.gal-track');
  // 点空白/轻点关闭；左右滑动时不误触关闭
  let startX = 0, moved = false;
  track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; moved = false; }, { passive: true });
  track.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - startX) > 8) moved = true; }, { passive: true });
  track.addEventListener('click', () => { if (!moved) closeMediaViewer(); });
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; });
}

function mediaHtml(m, cls) {
  const raw = m.url;
  const src = mediaRenderUrl(raw);
  const fallback = mediaFallbackAttr(raw);
  const poster = m.poster ? mediaPagesUrl(m.poster) : '';
  const posterAttr = poster ? ` poster="${poster}"` : '';
  if (m.type === 'image') {
    if (cls !== 'post') {
      return `<img src="${mediaCdnUrl(raw)}"${fastImgFallbackAttr(raw)} class="detail-img" loading="lazy" decoding="async">`;
    }
    // 动态列表：先显示缩略图（秒开），原图加载好后再替换；不重复请求、不闪烁
    const thumb = m.thumb ? mediaPagesUrl(m.thumb) : mediaPagesUrl(raw);
    return `<img src="${thumb}" class="post-img" loading="lazy" decoding="async"${imgFallbackAttr(m.thumb || raw)} data-full="${mediaCdnUrl(raw)}" data-full-pages="${mediaPagesUrl(raw)}" onload="imgUpgrade(this)">`;
  }

  // 动态列表：直接内嵌播放，点播放键就地在动态里播放，不再跳转
  if (cls === 'post') {
    const bgStyle = poster ? ` style="background:#0b0718 url('${poster}') center/cover no-repeat;"` : '';
    return `<div class="media-thumb" onclick="event.stopPropagation()">
      <video class="post-video" src="${src}#t=0.1"${posterAttr} controls playsinline webkit-playsinline preload="metadata"${bgStyle}${fallback}></video>
      ${m.live ? '<span class="live-badge">实况</span>' : ''}
    </div>`;
  }

  // 详情页：保留原生播放控件
  const vidCls = 'detail-video';
  const vsrc = `${src}#t=0.1`;
  if (m.live) {
    return m.sound === false
      ? `<div class="live-wrap"><video src="${vsrc}" class="${vidCls}"${posterAttr} autoplay muted loop playsinline webkit-playsinline preload="metadata" style="margin:0;"${fallback}></video><span class="live-badge">实况</span></div>`
      : `<div class="live-wrap"><video src="${vsrc}" class="${vidCls}"${posterAttr} controls loop playsinline webkit-playsinline preload="metadata" style="margin:0;"${fallback}></video><span class="live-badge">实况</span></div>`;
  }
  return `<video src="${vsrc}"${posterAttr} controls playsinline preload="metadata" class="${vidCls}"${fallback}></video>`;
}

// ---- Password hash ----
async function hashPwd(pwd) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd + 'mlyz_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Auth state ----
let currentUser = JSON.parse(localStorage.getItem('mlyz_user') || 'null');
let replyToUser = null; // { userId, username } 当前回复目标
let currentDetailPostId = null; // 当前打开的日记 ID
let pendingOpenPost = null; // 关闭当前弹窗后要打开的日记 ID

// ---- 弹窗返回栈（支持手机返回键）----
const overlayStack = [];
function openOverlay(id) {
  overlayStack.push(id);
  const el = document.getElementById(id);
  // 栈顶的弹窗 z-index 最高，确保盖在其他弹窗上面
  if (el) el.style.zIndex = 100 + overlayStack.length;
  // 锁定页面滚动，避免滑动弹窗时把后面的列表带动
  document.body.style.overflow = 'hidden';
  syncOverlayClass();
  history.pushState({ overlay: id }, '');
}

// 弹窗打开时暂停背景动画，iOS 上合成负担小很多，打开更快
function syncOverlayClass() {
  const on = overlayStack.length > 0;
  document.body.classList.toggle('has-overlay', on);
  document.documentElement.classList.toggle('has-overlay', on);
}
function closeOverlay(id) {
  const idx = overlayStack.lastIndexOf(id);
  if (idx >= 0) {
    // 如果是栈顶，用 history.back() 触发 popstate 关闭
    if (idx === overlayStack.length - 1) {
      history.back();
    } else {
      overlayStack.splice(idx, 1);
      document.getElementById(id).style.display = 'none';
    }
  } else {
    document.getElementById(id).style.display = 'none';
  }
  syncOverlayClass();
}
window.addEventListener('popstate', (e) => {
  if (overlayStack.length) {
    const id = overlayStack.pop();
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    // 关闭详情页时重置状态
    if (id === 'detail-view') {
      replyToUser = null;
      currentDetailPostId = null;
    }
    if (id === 'user-page') {
      currentUserPageId = null;
    }
    // 如果栈里还有上一个弹窗，重新显示它
    if (overlayStack.length) {
      const prev = overlayStack[overlayStack.length - 1];
      const prevEl = document.getElementById(prev);
      if (prevEl) prevEl.style.display = (prev === 'user-page') ? 'block' : 'flex';
    } else {
      // 弹窗全部关闭，恢复页面滚动
      document.body.style.overflow = '';
    }
    syncOverlayClass();
  }
  // 如果有关闭后要打开的日记，现在打开
  if (pendingOpenPost) {
    const postId = pendingOpenPost;
    pendingOpenPost = null;
    viewPost(postId);
  }
});

// ---- 写入队列：防止并发写入冲突 ----
// posts.json 写入队列
let postsWriteChain = Promise.resolve();
function enqueuePostsWrite(operation) {
  postsWriteChain = postsWriteChain.then(async () => {
    try {
      const { content, sha } = await ghGetFile('data/posts.json');
      const modified = await operation(content || []);
      const r = await ghPutFile('data/posts.json', modified, sha);
      if (r && r.content && r.content.sha) postsShaCache = r.content.sha;
      allPostsCache = modified;
    } catch (e) {
      console.error('posts写入失败', e);
    }
  });
  return postsWriteChain;
}

// notifications.json 写入队列
let notifsWriteChain = Promise.resolve();
function enqueueNotifsWrite(operation) {
  notifsWriteChain = notifsWriteChain.then(async () => {
    try {
      const { content, sha } = await ghGetFile('data/notifications.json');
      const modified = await operation(content || []);
      const r = await ghPutFile('data/notifications.json', modified, sha);
      if (r && r.content && r.content.sha) notifsShaCache = r.content.sha;
      notifsCache = modified;
    } catch (e) {
      console.error('notifications写入失败', e);
    }
  });
  return notifsWriteChain;
}

function setUser(u) {
  currentUser = u;
  localStorage.setItem('mlyz_user', JSON.stringify(u));
}

function logout() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  stopMusic();
  stopCurrentVoice();
  stopRecording();
  currentUser = null;
  localStorage.removeItem('mlyz_user');
  showAuth();
}

// ---- Registration ----
async function doRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const invite = document.getElementById('reg-invite').value.trim().toUpperCase();

  if (!username || !email || !password || !invite) {
    alert('请填写所有字段');
    return;
  }
  if (password.length < 6) {
    alert('密码至少 6 位');
    return;
  }

  try {
    // 1. Check invite code
    const { content: invites, sha: inviteSha } = await ghGetFile('data/invites.json');
    const inviteObj = invites.find(i => i.code === invite && !i.used_by);
    if (!inviteObj) {
      alert('邀请码无效或已被使用');
      return;
    }
    // 检查是否过期
    if (!inviteObj.createdAt || (Date.now() - inviteObj.createdAt) > INVITE_TTL) {
      alert('邀请码已过期，请让朋友重新生成');
      return;
    }

    // 2. Check username unique
    const { content: users, sha: usersSha } = await ghGetFile('data/users.json');
    if (users.find(u => u.username === username)) {
      alert('昵称已被使用');
      return;
    }

    // 3. Create user
    const newUser = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      username,
      email,
      password: await hashPwd(password),
      avatar: null,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    await ghPutFile('data/users.json', users, usersSha);

    // 4. Redeem invite
    inviteObj.used_by = newUser.id;
    inviteObj.used_at = new Date().toISOString();
    await ghPutFile('data/invites.json', invites, inviteSha);

    // 5. Auto-login
    setUser({ id: newUser.id, username: newUser.username, avatar: null, email: newUser.email, cover: null, bio: '' });
    showApp();
    showToast('✅ 注册成功！');
  } catch (e) {
    alert('注册失败：' + e.message);
    console.error(e);
  }
}

// ---- Login ----
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    alert('请填写用户名和密码');
    return;
  }

  try {
    const { content: users } = await ghGetFile('data/users.json');
    const user = users.find(u => u.username === username);
    if (!user) {
      alert('用户不存在');
      return;
    }
    const hashed = await hashPwd(password);
    if (user.password !== hashed) {
      alert('密码错误');
      return;
    }
    setUser({ id: user.id, username: user.username, avatar: user.avatar || null, email: user.email, cover: user.cover || null, bio: user.bio || '' });
    showApp();
    showToast('✅ 登录成功！');
  } catch (e) {
    alert('登录失败：' + e.message);
    console.error(e);
  }
}

// ---- Post visibility helpers ----
function canViewPost(post, viewerId) {
  if (post.authorId === viewerId) return true;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'friends') {
    return isFriend(post.authorId, viewerId);
  }
  if (post.visibility === 'selected') {
    return post.selectedFriends && post.selectedFriends.includes(viewerId);
  }
  return false; // private
}

let friendshipsCache = [];
async function loadFriendships() {
  const { content } = await ghGetFile('data/friendships.json');
  friendshipsCache = content || [];
}

function isFriend(a, b) {
  return friendshipsCache.some(f =>
    (f.user1 === a && f.user2 === b) || (f.user1 === b && f.user2 === a)
  );
}

// ---- Load posts for feed ----
// ---- Manage mode (multi-select delete) ----
let manageMode = false;
let selectedPostIds = new Set();
let allPostsCache = [];
let postsShaCache = null;
let notifsCache = [];
let notifsShaCache = null;

function enterManageMode() {
  manageMode = true;
  selectedPostIds.clear();
  document.getElementById('feed-manage-bar').style.display = 'block';
  document.getElementById('btn-manage').style.display = 'none';
  loadPosts();
}

function exitManageMode() {
  manageMode = false;
  selectedPostIds.clear();
  document.getElementById('feed-manage-bar').style.display = 'none';
  document.getElementById('btn-manage').style.display = 'inline-block';
  loadPosts();
}

function toggleSelectAll() {
  const ownPosts = allPostsCache.filter(p => p.authorId === currentUser.id);
  if (selectedPostIds.size === ownPosts.length) {
    selectedPostIds.clear();
  } else {
    selectedPostIds = new Set(ownPosts.map(p => p.id));
  }
  renderFeed(allPostsCache);
}

function toggleSelectPost(id) {
  if (selectedPostIds.has(id)) {
    selectedPostIds.delete(id);
  } else {
    selectedPostIds.add(id);
  }
}

async function deleteSelected() {
  if (selectedPostIds.size === 0) {
    alert('请先选择要删除的日记');
    return;
  }
  if (!confirm(`确定删除选中的 ${selectedPostIds.size} 篇日记吗？\n（删除后会在云端回收站保留 30 天）`)) return;

  const ids = new Set(selectedPostIds);
  if (musicState.kind === 'post' && ids.has(musicState.id)) stopMusic();
  const toDelete = allPostsCache.filter(p => ids.has(p.id));

  // 立即更新界面，不等待网络
  allPostsCache = allPostsCache.filter(p => !ids.has(p.id));
  selectedPostIds.clear();
  manageMode = false;
  document.getElementById('feed-manage-bar').style.display = 'none';
  document.getElementById('btn-manage').style.display = 'inline-block';
  renderFeed(allPostsCache);
  showToast('🗑️ 已删除（正在同步云端）');

  // 后台写入云端，用户无需等待
  (async () => {
    try {
      const { content: trash, sha: trashSha } = await ghGetFile('data/trash.json');
      const trashList = trash || [];
      const now = new Date().toISOString();
      toDelete.forEach(p => {
        trashList.push({ ...p, deletedAt: now });
      });
      // 清理超过 30 天的
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const cleaned = trashList.filter(t => new Date(t.deletedAt).getTime() > cutoff);
      await ghPutFile('data/trash.json', cleaned, trashSha);
    } catch (e) {
      console.error('回收站写入失败', e);
    }
    await enqueuePostsWrite((serverPosts) => {
      return serverPosts.filter(p => !ids.has(p.id));
    });
  })();
}

function feedCacheKey() {
  return 'mlyz_feed_cache_' + currentUser.id;
}

// 打开时先显示上次动态，网络请求在后台更新，不再白屏等待
function renderCachedFeed() {
  if (!currentUser) return;
  try {
    const posts = JSON.parse(localStorage.getItem(feedCacheKey()) || 'null');
    if (!Array.isArray(posts) || !posts.length) return;
    allPostsCache = posts;
    const visible = posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderFeed(visible);
  } catch (e) { /* 缓存损坏时直接走网络 */ }
}

function saveFeedCache(visiblePosts) {
  if (!currentUser) return;
  try {
    localStorage.setItem(feedCacheKey(), JSON.stringify(visiblePosts.slice(0, 100)));
  } catch (e) { /* 存储空间不足不影响使用 */ }
}

async function loadPosts() {
  if (!currentUser) return;
  try {
    const [{ content: posts, sha }] = await Promise.all([
      ghGetFile('data/posts.json'),
      loadFriendships()
    ]);
    allPostsCache = posts || [];
    postsShaCache = sha;
    const visible = (posts || []).filter(p => canViewPost(p, currentUser.id));
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderFeed(visible);
    saveFeedCache(visible);
  } catch (e) {
    // 已显示的缓存继续保留，避免因一次网络失败清空动态
    console.error('动态加载失败', e);
  }
}

let lastFeedSig = '';
function renderFeed(posts) {
  lastFeedSig = JSON.stringify(posts);
  const container = document.getElementById('feed');

  if (manageMode) {
    // 只显示自己的日记供选择删除
    const ownPosts = posts.filter(p => p.authorId === currentUser.id);
    if (!ownPosts.length) {
      container.innerHTML = '<p style="text-align:center;color:#999;padding:40px 0;">你还没有日记</p>';
      return;
    }
    container.innerHTML = ownPosts.map(p => `
      <div class="post-card-manage">
        <input type="checkbox" ${selectedPostIds.has(p.id) ? 'checked' : ''} onchange="toggleSelectPost('${p.id}')">
        <div class="mini-preview">
          <div class="mp-author">${escapeHtml(p.authorName)} ${visLabel(p.visibility)}</div>
          <div class="mp-text">${escapeHtml(p.text || '(无文字)')}</div>
          <div class="mp-time">${formatTime(p.createdAt)}</div>
        </div>
      </div>
    `).join('');
    return;
  }

  if (!posts.length) {
    container.innerHTML = '<p style="text-align:center;color:#999;padding:40px 0;">还没有日记哦～ 去发布第一篇吧！</p>';
    return;
  }
  container.innerHTML = posts.map(p => {
    const liked = (p.likes || []).includes(currentUser.id);
    const likeCount = (p.likes || []).length;
    const commentCount = (p.comments || []).length;
    return `
    <div class="post-card" onclick="viewPost('${p.id}')">
      <div class="post-header">
        ${getAvatarHtml(p.authorName, p.authorAvatar, p.authorId)}
        <div style="flex:1;">
          <span class="post-author" onclick="event.stopPropagation();${p.authorId ? `openUserPage('${p.authorId}')` : ''}" ${p.authorId ? 'style="cursor:pointer;"' : ''}>${escapeHtml(p.authorName)}</span>
          <span class="post-vis">${visLabel(p.visibility)}</span>
        </div>
      </div>
      ${mediaListHtml(p, 'post')}
      ${voiceBarHtml(p)}
      ${musicBarHtml(p)}
      ${postTextHtml(p)}
      ${postMetaHtml(p)}
      ${p.location ? `<div class="post-loc">📍 ${escapeHtml(locText(p.location))}</div>` : ''}
      <div class="post-time">${postTimeHtml(p)}</div>
      <div class="post-actions">
        <span class="action-btn-like ${liked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike('${p.id}')">
          ${liked ? '❤️' : '🤍'} ${likeCount}
        </span>
        <span class="action-btn-comment" onclick="event.stopPropagation();viewPost('${p.id}')">
          💬 ${commentCount}
        </span>
      </div>
    </div>
  `;}).join('');
  syncMusicButtons(); syncVoiceButtons();
}

function getAvatarHtml(name, avatarUrl, userId) {
  let inner;
  if (avatarUrl) {
    inner = `<img src="${mediaCdnUrl(avatarUrl)}"${imgFallbackAttr(avatarUrl)} decoding="async" data-zoom="${avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;margin-right:10px;flex-shrink:0;cursor:zoom-in;">`;
  } else {
    // 默认头像：昵称首字 + 渐变背景
    const initial = (name || '?').charAt(0).toUpperCase();
    const colors = ['#667eea','#764ba2','#f093fb','#4facfe','#43e97b','#fa709a','#fee140','#30cfd0'];
    const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
    inner = `<div style="width:36px;height:36px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;margin-right:10px;flex-shrink:0;">${escapeHtml(initial)}</div>`;
  }
  if (!userId) return inner;
  // 有头像时点头像看全图（全局委托处理）；没有头像时点默认头像仍进入个人主页
  if (avatarUrl) return `<span style="display:inline-flex;flex-shrink:0;">${inner}</span>`;
  return `<span onclick="event.stopPropagation();openUserPage('${userId}')" style="display:inline-flex;cursor:pointer;flex-shrink:0;">${inner}</span>`;
}

function visLabel(v) {
  return { private: '🔒 仅自己', friends: '👥 好友', selected: '👉 指定好友', public: '🌐 公开' }[v] || v;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

function formatTime(t) {
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth()+1}月${d.getDate()}日`;
  const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`;
}

// 编辑时间：同日只显示时分，跨天带上日期
function formatEditTime(t, createdAt) {
  const d = new Date(t);
  const c = new Date(createdAt);
  const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const md = sameYear ? `${d.getMonth()+1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  return d.toDateString() === c.toDateString() ? hm : `${md} ${hm}`;
}

// 发布时间 + 每次编辑时间
function postTimeHtml(p) {
  const base = formatTime(p.createdAt);
  const edits = Array.isArray(p.editedAt) ? p.editedAt : [];
  if (!edits.length) return base;
  return `${base} · 编辑于 ${edits.map(t => formatEditTime(t, p.createdAt)).join('、')}`;
}

// ---- View post detail ----
async function viewPost(id) {
  currentDetailPostId = id;
  // 优先用缓存，没有再请求 GitHub
  const cached = allPostsCache.find(p => p.id === id);
  if (cached) {
    if (!canViewPost(cached, currentUser.id)) { alert('无权查看'); return; }
    renderPostDetail(id);
    document.getElementById('detail-view').style.display = 'flex';
    openOverlay('detail-view');
    // 后台静默刷新最新数据
    (async () => {
      try {
        const { content: posts, sha } = await ghGetFile('data/posts.json');
        allPostsCache = posts || [];
        postsShaCache = sha;
        renderPostDetail(id);
      } catch (e) { console.error('刷新详情失败', e); }
    })();
    return;
  }
  const { content: posts, sha } = await ghGetFile('data/posts.json');
  allPostsCache = posts || [];
  postsShaCache = sha;
  const post = posts.find(p => p.id === id);
  if (!post) return;
  if (!canViewPost(post, currentUser.id)) { alert('无权查看'); return; }
  renderPostDetail(id);
  document.getElementById('detail-view').style.display = 'flex';
  openOverlay('detail-view');
}

// ---- 点赞（乐观更新） ----
async function toggleLike(postId) {
  const post = allPostsCache.find(p => p.id === postId);
  if (!post) return;
  post.likes = post.likes || [];
  const liked = post.likes.includes(currentUser.id);
  // 乐观更新：立即改本地缓存并刷新界面
  if (liked) {
    post.likes = post.likes.filter(uid => uid !== currentUser.id);
  } else {
    post.likes.push(currentUser.id);
  }
  const wasLiked = !liked;
  refreshPostViews();
  // 通过队列同步到 GitHub（防止并发冲突）
  enqueuePostsWrite((serverPosts) => {
    const serverPost = serverPosts.find(p => p.id === postId);
    if (serverPost) {
      serverPost.likes = serverPost.likes || [];
      if (wasLiked && !serverPost.likes.includes(currentUser.id)) {
        serverPost.likes.push(currentUser.id);
      } else if (!wasLiked) {
        serverPost.likes = serverPost.likes.filter(uid => uid !== currentUser.id);
      }
      // 点赞通知（不给自己发）
      if (wasLiked && serverPost.authorId !== currentUser.id) {
        addNotification({
          userId: serverPost.authorId,
          type: 'like',
          fromUserId: currentUser.id,
          fromUsername: currentUser.username,
          postId: serverPost.id,
          postText: serverPost.text
        });
      }
    }
    return serverPosts;
  });
}

// 刷新动态列表和详情页（不重新请求 GitHub）
function refreshPostViews() {
  const visible = allPostsCache.filter(p => canViewPost(p, currentUser.id));
  visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderFeed(visible);
  if (document.getElementById('detail-view').style.display === 'flex' && currentDetailPostId) {
    renderPostDetail(currentDetailPostId);
  }
}

// 清除单条动态的位置（仅作者本人）
function removePostLocation(postId) {
  const post = (allPostsCache || []).find(p => p.id === postId);
  if (!post) return;
  if (post.authorId !== currentUser.id) return;
  if (!confirm('确定清除这条动态的位置吗？')) return;
  post.location = null;
  renderFeed(allPostsCache.filter(p => canViewPost(p, currentUser.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  renderPostDetail(postId);
  showToast('已清除位置');
  enqueuePostsWrite(posts => {
    const t = posts.find(p => p.id === postId);
    if (t) t.location = null;
    return posts;
  });
}

// 用缓存渲染详情页（不请求 GitHub）
function renderPostDetail(id) {
  const post = allPostsCache.find(p => p.id === id);
  if (!post) return;
  if (!canViewPost(post, currentUser.id)) { alert('无权查看'); return; }
  const liked = (post.likes || []).includes(currentUser.id);
  const comments = post.comments || [];
  document.getElementById('detail-content').innerHTML = `
    <div class="detail-header">
      ${getAvatarHtml(post.authorName, post.authorAvatar, post.authorId)}
      <div style="flex:1;">
        <span class="post-author" onclick="openUserPage('${post.authorId}')" style="cursor:pointer;">${escapeHtml(post.authorName)}</span>
        <span class="post-vis">${visLabel(post.visibility)}</span>
      </div>
    </div>
    ${getPostMedia(post).map(m => mediaHtml(m, 'detail')).join('')}
    ${voiceBarHtml(post)}
    ${musicBarHtml(post)}
    <p class="detail-text">${escapeHtml(post.text)}</p>
    ${postMetaHtml(post)}
    ${post.location ? `<div class="post-loc">📍 ${escapeHtml(locText(post.location))}${post.authorId === currentUser.id ? ` <button class="loc-clear" onclick="removePostLocation('${post.id}')">清除位置</button>` : ''}</div>` : ''}
    <div class="post-time">${postTimeHtml(post)}</div>
    <div class="post-actions" style="margin:12px 0;">
      <span class="action-btn-like ${liked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
        ${liked ? '❤️' : '🤍'} ${(post.likes || []).length}
      </span>
      <span class="action-btn-comment">💬 ${comments.length}</span>
      ${post.authorId === currentUser.id ? `<span class="action-btn-comment" onclick="startEditPost('${post.id}')">✏️ 编辑</span>` : ''}
    </div>
    <div class="comment-section">
      <h4 style="font-size:14px;color:#666;margin-bottom:10px;">评论 (${comments.length})</h4>
      ${comments.length ? comments.map(c => `
        <div class="comment-item" onclick="replyToComment('${c.userId}','${escapeHtml(c.username).replace(/'/g, "\\'")}')">
          ${getAvatarHtml(c.username, c.avatar, c.userId)}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#333;">
              <span onclick="event.stopPropagation();openUserPage('${c.userId}')" style="cursor:pointer;">${escapeHtml(c.username)}</span>
              ${c.userId === post.authorId ? '<span style="font-size:10px;background:#6c5ce7;color:#fff;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:normal;">作者</span>' : ''}
              ${c.userId === currentUser.id ? '<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:normal;">我</span>' : ''}
            </div>
            <div style="font-size:14px;color:#444;margin:2px 0;word-break:break-word;">
              ${c.replyToUsername ? `<span style="color:#6c5ce7;font-size:12px;">回复 @${escapeHtml(c.replyToUsername)}：</span>` : ''}
              ${escapeHtml(c.text)}
            </div>
            <div style="font-size:11px;color:#999;">${formatTime(c.createdAt)} <span style="color:#bbb;">· 点击回复</span></div>
          </div>
        </div>
      `).join('') : '<p style="color:#999;font-size:13px;text-align:center;padding:10px;">还没有评论，来抢沙发吧～</p>'}
      <div class="comment-input-row" id="reply-bar" style="${replyToUser ? 'display:flex;' : 'display:none;'}">
        <span style="font-size:12px;color:#6c5ce7;margin-right:6px;">回复 @${replyToUser ? escapeHtml(replyToUser.username) : ''}</span>
        <button onclick="cancelReply()" style="font-size:12px;color:#999;background:none;border:none;cursor:pointer;margin-right:8px;">✕</button>
      </div>
      <div class="comment-input-row">
        <input type="text" id="comment-input" placeholder="${replyToUser ? '回复 @' + escapeHtml(replyToUser.username) + '...' : '说点什么...'}" style="flex:1;padding:10px;border:1px solid #eee;border-radius:20px;outline:none;" onkeydown="if(event.key==='Enter')addComment('${post.id}')">
        <button onclick="addComment('${post.id}')" style="margin-left:8px;padding:10px 16px;background:#6c5ce7;color:#fff;border:none;border-radius:20px;cursor:pointer;">发送</button>
      </div>
    </div>
    <button onclick="closeDetail()" class="btn-secondary">返回</button>
  `;
  syncMusicButtons(); syncVoiceButtons();
}

// ---- 评论（乐观更新） ----
async function addComment(postId) {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  const post = allPostsCache.find(p => p.id === postId);
  if (!post) return;
  post.comments = post.comments || [];
  const comment = {
    id: 'c_' + Date.now(),
    userId: currentUser.id,
    username: currentUser.username,
    avatar: currentUser.avatar || null,
    text,
    createdAt: new Date().toISOString()
  };
  if (replyToUser) {
    comment.replyToUserId = replyToUser.userId;
    comment.replyToUsername = replyToUser.username;
  }
  post.comments.push(comment);
  const savedReplyTo = replyToUser;
  replyToUser = null;
  input.value = '';
  // 乐观刷新界面
  refreshPostViews();
  // 通过队列同步到 GitHub（防止并发冲突）
  enqueuePostsWrite((serverPosts) => {
    const serverPost = serverPosts.find(p => p.id === postId);
    if (serverPost) {
      serverPost.comments = serverPost.comments || [];
      serverPost.comments.push(comment);
    }
    return serverPosts;
  }).then(() => {
    // 写入完成后发通知
    if (post.authorId !== currentUser.id) {
      addNotification({
        userId: post.authorId,
        type: 'comment',
        fromUserId: currentUser.id,
        fromUsername: currentUser.username,
        postId: post.id,
        postText: post.text,
        commentText: text
      });
    }
    if (savedReplyTo && savedReplyTo.userId !== currentUser.id && savedReplyTo.userId !== post.authorId) {
      addNotification({
        userId: savedReplyTo.userId,
        type: 'comment',
        fromUserId: currentUser.id,
        fromUsername: currentUser.username,
        postId: post.id,
        postText: post.text,
        commentText: `回复了你：${text}`
      });
    }
  });
}

function replyToComment(userId, username) {
  replyToUser = { userId, username };
  // 直接更新回复提示和输入框，不重新渲染整个详情页
  const replyBar = document.getElementById('reply-bar');
  const input = document.getElementById('comment-input');
  if (replyBar) {
    const span = replyBar.querySelector('span');
    if (span) span.textContent = '回复 @' + username;
    replyBar.style.display = 'flex';
  }
  if (input) {
    input.placeholder = '回复 @' + username + '...';
    // 同步聚焦（必须在点击事件内直接调用，不能用 setTimeout，否则 iOS 不弹键盘）
    input.focus();
  }
}

function cancelReply() {
  replyToUser = null;
  viewPost(currentDetailPostId);
}

// ---- 通知 ----
function addNotification({ userId, type, fromUserId, fromUsername, postId, postText, commentText }) {
  const newNotif = {
    id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 4),
    userId,
    type,
    fromUserId,
    fromUsername,
    postId,
    postText: (postText || '').slice(0, 30),
    commentText: commentText || '',
    read: false,
    createdAt: new Date().toISOString()
  };
  // 更新本地缓存
  notifsCache.push(newNotif);
  // 通过队列写入 GitHub（防止并发冲突）
  enqueueNotifsWrite((list) => {
    list.push(newNotif);
    return list.slice(-200);
  });
}

async function loadNotifications() {
  // 优先用缓存渲染（秒开），后台再刷新
  renderNotifications();
  (async () => {
    try {
      const { content: notifs, sha } = await ghGetFile('data/notifications.json');
      notifsCache = notifs || [];
      notifsShaCache = sha;
      renderNotifications();
    } catch (e) { console.error('刷新通知失败', e); }
  })();
}

function renderNotifications() {
  const list = notifsCache.filter(n => n.userId === currentUser.id);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // 更新底部角标
  const unreadCount = list.filter(n => !n.read).length;
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
  const container = document.getElementById('notifications-list');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:10px;">暂无消息</p>';
    return;
  }
  const maxShow = 6;
  const showAll = list.length <= maxShow || notifExpanded;
  const visible = showAll ? list : list.slice(0, maxShow);
  const toggleBtn = list.length > maxShow
    ? `<div onclick="toggleNotifExpand()" style="text-align:center;padding:10px;font-size:13px;color:#6c5ce7;cursor:pointer;">${showAll ? '收起 ▲' : `展开全部 ${list.length} 条 ▼`}</div>`
    : '';
  container.innerHTML = visible.map(n => {
    const icon = n.type === 'like' ? '❤️' : '💬';
    const action = n.type === 'like' ? '赞了你的日记' : `评论：${n.commentText}`;
    return `<div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead('${n.id}')">
      <span class="notif-icon">${icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;"><b>${escapeHtml(n.fromUsername)}</b> ${action}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">📝 ${escapeHtml(n.postText)} · ${formatTime(n.createdAt)}</div>
      </div>
      ${n.read ? '' : '<span class="red-dot"></span>'}
    </div>`;
  }).join('') + toggleBtn;
}

async function markNotifRead(notifId) {
  const n = notifsCache.find(x => x.id === notifId);
  const postId = n ? n.postId : null;
  // 乐观更新：立即标记已读并刷新界面
  if (n && !n.read) {
    n.read = true;
    renderNotifications();
  }
  // 打开日记（用缓存，秒开）
  if (postId) viewPost(postId);
  // 通过队列同步到 GitHub
  enqueueNotifsWrite((list) => {
    const target = list.find(x => x.id === notifId);
    if (target) target.read = true;
    return list;
  });
}

function closeDetail() {
  closeOverlay('detail-view');
}

// ---- 个人主页 ----
let currentUserPageId = null;

async function openUserPage(userId) {
  currentUserPageId = userId;
  // 先用本地缓存秒开
  let user = allUsersCache.find(u => u.id === userId);
  let visible = allPostsCache
    .filter(p => p.authorId === userId && canViewPost(p, currentUser.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderUserPage(userId, user, visible);
  document.getElementById('user-page').style.display = 'block';
  openOverlay('user-page');

  // 后台刷新用户信息和动态
  try {
    const [{ content: users }, { content: posts }] = await Promise.all([
      ghGetFile('data/users.json'),
      ghGetFile('data/posts.json')
    ]);
    if (users) allUsersCache = users;
    if (posts) allPostsCache = posts;
    user = allUsersCache.find(u => u.id === userId);
    visible = allPostsCache
      .filter(p => p.authorId === userId && canViewPost(p, currentUser.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // 只更新当前仍打开的这个主页
    if (currentUserPageId === userId && overlayStack.includes('user-page')) {
      renderUserPage(userId, user, visible);
    }
  } catch (e) {
    console.error('主页刷新失败', e);
  }
}

function renderUserPage(userId, user, posts) {
  const name = user ? user.username : '未知用户';
  const bio = user ? (user.bio || '') : '';
  const cover = user ? user.cover : null;
  const isMe = userId === currentUser.id;
  const coverStyle = cover
    ? `background-image:url('${mediaPagesUrl(cover)}');background-size:cover;background-position:center;`
    : 'background:linear-gradient(135deg,#a78bfa,#7c3aed);';
  const avatarHtml = (user && user.avatar)
    ? `<img src="${mediaCdnUrl(user.avatar)}"${imgFallbackAttr(user.avatar)} decoding="async" data-zoom="${user.avatar}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid #fff;background:#eee;cursor:zoom-in;">`
    : `<div style="width:72px;height:72px;border-radius:50%;border:3px solid #fff;background:#a78bfa;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:600;">${escapeHtml((name || '?').charAt(0).toUpperCase())}</div>`;

  document.getElementById('user-page-content').innerHTML = `
    <div style="${coverStyle}height:220px;position:relative;margin-top:0;"${cover ? ` data-zoom="${cover}"` : ''}>
      <button onclick="closeUserPage()" style="position:absolute;top:calc(10px + env(safe-area-inset-top));left:10px;background:rgba(0,0,0,.35);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:17px;line-height:1;">‹</button>
      ${isMe ? `<button onclick="closeUserPage();openProfileModal()" style="position:absolute;top:calc(10px + env(safe-area-inset-top));right:10px;background:rgba(0,0,0,.35);color:#fff;border:none;border-radius:14px;padding:5px 12px;cursor:pointer;font-size:12px;">编辑</button>` : ''}
    </div>
    <div style="padding:0 16px 16px;position:relative;">
      <div style="margin-top:-36px;">${avatarHtml}</div>
      <div style="font-size:18px;font-weight:700;color:#333;margin-top:8px;">${escapeHtml(name)}</div>
      <div style="font-size:13px;color:#666;margin-top:6px;white-space:pre-wrap;line-height:1.6;">${bio ? escapeHtml(bio) : (isMe ? '还没有自我介绍，点右上角「编辑」填写吧～' : 'Ta好像什么都不想说')}</div>
      <div style="font-size:13px;color:#999;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">TA 的动态 (${posts.length})</div>
      <div style="margin-top:10px;">
        ${posts.length ? posts.map(p => `
          <div class="post-card" onclick="viewPost('${p.id}')" style="margin-bottom:10px;">
            ${mediaListHtml(p, 'post')}
            ${voiceBarHtml(p)}
      ${musicBarHtml(p)}
            ${postTextHtml(p)}
            ${postMetaHtml(p)}
            <div class="post-time">${postTimeHtml(p)}</div>
          </div>
        `).join('') : '<p style="color:#999;text-align:center;padding:20px;">还没有动态</p>'}
      </div>
      <button onclick="closeUserPage()" class="btn-secondary" style="margin-top:12px;">返回</button>
    </div>
  `;
  syncMusicButtons(); syncVoiceButtons();
}

function closeUserPage() {
  currentUserPageId = null;
  closeOverlay('user-page');
}

function openMyUserPage() {
  if (currentUser) openUserPage(currentUser.id);
}

let notifExpanded = false;
function toggleNotifExpand() {
  notifExpanded = !notifExpanded;
  renderNotifications();
}

// ---- Publish ----
let pendingMedia = []; // { kind:'image'|'video', data, name, mime, live, sound }

function pendingMediaThumb(m) {
  if (m.thumb) {
    const t = String(m.thumb);
    return /^(https?:|data:)/.test(t) ? mediaPagesUrl(t) : `data:image/jpeg;base64,${t}`;
  }
  if (m.kind === 'image' && m.data) return `data:${m.mime};base64,${m.data}`;
  if (m.poster) return mediaPagesUrl(m.poster);
  return '';
}

function renderPendingMedia() {
  const box = document.getElementById('media-preview');
  if (!box) return;
  pendingMedia.forEach(m => { if (!m.key) m.key = 'k' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); });
  box.innerHTML = pendingMedia.map((m, i) => {
    const thumb = pendingMediaThumb(m);
    return `
    <div class="media-item" data-key="${m.key}" data-index="${i}" onclick="previewPendingMedia(${i})">
      ${thumb
        ? `<img src="${thumb}" style="width:88px;height:88px;border-radius:10px;object-fit:cover;display:block;cursor:zoom-in;pointer-events:none;">`
        : `<div style="width:88px;height:88px;border-radius:10px;background:#2b2140;color:#cfc6ff;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:zoom-in;">${m.kind === 'video' ? '🎬 视频' : '🖼️ 图片'}</div>`}
      <button onclick="event.stopPropagation();removePendingMedia(${i})" style="position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(255,71,87,0.95);color:#fff;font-size:12px;line-height:22px;padding:0;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.35);">✕</button>
      ${m.kind === 'video' && m.live ? '<span class="live-badge" style="top:auto;bottom:3px;left:3px;font-size:10px;padding:1px 6px;">实况</span>' : ''}
    </div>
  `;
  }).join('');
  initMediaDrag();
}

// ---- 长按拖动排序 ----
let dragCtx = null;
let suppressMediaTap = false;

function initMediaDrag() {
  const box = document.getElementById('media-preview');
  if (!box || box.dataset.dragReady) return;
  box.dataset.dragReady = '1';
  box.addEventListener('pointerdown', onMediaPointerDown);
  window.addEventListener('pointermove', onMediaPointerMove, { passive: false });
  window.addEventListener('pointerup', endMediaDrag);
  window.addEventListener('pointercancel', endMediaDrag);
  window.addEventListener('touchmove', e => {
    if (dragCtx && dragCtx.active) e.preventDefault();
  }, { passive: false });
  box.addEventListener('click', e => {
    if (!suppressMediaTap) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function onMediaPointerDown(e) {
  if (e.button > 0) return;
  const item = e.target.closest('.media-item');
  if (!item || e.target.closest('button')) return;
  dragCtx = {
    item,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    timer: setTimeout(() => {
      if (!dragCtx) return;
      dragCtx.active = true;
      dragCtx.item.classList.add('dragging');
      const box = document.getElementById('media-preview');
      if (box) box.classList.add('drag-active');
      suppressMediaTap = true;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
    }, 380)
  };
}

function onMediaPointerMove(e) {
  const ctx = dragCtx;
  if (!ctx) return;
  if (!ctx.active) {
    if (Math.abs(e.clientX - ctx.startX) > 10 || Math.abs(e.clientY - ctx.startY) > 10) {
      clearTimeout(ctx.timer);
      dragCtx = null;
    }
    return;
  }
  e.preventDefault();
  const box = document.getElementById('media-preview');
  if (!box) return;
  const others = Array.from(box.querySelectorAll('.media-item')).filter(el => el !== ctx.item);
  const target = others.find(el => {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (!target) return;
  const r = target.getBoundingClientRect();
  const before = e.clientX < r.left + r.width / 2;
  box.insertBefore(ctx.item, before ? target : target.nextSibling);
}

function endMediaDrag() {
  const ctx = dragCtx;
  dragCtx = null;
  if (!ctx) return;
  clearTimeout(ctx.timer);
  if (!ctx.active) return;
  ctx.item.classList.remove('dragging');
  const box = document.getElementById('media-preview');
  if (box) box.classList.remove('drag-active');
  const keys = Array.from((box || document).querySelectorAll('.media-item')).map(el => el.dataset.key);
  const map = new Map(pendingMedia.map(m => [m.key, m]));
  const reordered = keys.map(k => map.get(k)).filter(Boolean);
  if (reordered.length === pendingMedia.length) {
    pendingMedia = reordered;
    renderPendingMedia();
  }
  setTimeout(() => { suppressMediaTap = false; }, 60);
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
}

function previewPendingMedia(i) {
  const m = pendingMedia[i];
  if (!m) return;
  const viewer = document.getElementById('media-viewer');
  const content = document.getElementById('media-viewer-content');
  if (!viewer || !content) return;
  if (m.kind === 'image') {
    const src = m.data ? `data:${m.mime};base64,${m.data}` : mediaPagesUrl(m.url || m.thumb || '');
    content.innerHTML = `<img src="${src}" style="max-width:100%;max-height:90vh;border-radius:8px;object-fit:contain;">`;
  } else {
    const src = m.data ? `data:${m.mime};base64,${m.data}` : mediaPagesUrl(m.url || '');
    content.innerHTML = `<video src="${src}" controls autoplay playsinline webkit-playsinline style="max-width:100%;max-height:90vh;border-radius:8px;background:#000;"></video>`;
  }
  viewer.style.display = 'flex';
}

function closeMediaViewer() {
  const viewer = document.getElementById('media-viewer');
  const content = document.getElementById('media-viewer-content');
  if (!viewer) return;
  viewer.style.display = 'none';
  if (content) {
    const v = content.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); }
    content.innerHTML = '';
    content.style.width = '';
    content.style.height = '';
  }
}

function removePendingMedia(i) {
  const m = pendingMedia[i];
  if (m && m.key) { idbDel('m_' + m.key); draftSavedBlobs.delete(m.key); }
  pendingMedia.splice(i, 1);
  renderPendingMedia();
  scheduleDraftSave();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- 本地音乐导入与全局单播放器 ----
// 音乐：上传音频到仓库，动态里可播放；歌名取文件名
let pendingMusic = null; // { name, title, data, duration, previewUrl, url }
let musicAudio = null;
let musicPlayOp = 0;
const musicState = { kind: null, id: null, sources: [], sourceIndex: 0, loading: false };

function formatMusicDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---- 语音录音 ----
let pendingVoice = null; // { data, mime, duration, name, url, previewUrl }
let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let voiceStartTime = 0;
let voicePreviewAudio = null;
let voicePlayOp = 0;
const voiceState = { kind: null, id: null, sources: [], sourceIndex: 0, loading: false };
let currentPlayingVoiceId = null; // 当前正在播放的动态语音 id
let currentVoiceAudio = null;

// 根据浏览器支持选择最优音频 MIME
function pickAudioMime() {
  const list = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mp3'
  ];
  for (const t of list) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return '';
}

function startRecording() {
  // 正在录音 → 停止
  if (voiceRecorder && voiceRecorder.state === 'recording') {
    stopRecording();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('当前浏览器不支持录音，请在 iPhone Safari 中打开');
    return;
  }
  if (!window.MediaRecorder) { showToast('当前浏览器不支持录音'); return; }
  if (pendingVoice && pendingVoice.previewUrl) URL.revokeObjectURL(pendingVoice.previewUrl);
  voiceChunks = [];
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    voiceStream = stream;
    const mime = pickAudioMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    voiceRecorder = rec;
    voiceStartTime = Date.now();
    rec.ondataavailable = e => { if (e.data && e.data.size > 0) voiceChunks.push(e.data); };
    rec.onstop = onVoiceStopped;
    rec.onerror = () => { showToast('录音过程出错，请重试'); stopRecording(); };
    rec.start();
    const btn = document.getElementById('btn-voice-record');
    if (btn) { btn.classList.add('recording'); btn.textContent = '⏹ 停止录音'; }
    showToast('正在录音…');
  }).catch(err => {
    console.error('录音失败', err);
    showToast('无法录音：' + (err && err.message ? err.message : '请检查麦克风权限'));
  });
}

function stopRecording() {
  if (voiceRecorder && voiceRecorder.state !== 'inactive') {
    try { voiceRecorder.stop(); } catch (e) {}
  }
  if (voiceStream) { try { voiceStream.getTracks().forEach(t => t.stop()); } catch (e) {} voiceStream = null; }
}

async function onVoiceStopped() {
  const btn = document.getElementById('btn-voice-record');
  if (btn) { btn.classList.remove('recording'); btn.textContent = '🎙️ 录音'; }
  try {
    if (!voiceChunks.length) { showToast('录音为空，请重新录'); return; }
    const blob = new Blob(voiceChunks, { type: voiceChunks[0].type || pickAudioMime() || 'audio/webm' });
    voiceChunks = [];
    if (blob.size > 30 * 1024 * 1024) { showToast('录音太大（单个最大 30MB）'); return; }
    if (blob.size < 500) { showToast('录音太短，请重新录'); return; }
    const duration = Math.max(1, (Date.now() - voiceStartTime) / 1000);
    const previewUrl = URL.createObjectURL(blob);
    const data = await fileToBase64(blob);
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    if (pendingVoice && pendingVoice.previewUrl) URL.revokeObjectURL(pendingVoice.previewUrl);
    pendingVoice = {
      data, mime: blob.type, duration,
      name: `voice_${Date.now()}.${ext}`,
      previewUrl,
      title: '语音' // 默认标题，用户可改
    };
    console.log('[voice] 录音完成', { duration, size: blob.size, mime: blob.type });
    renderPendingVoice();
    showToast('✅ 录音完成，可试听或发布');
    if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
  } catch (err) {
    console.error('[voice] 处理录音失败', err);
    showToast('录音处理失败：' + (err && err.message ? err.message : '请重试'));
    voiceChunks = [];
  }
}

function renderPendingVoice() {
  const box = document.getElementById('voice-preview');
  if (!box) return;
  if (!pendingVoice) { box.innerHTML = ''; return; }
  const dur = formatMusicDuration(pendingVoice.duration);
  const title = pendingVoice.title || '语音';
  const playing = voicePreviewAudio && !voicePreviewAudio.paused;
  const icon = playing ? MUSIC_ICONS.pause : MUSIC_ICONS.play;
  box.innerHTML = `<div class="music-bar pending-music-bar" onclick="event.stopPropagation()">
    <button class="music-play ${playing ? 'playing' : ''}" data-voice-preview-button onclick="event.stopPropagation();previewPendingVoice()" aria-label="试听语音">${icon}</button>
    <div class="music-info">
      <div class="music-title" id="pending-voice-title" style="user-select:none;cursor:text;">${escapeHtml(title)}</div>
      <div class="music-duration">${dur}</div>
    </div>
    <span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>
    <div class="pending-music-actions">
      <button onclick="event.stopPropagation();removeVoice()">移除</button>
    </div>
  </div>`;
  bindVoiceTitleLongPress();
}

function bindVoiceTitleLongPress() {
  const el = document.getElementById('pending-voice-title');
  if (!el) return;
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const start = (e) => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      e.preventDefault && e.preventDefault();
      const cur = pendingVoice && pendingVoice.title || '语音';
      const val = prompt('给这段语音起个名字', cur);
      if (val !== null) {
        const t = val.trim().slice(0, 30);
        if (pendingVoice) {
          pendingVoice.title = t || '语音';
          renderPendingVoice();
          if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
        }
      }
    }, 650);
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('contextmenu', e => { e.preventDefault(); start(e); }, { once: true });
}

function previewPendingVoice() {
  if (!pendingVoice || !pendingVoice.previewUrl) return;
  if (voicePreviewAudio && voicePreviewAudio.src === pendingVoice.previewUrl) {
    if (voicePreviewAudio.paused) {
      voicePreviewAudio.play().catch(() => {});
    } else {
      voicePreviewAudio.pause();
    }
    syncVoicePreviewButton();
    return;
  }
  if (voicePreviewAudio) {
    try { voicePreviewAudio.pause(); URL.revokeObjectURL(voicePreviewAudio.src); } catch (e) {}
  }
  voicePreviewAudio = new Audio(pendingVoice.previewUrl);
  voicePreviewAudio.preload = 'none';
  voicePreviewAudio.onplay = () => syncVoicePreviewButton();
  voicePreviewAudio.onpause = () => syncVoicePreviewButton();
  voicePreviewAudio.onended = () => {
    voicePreviewAudio = null;
    renderPendingVoice();
  };
  voicePreviewAudio.onerror = () => {
    showToast('语音试听失败');
    voicePreviewAudio = null;
    renderPendingVoice();
  };
  voicePreviewAudio.play().catch(err => {
    console.warn('[voice] play() failed', err);
  });
  renderPendingVoice();
}

function syncVoicePreviewButton() {
  const btn = document.querySelector('[data-voice-preview-button]');
  if (!btn) return;
  const playing = voicePreviewAudio && !voicePreviewAudio.paused && !voicePreviewAudio.ended;
  btn.innerHTML = playing ? MUSIC_ICONS.pause : MUSIC_ICONS.play;
}

function removeVoice() {
  stopRecording();
  if (voicePreviewAudio) { try { voicePreviewAudio.pause(); } catch (e) {} voicePreviewAudio = null; }
  if (pendingVoice && pendingVoice.previewUrl) URL.revokeObjectURL(pendingVoice.previewUrl);
  pendingVoice = null;
  renderPendingVoice();
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
}

// 动态里的语音条（播放全局单例，与音乐互斥）
function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let finished = false;
    const timer = setTimeout(() => finish(new Error('音乐读取超时，请换一首试试')), 20000);
    function finish(err) {
      if (finished) return;
      finished = true;
      const duration = audio.duration;
      clearTimeout(timer);
      audio.onloadeddata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (err) reject(err);
      else if (!Number.isFinite(duration) || duration <= 0) reject(new Error('无法读取音乐时长'));
      else resolve(duration);
    }
    audio.preload = 'auto';
    // loadeddata 表示首帧已真正解码，能拦截损坏或加密音频
    audio.onloadeddata = () => finish();
    audio.onerror = () => finish(new Error('无法解码这首音乐，加密 / DRM 或不支持的音频无法导入'));
    audio.src = url;
    audio.load();
  });
}

function renderPendingMusic() {
  const box = document.getElementById('music-preview');
  if (!box) return;
  if (!pendingMusic) {
    box.innerHTML = '';
    return;
  }
  const lead = pendingMusic.previewUrl
    ? `<button class="music-play" data-music-preview-button onclick="previewPendingMusic()" aria-label="试听音乐">${MUSIC_ICONS.play}</button>`
    : `<span class="music-note">🎵</span>`;
  const sub = [
    pendingMusic.duration ? formatMusicDuration(pendingMusic.duration) : '',
    pendingMusic.url ? '已上传' : '发布时上传'
  ].filter(Boolean).join(' · ');
  box.innerHTML = `<div class="music-bar pending-music-bar">
    ${lead}
    <div class="music-info">
      <div class="music-title">${escapeHtml(pendingMusic.title)}</div>
      <div class="music-duration">${escapeHtml(sub)}</div>
    </div>
    <span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>
    <div class="pending-music-actions">
      <button onclick="addMusic()">修改</button>
      <button onclick="removePendingMusic()">移除</button>
    </div>
  </div>`;
  syncMusicButtons();
}

function clearPendingMusic() {
  if (musicState.kind === 'preview') stopMusic();
  if (pendingMusic && pendingMusic.previewUrl) URL.revokeObjectURL(pendingMusic.previewUrl);
  pendingMusic = null;
  idbDel('music');
  draftSavedBlobs.delete('music_key');
  renderPendingMusic();
  scheduleDraftSave();
}

function removePendingMusic() {
  clearPendingMusic();
}

// 直接选本地音乐文件，歌名取文件名
function addMusic() {
  const input = document.getElementById('music-input');
  input.value = '';
  input.onchange = async e => {
    const file = (e.target.files || [])[0];
    input.value = '';
    if (!file) return;
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const allowedExt = ['mp3', 'm4a', 'aac', 'wav'];
      const allowedMime = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'];
      if (ext === 'm4p' || (!allowedExt.includes(ext) && !allowedMime.includes(file.type))) {
        throw new Error('请选择 MP3、M4A、AAC 或 WAV 音乐，M4P / DRM 加密歌曲不能导入');
      }
      if (file.size > 15 * 1024 * 1024) throw new Error('音乐不能超过 15MB');
      showToast('正在读取音乐...');
      const duration = await readAudioDuration(file);
      if (duration > 600) throw new Error('音乐不能超过 10 分钟');
      const data = await fileToBase64(file);
      clearPendingMusic();
      pendingMusic = {
        name: file.name || 'music.mp3',
        title: (file.name || '未命名音乐').replace(/\.[^.]+$/, '').trim() || '未命名音乐',
        data,
        duration,
        previewUrl: URL.createObjectURL(file),
        url: null
      };
      renderPendingMusic();
      scheduleDraftSave();
      showToast('✅ 音乐已添加，可先试听');
    } catch (err) {
      alert(err.message || '音乐读取失败，请换一首试试');
    }
  };
  input.click();
}

function ensureMusicAudio() {
  if (musicAudio) return musicAudio;
  musicAudio = new Audio();
  musicAudio.preload = 'none';
  musicAudio.playsInline = true;
  musicAudio.setAttribute('playsinline', '');
  musicAudio.addEventListener('play', syncMusicButtons);
  musicAudio.addEventListener('pause', syncMusicButtons);
  musicAudio.addEventListener('timeupdate', updateMusicProgress);
  musicAudio.addEventListener('ended', () => {
    musicState.loading = false;
    resetMusicProgress();
    syncMusicButtons();
  });
  return musicAudio;
}

// 播放进度：只更新当前播放那条的进度光带
function updateMusicProgress() {
  if (!musicAudio || musicState.kind !== 'post') return;
  const total = musicAudio.duration;
  const ratio = total > 0 ? Math.min(1, musicAudio.currentTime / total) : 0;
  document.querySelectorAll(`[data-music-button="${musicState.id}"]`).forEach(btn => {
    const bar = btn.closest('.music-bar');
    if (bar) bar.style.setProperty('--music-progress', ratio.toFixed(4));
  });
}

function resetMusicProgress() {
  document.querySelectorAll('.music-bar').forEach(bar => bar.style.setProperty('--music-progress', 0));
}

function musicSources(url) {
  const rel = mediaRelPath(url);
  return rel ? [MEDIA_CDN_PREFIX + rel, MEDIA_PAGES_PREFIX + rel, MEDIA_RAW_PREFIX + rel] : [url];
}

function musicBarHtml(post) {
  if (!post.music) return '';
  const hasAudio = typeof post.music.url === 'string' && post.music.url;
  const title = typeof post.music.title === 'string' && post.music.title ? post.music.title : '未命名音乐';
  const artist = typeof post.music.artist === 'string' ? post.music.artist : '';
  const sub = hasAudio ? formatMusicDuration(post.music.duration) : artist;
  if (!hasAudio) {
    // 只记录歌名和歌手，没有音频文件时展示信息条
    return `<div class="music-bar static" onclick="event.stopPropagation()">
      <span class="music-note">🎵</span>
      <div class="music-info">
        <div class="music-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="music-duration">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>`;
  }
  return `<div class="music-bar" onclick="event.stopPropagation()">
    <button class="music-play" data-music-button="${post.id}" onclick="event.stopPropagation();togglePostMusic('${post.id}')" aria-label="播放音乐">${MUSIC_ICONS.play}</button>
    <div class="music-info">
      <div class="music-title">${escapeHtml(title)}</div>
      <div class="music-duration">${escapeHtml([artist, sub].filter(Boolean).join(' · '))}</div>
    </div>
    <span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>
  </div>`;
}

const MUSIC_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.2v13.6c0 .9.99 1.45 1.75.98l10.6-6.8a1.16 1.16 0 0 0 0-1.96L10.25 4.22a1.16 1.16 0 0 0-1.75.98z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.8" fill="currentColor"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.8" fill="currentColor"/></svg>',
  loading: '<span class="music-spin"></span>'
};

function syncMusicButtons() {
  const playing = !!(musicAudio && !musicAudio.paused && !musicAudio.ended);
  document.querySelectorAll('[data-music-button]').forEach(btn => {
    const active = musicState.kind === 'post' && btn.dataset.musicButton === musicState.id;
    const isPlaying = active && playing;
    btn.innerHTML = active && musicState.loading ? MUSIC_ICONS.loading : (isPlaying ? MUSIC_ICONS.pause : MUSIC_ICONS.play);
    btn.classList.toggle('loading', active && musicState.loading);
    btn.classList.toggle('playing', isPlaying);
    btn.setAttribute('aria-label', isPlaying ? '暂停音乐' : '播放音乐');
    const bar = btn.closest('.music-bar');
    if (bar) bar.classList.toggle('playing', isPlaying);
  });
  const previewBtn = document.querySelector('[data-music-preview-button]');
  if (previewBtn) {
    const active = musicState.kind === 'preview';
    const isPlaying = active && playing;
    previewBtn.innerHTML = active && musicState.loading ? MUSIC_ICONS.loading : (isPlaying ? MUSIC_ICONS.pause : MUSIC_ICONS.play);
    previewBtn.classList.toggle('loading', active && musicState.loading);
    previewBtn.classList.toggle('playing', isPlaying);
    previewBtn.setAttribute('aria-label', isPlaying ? '暂停试听' : '试听音乐');
  }
}

function pausePageVideos() {
  document.querySelectorAll('video').forEach(v => {
    try { v.pause(); } catch (e) {}
  });
}

function pauseMusic() {
  musicPlayOp++;
  if (musicAudio) musicAudio.pause();
  musicState.loading = false;
  syncMusicButtons();
}

function stopMusic() {
  musicPlayOp++;
  if (musicAudio) {
    try {
      musicAudio.pause();
      musicAudio.removeAttribute('src');
      musicAudio.load();
    } catch (e) {}
  }
  musicState.kind = null;
  musicState.id = null;
  musicState.sources = [];
  musicState.sourceIndex = 0;
  musicState.loading = false;
  resetMusicProgress();
  syncMusicButtons();
}

async function playMusic(kind, id, sources, restart) {
  if (!sources.length || !sources[0]) return;
  const audio = ensureMusicAudio();
  const changed = musicState.kind !== kind || musicState.id !== id;
  const op = ++musicPlayOp;
  audio.pause();
  if (changed || restart) {
    musicState.sources = sources;
    musicState.sourceIndex = 0;
    resetMusicProgress();
  }
  musicState.kind = kind;
  musicState.id = id;
  musicState.loading = true;
  pausePageVideos();
  syncMusicButtons();

  const start = (changed || restart) ? 0 : musicState.sourceIndex;
  for (let i = start; i < musicState.sources.length; i++) {
    if (op !== musicPlayOp) return;
    musicState.sourceIndex = i;
    const src = musicState.sources[i];
    try {
      if (changed || restart || audio.src !== src) {
        audio.src = src;
        audio.load();
      } else if (audio.ended) {
        audio.currentTime = 0;
      }
      await audio.play();
      if (op !== musicPlayOp) return;
      musicState.loading = false;
      syncMusicButtons();
      return;
    } catch (err) {
      if (op !== musicPlayOp) return;
      if (err && err.name === 'AbortError') {
        musicState.loading = false;
        syncMusicButtons();
        return;
      }
      if (err && err.name === 'NotAllowedError') {
        musicState.loading = false;
        syncMusicButtons();
        showToast('请再点一次播放');
        return;
      }
      // 当前线路不可用时继续尝试下一线路
    }
  }
  if (op === musicPlayOp) {
    stopMusic();
    showToast('音乐加载失败，请稍后重试');
  }
}

// ---- 动态里的语音条 ----
function voiceBarHtml(post) {
  if (!post.voice) return '';
  const hasAudio = typeof post.voice.url === 'string' && post.voice.url;
  if (!hasAudio) return '';
  const title = typeof post.voice.title === 'string' && post.voice.title ? post.voice.title : '语音';
  const dur = formatMusicDuration(post.voice.duration);
  return `<div class="music-bar" onclick="event.stopPropagation()">
    <button class="music-play" data-voice-button="${post.id}" onclick="event.stopPropagation();togglePostVoice('${post.id}')" aria-label="播放语音">${MUSIC_ICONS.play}</button>
    <div class="music-info">
      <div class="music-title">${escapeHtml(title)}</div>
      <div class="music-duration">${dur}</div>
    </div>
    <span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>
  </div>`;
}

function syncVoiceButtons() {
  const playing = !!(currentVoiceAudio && !currentVoiceAudio.paused && !currentVoiceAudio.ended);
  document.querySelectorAll('[data-voice-button]').forEach(btn => {
    const id = btn.dataset.voiceButton;
    const active = currentPlayingVoiceId === id;
    const isPlaying = active && playing;
    const loading = active && voiceState.loading;
    btn.innerHTML = loading ? MUSIC_ICONS.loading : (isPlaying ? MUSIC_ICONS.pause : MUSIC_ICONS.play);
    btn.classList.toggle('loading', loading);
    btn.classList.toggle('playing', isPlaying);
    btn.setAttribute('aria-label', isPlaying ? '暂停语音' : '播放语音');
    const bar = btn.closest('.music-bar');
    if (bar) bar.classList.toggle('playing', isPlaying);
  });
  // 发布页试听按钮
  const previewBtn = document.querySelector('[data-voice-preview-button]');
  if (previewBtn) {
    const playingPrev = voicePreviewAudio && !voicePreviewAudio.paused && !voicePreviewAudio.ended;
    previewBtn.innerHTML = playingPrev ? MUSIC_ICONS.pause : MUSIC_ICONS.play;
    previewBtn.classList.toggle('playing', playingPrev);
    previewBtn.setAttribute('aria-label', playingPrev ? '暂停试听' : '试听语音');
    const bar = previewBtn.closest('.music-bar');
    if (bar) bar.classList.toggle('playing', playingPrev);
  }
}

function updateVoiceProgress() {
  if (!currentVoiceAudio || !currentPlayingVoiceId) return;
  const cur = currentVoiceAudio.currentTime || 0;
  const total = currentVoiceAudio.duration || 0;
  const ratio = total > 0 ? Math.min(1, cur / total) : 0;
  document.querySelectorAll(`[data-voice-button="${currentPlayingVoiceId}"]`).forEach(btn => {
    const bar = btn.closest('.music-bar');
    if (bar) bar.style.setProperty('--music-progress', ratio.toFixed(4));
  });
}

function resetVoiceProgress() {
  document.querySelectorAll('[data-voice-button]').forEach(btn => {
    const bar = btn.closest('.music-bar');
    if (bar) bar.style.setProperty('--music-progress', 0);
  });
}

async function togglePostVoice(postId) {
  const post = allPostsCache.find(p => p.id === postId);
  if (!post || !post.voice || !post.voice.url) return;
  // 先停掉音乐（互斥）
  if (currentPlayingVoiceId === postId && currentVoiceAudio) {
    if (currentVoiceAudio.paused) currentVoiceAudio.play(); else currentVoiceAudio.pause();
    syncVoiceButtons();
    return;
  }
  stopMusic();
  stopCurrentVoice();
  // 构建播放源：CDN → Pages → raw
  const rel = mediaRelPath(post.voice.url);
  const sources = rel ? [
    MEDIA_CDN_PREFIX + rel,
    MEDIA_PAGES_PREFIX + rel,
    MEDIA_RAW_PREFIX + rel
  ] : [post.voice.url];
  currentPlayingVoiceId = postId;
  voiceState.sources = sources;
  voiceState.sourceIndex = 0;
  voiceState.loading = true;
  syncVoiceButtons();
  const url = sources[0];
  const op = ++voicePlayOp;
  const audio = new Audio(url);
  audio.preload = 'none';
  currentVoiceAudio = audio;
  audio.onloadstart = () => { voiceState.loading = true; syncVoiceButtons(); };
  audio.onplaying = () => {
    voiceState.loading = false;
    if (op === voicePlayOp) syncVoiceButtons();
  };
  audio.onpause = () => { if (op === voicePlayOp) syncVoiceButtons(); };
  audio.onended = () => {
    if (op === voicePlayOp) {
      stopCurrentVoice();
    }
  };
  audio.ontimeupdate = () => { if (op === voicePlayOp) updateVoiceProgress(); };
  audio.onerror = async () => {
    if (op !== voicePlayOp) return;
    voiceState.sourceIndex++;
    if (voiceState.sourceIndex < sources.length) {
      audio.src = sources[voiceState.sourceIndex];
      try { await audio.play(); } catch (e) {}
      return;
    }
    voiceState.loading = false;
    stopCurrentVoice();
    showToast('语音加载失败');
  };
  try { await audio.play(); } catch (err) {
    if (err && err.name === 'AbortError') return;
    audio.onerror();
  }
}

function stopCurrentVoice() {
  if (currentVoiceAudio) {
    try { currentVoiceAudio.pause(); currentVoiceAudio.removeAttribute('src'); currentVoiceAudio.load(); } catch (e) {}
  }
  currentVoiceAudio = null;
  currentPlayingVoiceId = null;
  voiceState.loading = false;
  voiceState.sources = [];
  voiceState.sourceIndex = 0;
  resetVoiceProgress();
  syncVoiceButtons();
}

function togglePostMusic(postId) {
  const post = allPostsCache.find(p => p.id === postId);
  if (!post || !post.music || !post.music.url) return;
  stopCurrentVoice();
  if (musicState.kind === 'post' && musicState.id === postId) {
    if (musicState.loading) { stopMusic(); return; }
    if (musicAudio && !musicAudio.paused && !musicAudio.ended) { pauseMusic(); return; }
    playMusic('post', postId, musicState.sources, false);
    return;
  }
  playMusic('post', postId, musicSources(post.music.url), true);
}

function previewPendingMusic() {
  if (!pendingMusic || !pendingMusic.previewUrl) return;
  if (musicState.kind === 'preview') {
    if (musicState.loading) { stopMusic(); return; }
    if (musicAudio && !musicAudio.paused && !musicAudio.ended) { pauseMusic(); return; }
    playMusic('preview', 'pending', musicState.sources, false);
    return;
  }
  playMusic('preview', 'pending', [pendingMusic.previewUrl], true);
}

// 视频开始发声时暂停音乐；音乐开始播放前也会暂停所有视频
document.addEventListener('play', e => {
  if (e.target && e.target.tagName === 'VIDEO' && musicAudio && (musicState.loading || !musicAudio.paused)) pauseMusic();
}, true);

// 截取视频首帧，生成缩略图（解决编辑页视频显示为黑色）
function makeVideoThumb(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('webkit-playsinline', '');
    v.src = url;
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
    let done = false;
    const finish = (thumb) => {
      if (done) return;
      done = true;
      try { v.remove(); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
      resolve(thumb || '');
    };
    const capture = () => {
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return finish('');
        const max = 320;
        const scale = Math.min(1, max / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.72).split(',')[1]);
      } catch (e) { finish(''); }
    };
    v.onloadeddata = () => {
      try {
        v.currentTime = 0.1;
      } catch (e) { capture(); }
    };
    v.onseeked = capture;
    v.onerror = () => finish('');
    setTimeout(() => { if (!done) capture(); }, 5000);
    v.load();
  });
}

function addImage() {
  const input = document.getElementById('img-input');
  input.onchange = async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    showToast('正在压缩图片...');
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} 太大了，请小于 10MB`);
        continue;
      }
      const base64 = await compressImage(file, 920, 0.66);
      const thumb = await compressImage(file, 640, 0.62);
      pendingMedia.push({ kind: 'image', data: base64, thumb, name: 'img.jpg', mime: 'image/jpeg' });
    }
    input.value = '';
    renderPendingMedia();
    scheduleDraftSave();
    showToast('✅ 图片已添加');
  };
  input.click();
}

// 尽量把视频压小再上传（快很多），不支持或失败就用原文件
async function transcodeVideo(file) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  if (file.size < 1.5 * 1024 * 1024) return null;
  const mimeList = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
  let mime = null;
  for (const t of mimeList) {
    try { if (MediaRecorder.isTypeSupported(t)) { mime = t; break; } } catch (e) {}
  }
  if (!mime) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;

  const srcUrl = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = srcUrl;
  v.playsInline = true;
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  // 元素必须留在可视区域内 iOS 才会真正解码画面，所以用近乎透明的 960px 图层
  v.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:720px;opacity:0.01;pointer-events:none;z-index:1;';
  document.body.appendChild(v);

  let actx = null, rec = null, raf = 0, audioTrack = null;
  try {
    // 关键：必须在用户点击的同一时刻接好音频并开始播放，否则 iOS 会拦截有声播放
    actx = new AC();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    const srcNode = actx.createMediaElementSource(v);
    const dest = actx.createMediaStreamDestination();
    srcNode.connect(dest);
    audioTrack = dest.stream.getAudioTracks()[0];
  } catch (e) {
    console.warn('音频轨道不可用，改为静音压缩', e);
  }
  const playP = v.play();
  playP.catch(() => {});

  const cleanup = () => {
    try { cancelAnimationFrame(raf); } catch (e) {}
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
    try { v.pause(); } catch (e) {}
    try { if (actx) actx.close(); } catch (e) {}
    try { v.remove(); } catch (e) {}
    try { URL.revokeObjectURL(srcUrl); } catch (e) {}
  };

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('读取视频超时')), 15000);
      v.onloadedmetadata = () => { clearTimeout(t); resolve(); };
      v.onerror = () => { clearTimeout(t); reject(new Error('视频无法读取')); };
      v.load();
    });
    try { await playP; } catch (e) { console.warn('播放被拦截，改用原视频', e); return null; }
    const dur = v.duration || 0;
    if (!dur || dur > 60) return null;

    const w0 = v.videoWidth || 720, h0 = v.videoHeight || 1280;
    const scale = Math.min(1, 960 / Math.max(w0, h0));
    const cw = Math.max(2, Math.round(w0 * scale / 2) * 2);
    const ch = Math.max(2, Math.round(h0 * scale / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    if (audioTrack) stream.addTrack(audioTrack);

    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800000, audioBitsPerSecond: 64000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(resolve => { rec.onstop = resolve; });
    rec.start(500);
    const draw = () => {
      try { ctx.drawImage(v, 0, 0, cw, ch); } catch (e) {}
      raf = requestAnimationFrame(draw);
    };
    draw();
    await new Promise(resolve => {
      v.onended = resolve;
      setTimeout(resolve, dur * 1000 + 8000);
    });
    cancelAnimationFrame(raf);
    if (rec.state !== 'inactive') rec.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mime });
    if (!blob.size || blob.size >= file.size * 0.85) return null;
    const ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    return new File([blob], String(file.name || 'video').replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
  } catch (e) {
    console.warn('视频压缩失败，改用原视频', e);
    return null;
  } finally {
    cleanup();
  }
}

function addVideo(isLive = false) {
  const input = document.getElementById('video-input');
  input.onchange = async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    showToast('正在处理视频...');
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        alert(`${file.name} 太大了，请小于 20MB`);
        continue;
      }
      // 先尝试压缩，能显著加快上传；失败就用原视频
      showToast('正在压缩视频，请稍等...');
      let uploadFile = file;
      try {
        const small = await transcodeVideo(file);
        if (small) uploadFile = small;
      } catch (e) { console.warn(e); }
      showToast('正在读取视频...');
      const base64 = await fileToBase64(uploadFile);
      const item = {
        kind: 'video',
        data: base64,
        thumb: '',
        name: uploadFile.name,
        mime: uploadFile.type || 'video/mp4',
        live: isLive,
        sound: true
      };
      pendingMedia.push(item);
      renderPendingMedia();
      // 封面子图后台生成，不耽误选中和上传
      makeVideoThumb(uploadFile).then(t => {
        if (t) { item.thumb = t; renderPendingMedia(); }
      });
    }
    input.value = '';
    renderPendingMedia();
    scheduleDraftSave();
    showToast(isLive ? '✅ 实况已添加（可在播放器里静音）' : '✅ 视频已添加');
  };
  input.click();
}

async function compressImage(file, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
        else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showUploadProgress(text) {
  let el = document.getElementById('upload-progress-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'upload-progress-toast';
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.82);color:#fff;padding:10px 20px;border-radius:20px;z-index:9999;font-size:14px;max-width:86vw;text-align:center;line-height:1.5;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
function hideUploadProgress() {
  const el = document.getElementById('upload-progress-toast');
  if (el) el.remove();
}

// ---- 所在位置 ----
let pickedLocation = null;
let locResults = [];
let locMap = null, locMarker = null, locMapSelected = null, locGeoSeq = 0;

// WGS84 <-> GCJ02（高德/腾讯地图瓦片使用 GCJ02，GPS 与地名服务使用 WGS84）
const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;
function outOfChina(lat, lng) { return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55); }
function gcjTLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function gcjTLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}
function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = gcjTLat(lng - 105, lat - 35), dLng = gcjTLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat); magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2wgs(lat, lng) {
  const g = wgs2gcj(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}

let leafletLoader = null;
function ensureLeaflet() {
  if (typeof L !== 'undefined') return Promise.resolve();
  if (leafletLoader) return leafletLoader;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const cssReady = new Promise((resolve, reject) => {
    css.onload = resolve;
    css.onerror = () => reject(new Error('地图样式加载失败'));
  });
  document.head.appendChild(css);
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const jsReady = new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('地图加载失败'));
  });
  document.head.appendChild(script);
  leafletLoader = Promise.all([cssReady, jsReady]).catch(e => {
    leafletLoader = null;
    throw e;
  });
  return leafletLoader;
}

async function openLocationModal() {
  document.getElementById('location-modal').style.display = 'flex';
  openOverlay('location-modal');
  document.getElementById('location-results').innerHTML = '';
  const base = pickedLocation || { lat: 30.2741, lng: 120.1551 };
  try {
    await ensureLeaflet();
    if (document.getElementById('location-modal').style.display !== 'flex') return;
    initLocMap(base.lat, base.lng, !!pickedLocation);
  } catch (e) {
    // 地图不可用时仍可通过上方搜索选择位置
    document.getElementById('loc-map').style.display = 'none';
  }
}
function closeLocationModal() {
  closeOverlay('location-modal');
}
function initLocMap(wgsLat, wgsLng, keepName) {
  if (typeof L === 'undefined') {
    document.getElementById('loc-map').style.display = 'none';
    return;
  }
  document.getElementById('loc-map').style.display = 'block';
  const g = wgs2gcj(wgsLat, wgsLng);
  if (!locMap) {
    locMap = L.map('loc-map', { attributionControl: false, zoomControl: true }).setView([g.lat, g.lng], 17);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234', maxZoom: 18, minZoom: 3
    }).addTo(locMap);
    locMarker = L.marker([g.lat, g.lng], { draggable: true }).addTo(locMap);
    locMarker.on('dragend', () => {
      const p = locMarker.getLatLng();
      onMapPick(p.lat, p.lng);
    });
    locMap.on('click', (e) => {
      locMarker.setLatLng(e.latlng);
      onMapPick(e.latlng.lat, e.latlng.lng);
    });
  } else {
    locMap.setView([g.lat, g.lng], 17);
    locMarker.setLatLng([g.lat, g.lng]);
  }
  setTimeout(() => locMap.invalidateSize(), 200);
  if (keepName && pickedLocation) {
    locMapSelected = { name: pickedLocation.name, lat: pickedLocation.lat, lng: pickedLocation.lng };
    document.getElementById('loc-picked').textContent = '📍 ' + pickedLocation.name;
  } else {
    onMapPick(g.lat, g.lng);
  }
}
async function onMapPick(gcjLat, gcjLng) {
  const w = gcj2wgs(gcjLat, gcjLng);
  locMapSelected = { name: '', addr: '', lat: w.lat, lng: w.lng };
  const label = document.getElementById('loc-picked');
  label.textContent = '正在获取地址...';
  const coords = `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`;
  const seq = ++locGeoSeq;
  try {
    const res = await fetchWithTimeout(`https://photon.komoot.io/reverse?lat=${w.lat}&lon=${w.lng}&limit=1`, 8000);
    const j = await res.json();
    if (seq !== locGeoSeq) return;
    const f = (j.features || [])[0];
    if (f) {
      const loc = photonToLoc(f);
      locMapSelected.name = loc.name || coords;
      locMapSelected.addr = loc.addr || '';
      label.textContent = '📍 ' + locText(locMapSelected);
    } else {
      locMapSelected.name = coords;
      label.textContent = '📍 ' + coords;
    }
  } catch (e) {
    if (seq !== locGeoSeq) return;
    locMapSelected.name = coords;
    label.textContent = '📍 ' + coords;
  }
}
function confirmMapLocation() {
  if (!locMapSelected || !locMapSelected.name) { alert('请先在地图上选择位置'); return; }
  pickedLocation = {
    name: locMapSelected.name,
    addr: locMapSelected.addr || '',
    lat: +locMapSelected.lat.toFixed(3),
    lng: +locMapSelected.lng.toFixed(3)
  };
  const btn = document.getElementById('btn-location');
  btn.textContent = '📍 ' + locText(pickedLocation);
  btn.style.color = '#4b3fa8';
  closeLocationModal();
}
function renderLocationResults(list) {
  locResults = list;
  const c = document.getElementById('location-results');
  if (!list.length) {
    c.innerHTML = '<p style="color:#999;text-align:center;padding:16px 0;">没有找到相关地点</p>';
    return;
  }
  c.innerHTML = list.map((r, i) => `
    <div class="loc-item" onclick="pickLocation(${i})">
      <div class="loc-name">${escapeHtml(r.name)}</div>
      <div class="loc-addr">${escapeHtml(r.addr)}</div>
    </div>`).join('');
}
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
function photonToLoc(f) {
  const p = (f && f.properties) || {};
  const coords = (f && f.geometry && f.geometry.coordinates) || [];
  const name = p.name || p.street || p.locality || p.city || p.district || p.state || '未知地点';
  const addr = [p.state, p.city, p.county, p.district, p.locality, p.street, p.housenumber]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ');
  return { name, addr: addr || '', lat: coords[1], lon: coords[0] };
}
// 展示用：省 · 市 · 区 · 地点
function locText(loc) {
  if (!loc) return '';
  const parts = [];
  if (loc.addr) parts.push(loc.addr);
  if (loc.name && (!loc.addr || loc.addr.indexOf(loc.name) === -1)) parts.push(loc.name);
  return parts.join(' · ') || loc.name || '';
}
async function useCurrentLocation() {
  if (!navigator.geolocation) { alert('当前浏览器不支持定位'); return; }
  const c = document.getElementById('location-results');
  c.innerHTML = '<p style="color:#6c5ce7;text-align:center;padding:16px 0;">正在定位...</p>';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const g = wgs2gcj(lat, lon);
    if (locMap) {
      locMap.setView([g.lat, g.lng], 17);
      locMarker.setLatLng([g.lat, g.lng]);
    } else {
      initLocMap(lat, lon, false);
    }
    onMapPick(g.lat, g.lng);
    c.innerHTML = '<p style="color:#999;text-align:center;padding:8px 0;font-size:12px;">已定位到当前位置，可拖动图钉微调</p>';
  }, (err) => {
    c.innerHTML = '';
    alert('定位失败：' + (err.code === 1 ? '未授权定位，请在系统设置里允许浏览器访问位置' : err.message));
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
async function searchLocation() {
  const q = document.getElementById('location-search-input').value.trim();
  if (!q) return;
  const c = document.getElementById('location-results');
  c.innerHTML = '<p style="color:#6c5ce7;text-align:center;padding:16px 0;">搜索中...</p>';
  try {
    const res = await fetchWithTimeout(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10`, 8000);
    const j = await res.json();
    renderLocationResults((j.features || []).map(photonToLoc));
  } catch (e) {
    c.innerHTML = '<p style="color:#e0555a;text-align:center;padding:16px 0;">搜索失败，请检查网络后重试</p>';
  }
}
function pickLocation(i) {
  const r = locResults[i];
  if (!r) return;
  const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
  if (locMap && !isNaN(lat) && !isNaN(lng)) {
    const g = wgs2gcj(lat, lng);
    locMap.setView([g.lat, g.lng], 17);
    locMarker.setLatLng([g.lat, g.lng]);
    locMapSelected = { name: r.name, addr: r.addr || '', lat, lng };
    document.getElementById('loc-picked').textContent = '📍 ' + locText(locMapSelected);
  }
  pickedLocation = { name: r.name, addr: r.addr || '', lat: +lat.toFixed(3), lng: +lng.toFixed(3) };
  const btn = document.getElementById('btn-location');
  btn.textContent = '📍 ' + locText(pickedLocation);
  btn.style.color = '#4b3fa8';
  closeLocationModal();
  scheduleDraftSave();
}
function clearLocation() {
  pickedLocation = null;
  locMapSelected = null;
  const btn = document.getElementById('btn-location');
  btn.textContent = '不显示位置';
  btn.style.color = '#6c5ce7';
  closeLocationModal();
  scheduleDraftSave();
}

// ---- 编辑已有动态 ----
let editingPostId = null;

function setEditingPost(id) {
  editingPostId = id;
  const banner = document.getElementById('edit-banner');
  if (banner) banner.style.display = id ? 'flex' : 'none';
  const btn = document.getElementById('publish-btn');
  if (btn) btn.textContent = id ? '💾 保存修改' : '✨ 发布日记';
}

async function startEditPost(id) {
  const post = allPostsCache.find(p => p.id === id);
  if (!post) return;
  if (post.authorId !== currentUser.id) { alert('只能编辑自己的动态'); return; }
  if (overlayStack.includes('detail-view')) closeDetail();
  pendingMedia = getPostMedia(post).map((m, i) => ({
    key: 'k' + Date.now() + '_' + i + Math.random().toString(36).slice(2, 6),
    kind: m.type,
    url: m.url,
    thumb: m.type === 'image' ? (m.thumb || null) : null,
    poster: m.poster || null,
    live: !!m.live,
    sound: m.sound !== false,
    data: null,
    mime: '',
    name: ''
  }));
  pendingMusic = post.music && post.music.url
    ? { name: 'music', title: post.music.title || '未命名音乐', duration: post.music.duration || 0, data: null, previewUrl: null, url: post.music.url }
    : null;
  pendingVoice = post.voice && post.voice.url
    ? { name: 'voice', title: post.voice.title || '语音', duration: post.voice.duration || 0, data: null, previewUrl: null, url: post.voice.url }
    : null;
  renderPendingVoice();
  pickedWeather = metaList(post.weather);
  pickedMood = metaList(post.mood);
  document.getElementById('post-text').value = post.text || '';
  document.getElementById('visibility').value = post.visibility || 'private';
  onVisChange();
  if (post.visibility === 'selected') {
    selectedFriendIds = (post.selectedFriends || []).slice();
    loadFriendOptions().then(() => {
      document.querySelectorAll('#friend-options input[type=checkbox]').forEach(cb => {
        cb.checked = selectedFriendIds.includes(cb.value);
      });
    });
  }
  pickedLocation = post.location ? { name: post.location.name, addr: post.location.addr || '' } : null;
  const locBtn = document.getElementById('btn-location');
  if (pickedLocation) {
    locBtn.textContent = '📍 ' + locText(pickedLocation);
    locBtn.style.color = '#4b3fa8';
  } else {
    locBtn.textContent = '不显示位置';
    locBtn.style.color = '#6c5ce7';
  }
  renderPendingMedia();
  renderPendingMusic();
  syncMoodChips();
  setEditingPost(id);
  switchTab('publish');
  showToast('已进入编辑，改完点「保存修改」');
}

function cancelEditPost() {
  if (!editingPostId) return;
  resetPublishForm();
  switchTab('feed');
  showToast('已取消编辑');
}

function resetPublishForm() {
  pendingMedia = [];
  renderPendingMedia();
  clearPendingMusic();
  removeVoice();
  document.getElementById('post-text').value = '';
  document.getElementById('visibility').value = 'private';
  onVisChange();
  pickedWeather = [];
  pickedMood = [];
  syncMoodChips();
  clearLocation();
  setEditingPost(null);
  clearDraft();
}

// 统一上传：已上传过的（编辑时保留的）媒体/音乐直接复用地址
async function uploadPendingContent() {
  const music = pendingMusic;
  const voice = pendingVoice;
  const total = pendingMedia.length + (music ? 1 : 0) + (voice ? 1 : 0);
  let done = 0;
  showUploadProgress(total ? `上传中 0/${total}...` : '处理中...');

  const uploaded = new Array(pendingMedia.length);
  let nextIndex = 0;
  const uploadWorker = async () => {
    while (nextIndex < pendingMedia.length) {
      const i = nextIndex++;
      const m = pendingMedia[i];
      if (m.url) {
        uploaded[i] = { url: m.url, poster: m.kind === 'video' ? (m.poster || null) : (m.thumb || null) };
        done++;
        showUploadProgress(`上传中 ${done}/${total}...`);
        continue;
      }
      const label = m.kind === 'video' ? (m.live ? '实况' : '视频') : '图片';
      showUploadProgress(`上传中 ${done}/${total}：${label}${m.kind === 'video' ? '（较大请稍等）' : ''}...`);
      const extraTask = m.thumb
        ? ghUploadMedia('thumb.jpg', m.thumb).catch(e => { console.warn('缩略图上传失败', e); return null; })
        : Promise.resolve(null);
      const [url, extra] = await Promise.all([ghUploadMedia(m.name, m.data), extraTask]);
      uploaded[i] = { url, poster: extra };
      done++;
      showUploadProgress(`上传中 ${done}/${total}...`);
    }
  };
  const musicTask = (async () => {
    if (!music) return null;
    showUploadProgress(`上传中 ${done}/${total}：音乐...`);
    if (!music.url) music.url = await ghUploadMedia(music.name, music.data, { timeout: 300000 });
    done++;
    showUploadProgress(`上传中 ${done}/${total}...`);
    return { url: music.url, title: music.title, duration: music.duration || 0 };
  })();
  const voiceTask = (async () => {
    if (!voice) return null;
    showUploadProgress(`上传中 ${done}/${total}：语音...`);
    if (!voice.url) voice.url = await ghUploadMedia(voice.name, voice.data, { timeout: 300000 });
    done++;
    showUploadProgress(`上传中 ${done}/${total}...`);
    return { url: voice.url, title: voice.title || '语音', duration: voice.duration || 0 };
  })();
  const results = await Promise.all([uploadWorker(), uploadWorker(), musicTask, voiceTask]);

  const media = uploaded.map((u, i) => {
    const m = pendingMedia[i];
    const item = { type: m.kind, url: u.url };
    if (m.kind === 'video') {
      item.live = !!m.live;
      item.sound = !!m.sound;
      if (u.poster) item.poster = u.poster;
    } else if (u.poster) {
      item.thumb = u.poster;
    }
    return item;
  });
  return { media, music: results[2], voice: results[3] };
}

async function publishPost() {
  const text = document.getElementById('post-text').value.trim();
  const visibility = document.getElementById('visibility').value;
  const editingId = editingPostId;

  if (!text && !pendingMedia.length && !pendingMusic && !pendingVoice) {
    alert('请输入内容或添加图片/视频/音乐/语音');
    return;
  }

  try {
    const { media, music, voice } = await uploadPendingContent();
    const now = new Date().toISOString();

    if (editingId) {
      const original = allPostsCache.find(p => p.id === editingId);
      if (!original) throw new Error('这条动态已经不存在了');
      const editedAt = Array.isArray(original.editedAt) ? original.editedAt.slice() : [];
      editedAt.push(now);
      const updated = {
        ...original,
        text,
        media,
        music,
        voice,
        image: (media.find(m => m.type === 'image') || {}).url || null,
        video: (media.find(m => m.type === 'video') || {}).url || null,
        visibility,
        selectedFriends: visibility === 'selected' ? selectedFriendIds.slice() : [],
        location: pickedLocation ? { name: pickedLocation.name, addr: pickedLocation.addr || '' } : null,
        weather: pickedWeather.length ? pickedWeather.slice() : null,
        mood: pickedMood.length ? pickedMood.slice() : null,
        editedAt
      };
      allPostsCache = allPostsCache.map(p => p.id === editingId ? updated : p);
      await enqueuePostsWrite((serverPosts) => serverPosts.map(sp => sp.id === editingId
        ? {
            ...updated,
            likes: Array.isArray(sp.likes) ? sp.likes : updated.likes,
            comments: Array.isArray(sp.comments) ? sp.comments : updated.comments,
            createdAt: sp.createdAt || updated.createdAt
          }
        : sp));
    } else {
      const post = {
        id: 'p_' + Date.now(),
        authorId: currentUser.id,
        authorName: currentUser.username,
        authorAvatar: currentUser.avatar || null,
        text,
        media,
        music,
        voice,
        image: (media.find(m => m.type === 'image') || {}).url || null,
        video: (media.find(m => m.type === 'video') || {}).url || null,
        visibility,
        selectedFriends: visibility === 'selected' ? selectedFriendIds.slice() : [],
        // 只保存文字地址，绝不写入经纬度（避免被精确定位）
        location: pickedLocation ? { name: pickedLocation.name, addr: pickedLocation.addr || '' } : null,
        likes: [],
        comments: [],
        weather: pickedWeather.length ? pickedWeather.slice() : null,
        mood: pickedMood.length ? pickedMood.slice() : null,
        createdAt: now
      };
      allPostsCache.push(post);
      loadPosts(); // 刷新界面
      await enqueuePostsWrite((serverPosts) => {
        serverPosts.push(post);
        return serverPosts;
      });
    }

    stopMusic();
    stopCurrentVoice();
    resetPublishForm();
    hideUploadProgress();
    showToast(editingId ? '✅ 修改已保存' : '✅ 发布成功！');
    switchTab('feed');
    loadPosts();
  } catch (e) {
    hideUploadProgress();
    renderPendingMusic();
    alert((editingId ? '保存失败：' : '发布失败：') + e.message);
    console.error(e);
  }
}

// ---- 发布/编辑草稿：任何原因离开页面都能恢复 ----
const DRAFT_KEY = 'mlyz_draft_v1';
let draftSaveTimer = 0;
let draftRestoring = false;
const draftSavedBlobs = new Set();

function idbOpen() {
  return new Promise(resolve => {
    if (!window.indexedDB) return resolve(null);
    let req;
    try { req = indexedDB.open('mlyz_draft', 1); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  if (!db) return;
  await new Promise(res => {
    try {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(val, key);
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    } catch (e) { res(); }
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise(res => {
    try {
      const tx = db.transaction('files', 'readonly');
      const rq = tx.objectStore('files').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  if (!db) return;
  try {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(key);
  } catch (e) {}
}
async function idbClear() {
  const db = await idbOpen();
  if (!db) return;
  try {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').clear();
  } catch (e) {}
}

function formHasContent() {
  const ta = document.getElementById('post-text');
  return !!((ta && ta.value.trim()) || pendingMedia.length || pendingMusic || pendingVoice);
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => { saveDraftNow(); }, 600);
}

async function saveDraftNow() {
  if (!currentUser) return;
  if (!formHasContent()) { clearDraft(); return; }
  const data = {
    v: 1,
    editingPostId,
    text: document.getElementById('post-text').value,
    visibility: document.getElementById('visibility').value,
    selectedFriends: selectedFriendIds.slice(),
    weather: pickedWeather,
    mood: pickedMood,
    location: pickedLocation ? { name: pickedLocation.name, addr: pickedLocation.addr || '' } : null,
    music: pendingMusic
      ? { name: pendingMusic.name, title: pendingMusic.title, duration: pendingMusic.duration || 0, url: pendingMusic.url || null }
      : null,
    voice: pendingVoice
      ? { name: pendingVoice.name, title: pendingVoice.title || '语音', duration: pendingVoice.duration || 0, url: pendingVoice.url || null }
      : null,
    media: pendingMedia.map(m => ({
      key: m.key,
      kind: m.kind,
      url: m.url || null,
      thumb: m.url ? (m.thumb || m.poster || null) : null,
      live: !!m.live,
      sound: m.sound !== false,
      hasData: !!m.data
    })),
    updatedAt: Date.now()
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
  for (const m of pendingMedia) {
    if (!m.data || draftSavedBlobs.has(m.key)) continue;
    await idbSet('m_' + m.key, { data: m.data, mime: m.mime || 'image/jpeg', thumb: m.thumb || '' });
    draftSavedBlobs.add(m.key);
  }
  if (pendingMusic && pendingMusic.data && !draftSavedBlobs.has('music_key')) {
    await idbSet('music', { data: pendingMusic.data, name: pendingMusic.name, mime: pendingMusic.mime || '' });
    draftSavedBlobs.add('music_key');
  }
  if (pendingVoice && pendingVoice.data && !draftSavedBlobs.has('voice_key')) {
    await idbSet('voice', { data: pendingVoice.data, name: pendingVoice.name, mime: pendingVoice.mime || '' });
    draftSavedBlobs.add('voice_key');
  }
}

function clearDraft() {
  clearTimeout(draftSaveTimer);
  draftSavedBlobs.clear();
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  idbClear();
}

// 发布页左上角 ✕：先确认，再清空
function confirmClearDraft() {
  if (!formHasContent() && !editingPostId) { showToast('当前没有可清空的内容'); return; }
  const el = document.getElementById('clear-draft-modal');
  if (!el) return;
  el.style.display = 'flex';
  openOverlay('clear-draft-modal');
}

function doClearDraftNow() {
  closeOverlay('clear-draft-modal');
  resetPublishForm();
  showToast('已清空编辑内容');
}

async function maybeRestoreDraft() {
  if (draftRestoring || editingPostId || formHasContent()) return;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return; }
  if (!d || d.v !== 1) return;
  draftRestoring = true;
  try {
    const media = [];
    for (const item of (d.media || [])) {
      const rec = item.hasData ? await idbGet('m_' + item.key) : null;
      if (!item.url && !rec) continue;
      media.push({
        key: item.key,
        kind: item.kind,
        url: item.url || null,
        thumb: rec ? (rec.thumb || '') : (item.thumb || null),
        poster: null,
        live: !!item.live,
        sound: item.sound !== false,
        data: rec ? rec.data : null,
        mime: rec ? rec.mime : '',
        name: ''
      });
    }
    let music = null;
    if (d.music) {
      const rec = await idbGet('music');
      if (d.music.url || (rec && rec.data)) {
        music = {
          name: (rec && rec.name) || 'music.mp3',
          title: d.music.title || '未命名音乐',
          duration: d.music.duration || 0,
          data: rec ? rec.data : null,
          previewUrl: null,
          url: d.music.url || null
        };
      }
    }
    let voice = null;
    if (d.voice) {
      const rec = await idbGet('voice');
      if (d.voice.url || (rec && rec.data)) {
        voice = {
          name: (rec && rec.name) || d.voice.name || 'voice.webm',
          title: d.voice.title || '语音',
          duration: d.voice.duration || 0,
          data: rec ? rec.data : null,
          previewUrl: null,
          url: d.voice.url || null
        };
      }
    }
    pendingMedia = media;
    pendingMusic = music;
    pendingVoice = voice;
    pickedWeather = metaList(d.weather);
    pickedMood = metaList(d.mood);
    document.getElementById('post-text').value = d.text || '';
    document.getElementById('visibility').value = d.visibility || 'private';
    onVisChange();
    selectedFriendIds = Array.isArray(d.selectedFriends) ? d.selectedFriends.slice() : [];
    if (d.visibility === 'selected') {
      loadFriendOptions().then(() => {
        document.querySelectorAll('#friend-options input[type=checkbox]').forEach(cb => {
          cb.checked = selectedFriendIds.includes(cb.value);
        });
      });
    }
    pickedLocation = d.location ? { name: d.location.name, addr: d.location.addr || '' } : null;
    const locBtn = document.getElementById('btn-location');
    if (pickedLocation) {
      locBtn.textContent = '📍 ' + locText(pickedLocation);
      locBtn.style.color = '#4b3fa8';
    } else {
      locBtn.textContent = '不显示位置';
      locBtn.style.color = '#6c5ce7';
    }
    renderPendingMedia();
    renderPendingMusic();
    syncMoodChips();
    if (d.editingPostId && allPostsCache.some(p => p.id === d.editingPostId)) {
      setEditingPost(d.editingPostId);
    }
    showToast('已恢复上次未完成的内容');
  } catch (e) {
    console.warn('草稿恢复失败', e);
  } finally {
    draftRestoring = false;
  }
}

// ---- Friend list for selected visibility ----
let selectedFriendIds = [];
let allUsersCache = [];

async function loadFriendOptions() {
  const { content: users } = await ghGetFile('data/users.json');
  allUsersCache = users;
  await loadFriendships();
  const friends = users.filter(u => u.id !== currentUser.id && isFriend(u.id, currentUser.id));
  const container = document.getElementById('friend-options');
  if (!friends.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px;">还没有好友，先去「好友」页面添加吧</p>';
    return;
  }
  container.innerHTML = friends.map(u => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;">
      <input type="checkbox" value="${u.id}" onchange="toggleFriend(this)">
      <span>${escapeHtml(u.username)}</span>
    </label>
  `).join('');
}

function toggleFriend(cb) {
  if (cb.checked) selectedFriendIds.push(cb.value);
  else selectedFriendIds = selectedFriendIds.filter(id => id !== cb.value);
  scheduleDraftSave();
}

// ---- Friends page ----
async function loadFriendsPage() {
  const { content: users } = await ghGetFile('data/users.json');
  await loadFriendships();

  const myFriends = users.filter(u => u.id !== currentUser.id && isFriend(u.id, currentUser.id));
  const others = users.filter(u => u.id !== currentUser.id && !isFriend(u.id, currentUser.id));

  let html = '';
  if (myFriends.length) {
    html += myFriends.map(u => `
      <div class="friend-row">
        ${getAvatarHtml(u.username, u.avatar, u.id)}
        <span class="friend-name" onclick="openUserPage('${u.id}')" style="cursor:pointer;">${escapeHtml(u.username)}</span>
        <button onclick="removeFriend('${u.id}')" class="friend-del">删除</button>
      </div>
    `).join('');
  } else {
    html += '<p style="color:#999;">还没有好友</p>';
  }

  html += '<h3 style="margin-top:24px;">🔍 其他用户</h3>';
  if (others.length) {
    html += others.map(u => `
      <div class="friend-row">
        ${getAvatarHtml(u.username, u.avatar, u.id)}
        <span class="friend-name" onclick="openUserPage('${u.id}')" style="cursor:pointer;">${escapeHtml(u.username)}</span>
        <button onclick="addFriend('${u.id}')" class="friend-add">+ 加好友</button>
      </div>
    `).join('');
  } else {
    html += '<p style="color:#999;">暂无其他用户</p>';
  }

  document.getElementById('friends-list').innerHTML = html;
}

async function addFriend(friendId) {
  try {
    const { content: fs, sha } = await ghGetFile('data/friendships.json');
    if (!isFriend(currentUser.id, friendId)) {
      fs.push({ user1: currentUser.id, user2: friendId, createdAt: new Date().toISOString() });
      await ghPutFile('data/friendships.json', fs, sha);
      showToast('✅ 已添加好友');
      loadFriendsPage();
    }
  } catch (e) {
    alert('操作失败：' + e.message);
  }
}

async function removeFriend(friendId) {
  if (!confirm('确定删除这个好友？')) return;
  try {
    const { content: fs, sha } = await ghGetFile('data/friendships.json');
    const filtered = fs.filter(f =>
      !((f.user1 === currentUser.id && f.user2 === friendId) ||
        (f.user1 === friendId && f.user2 === currentUser.id))
    );
    await ghPutFile('data/friendships.json', filtered, sha);
    showToast('已删除好友');
    loadFriendsPage();
  } catch (e) {
    alert('操作失败：' + e.message);
  }
}

// ---- Settings / Invite codes ----
const INVITE_TTL = 10 * 60 * 1000; // 邀请码 10 分钟有效

// 清理过期邀请码
function cleanExpiredInvites(invites) {
  const now = Date.now();
  return invites.filter(i => {
    if (i.used_by) return true; // 已使用的保留
    if (!i.createdAt) return false; // 没有 createdAt 的旧邀请码视为过期
    return (now - i.createdAt) < INVITE_TTL;
  });
}

// 邀请码剩余时间（毫秒）
function inviteRemaining(i) {
  if (!i.createdAt) return 0;
  return Math.max(0, INVITE_TTL - (Date.now() - i.createdAt));
}

function formatCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

let countdownTimer = null;

async function loadSettings() {
  const vEl = document.getElementById('app-version');
  if (vEl) vEl.textContent = 'v' + (typeof CURRENT_V !== 'undefined' ? CURRENT_V : '—');
  const { content: invites, sha } = await ghGetFile('data/invites.json');
  // 清理过期的
  const valid = cleanExpiredInvites(invites);
  if (valid.length !== invites.length) {
    await ghPutFile('data/invites.json', valid, sha);
  }

  const available = valid.filter(i => !i.used_by);
  document.getElementById('invite-list').innerHTML = available.map(i => {
    const remain = inviteRemaining(i);
    return `<div style="padding:10px;background:rgba(255,255,255,0.32);border:1px solid rgba(255,255,255,0.45);border-radius:10px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <code style="font-size:16px;color:#6c5ce7;">${i.code}</code>
        <button onclick="copyInvite('${i.code}')" class="btn-secondary" style="padding:4px 10px;width:auto;">复制</button>
      </div>
      <div class="invite-countdown" data-code="${i.code}" data-created="${i.createdAt}" style="font-size:12px;color:#ff6b6b;margin-top:4px;">⏱️ ${formatCountdown(remain)}</div>
    </div>`;
  }).join('') || '<p style="color:#999;">暂无可邀请码（点上方按钮生成，10分钟有效）</p>';

  // 启动倒计时
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    document.querySelectorAll('.invite-countdown').forEach(el => {
      const created = parseInt(el.getAttribute('data-created'));
      const remain = Math.max(0, INVITE_TTL - (Date.now() - created));
      el.textContent = remain > 0 ? `⏱️ ${formatCountdown(remain)}` : '已过期';
      el.style.color = remain > 0 ? '#ff6b6b' : '#999';
    });
  }, 1000);

  if (currentUser) {
    document.getElementById('my-username').textContent = currentUser.username;
    // 个人信息预览
    const avatarEl = document.getElementById('profile-avatar-preview');
    if (avatarEl) {
      setAvatarPreview(avatarEl, currentUser.avatar, currentUser.username);
      if (currentUser.avatar) avatarEl.setAttribute('data-zoom', currentUser.avatar);
      else avatarEl.removeAttribute('data-zoom');
    }
    const nameEl = document.getElementById('profile-name-preview');
    if (nameEl) nameEl.textContent = currentUser.username;
    const emailEl = document.getElementById('profile-email-preview');
    if (emailEl) emailEl.textContent = currentUser.email || '';
  }
}

function setAvatarPreview(el, avatarUrl, name) {
  el.onerror = null;
  if (!avatarUrl) {
    el.src = getAvatarUrl(name);
    return;
  }
  el.onerror = () => {
    el.onerror = null;
    el.src = mediaPagesUrl(avatarUrl);
  };
  el.src = mediaCdnUrl(avatarUrl);
}

// 生成默认头像 URL（首字母）
function getAvatarUrl(name) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const colors = ['667eea','764ba2','f093fb','4facfe','43e97b','fa709a','fee140','30cfd0'];
  const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="#${color}"/><text x="50" y="50" font-size="40" fill="white" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${initial}</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function copyInvite(code) {
  navigator.clipboard.writeText(code);
  showToast('✅ 邀请码已复制');
}

function copyAppUrl() {
  const url = 'https://1024z-del.github.io/mengli-youzhi/social/';
  navigator.clipboard.writeText(url).then(() => {
    showToast('✅ 网页地址已复制');
  }).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✅ 网页地址已复制');
  });
}

async function generateInvite() {
  try {
    const code = 'MLYZ' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const { content: invites, sha } = await ghGetFile('data/invites.json');
    // 删除所有未使用的旧邀请码（同时只允许一个有效）
    const filtered = invites.filter(i => i.used_by);
    filtered.push({ code, used_by: null, used_at: null, createdAt: Date.now() });
    await ghPutFile('data/invites.json', filtered, sha);
    showToast('✅ 生成邀请码：' + code + '（10分钟有效）');
    loadSettings();
  } catch (e) {
    alert('生成失败：' + e.message);
  }
}

// ---- Export / Import ----
let exportSelectedIds = new Set();
let importData = null;

async function openExportModal() {
  const { content: posts } = await ghGetFile('data/posts.json');
  const myPosts = (posts || []).filter(p => p.authorId === currentUser.id);
  exportSelectedIds.clear();
  document.getElementById('export-post-list').innerHTML = myPosts.length ? myPosts.map(p => `
    <div class="post-card-manage">
      <input type="checkbox" onchange="toggleExportPost('${p.id}', this.checked)">
      <div class="mini-preview">
        <div class="mp-text">${escapeHtml(p.text || '(无文字)')}</div>
        <div class="mp-time">${formatTime(p.createdAt)}</div>
      </div>
    </div>
  `).join('') : '<p style="color:#999;text-align:center;padding:20px;">你还没有日记</p>';
  document.getElementById('export-modal').style.display = 'flex';
  openOverlay('export-modal');
}

function toggleExportPost(id, checked) {
  if (checked) exportSelectedIds.add(id);
  else exportSelectedIds.delete(id);
}

function toggleExportAll() {
  const boxes = document.querySelectorAll('#export-post-list input[type="checkbox"]');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => { b.checked = !allChecked; });
}

function doExport() {
  const selectedPosts = [];
  const boxes = document.querySelectorAll('#export-post-list input[type="checkbox"]');
  const previews = document.querySelectorAll('#export-post-list .mini-preview');
  boxes.forEach((b, i) => {
    if (b.checked) {
      // 从预览文本反推不现实，改用直接重新读取并匹配时间
      selectedPosts.push(i);
    }
  });
  if (selectedPosts.length === 0) {
    alert('请先选择要导出的日记');
    return;
  }
  // 重新读取并按索引筛选
  ghGetFile('data/posts.json').then(({ content: posts }) => {
    const myPosts = (posts || []).filter(p => p.authorId === currentUser.id);
    const toExport = selectedPosts.map(i => myPosts[i]);
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser.username,
      posts: toExport
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `梦里有zhi_日记备份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeExportModal();
    showToast('✅ 已导出 ' + toExport.length + ' 篇日记');
  });
}

function closeExportModal() {
  closeOverlay('export-modal');
}

function openImportModal() {
  importData = null;
  document.getElementById('import-file').value = '';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-modal').style.display = 'flex';
  openOverlay('import-modal');
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('import-file');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = evt => {
        try {
          const data = JSON.parse(evt.target.result);
          if (!data.posts || !Array.isArray(data.posts)) {
            alert('文件格式不正确');
            return;
          }
          importData = data;
          document.getElementById('import-preview').innerHTML = `
            <p style="color:#6c5ce7;">✅ 识别到 ${data.posts.length} 篇日记</p>
            ${data.posts.slice(0, 5).map(p => `
              <div class="post-card-manage" style="border:none;padding:6px 0;">
                <div class="mini-preview">
                  <div class="mp-text">${escapeHtml(p.text || '(无文字)')}</div>
                  <div class="mp-time">${formatTime(p.createdAt)}</div>
                </div>
              </div>
            `).join('')}
            ${data.posts.length > 5 ? `<p style="color:#999;font-size:12px;text-align:center;">...还有 ${data.posts.length - 5} 篇</p>` : ''}
          `;
        } catch (err) {
          alert('文件解析失败：' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }
});

function normalizeImportedMusic(music) {
  if (!music || typeof music !== 'object') return null;
  const title = typeof music.title === 'string' ? music.title.trim().slice(0, 100) : '';
  const artist = typeof music.artist === 'string' ? music.artist.trim().slice(0, 100) : '';
  // 兼容 v89/v90 备份里带音频地址的旧数据
  const url = typeof music.url === 'string' && music.url.indexOf(MEDIA_RAW_PREFIX) === 0 ? music.url : '';
  if (!title && !url) return null;
  const duration = Number(music.duration);
  const item = { title: title || '未命名音乐', artist };
  if (url) {
    item.url = url;
    item.duration = Number.isFinite(duration) && duration > 0 && duration <= 600 ? duration : 0;
  }
  return item;
}

async function doImport() {
  if (!importData) {
    alert('请先选择备份文件');
    return;
  }
  if (!confirm(`确定导入 ${importData.posts.length} 篇日记吗？`)) return;

  // 重新生成 id，避免冲突；作者改为当前用户
  const newPosts = importData.posts.map(p => ({
    ...p,
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    authorId: currentUser.id,
    authorName: currentUser.username,
    authorAvatar: currentUser.avatar || null,
    createdAt: p.createdAt || new Date().toISOString(),
    music: normalizeImportedMusic(p.music)
  }));
  // 乐观更新本地缓存
  allPostsCache = [...allPostsCache, ...newPosts];
  loadPosts();
  // 通过队列写入 GitHub
  await enqueuePostsWrite((serverPosts) => {
    return [...serverPosts, ...newPosts];
  });

  importData = null;
  closeImportModal();
  showToast('✅ 成功导入 ' + newPosts.length + ' 篇日记');
  switchTab('feed');
}

function closeImportModal() {
  closeOverlay('import-modal');
}

// ---- 点赞清单 ----
function openLikesModal() {
  document.getElementById('likes-modal').style.display = 'flex';
  openOverlay('likes-modal');
  renderLikesList();
}

function closeLikesModal() {
  closeOverlay('likes-modal');
}

function renderLikesList() {
  const likedPosts = allPostsCache.filter(p => (p.likes || []).includes(currentUser.id));
  const container = document.getElementById('likes-list');
  if (!likedPosts.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0;">还没有赞过任何日记</p>';
    return;
  }
  likedPosts.sort((a, b) => {
    const aTime = (a.likes || []).indexOf(currentUser.id);
    return 0; // 保持原顺序
  });
  container.innerHTML = likedPosts.map(p => `
    <div class="comment-item" onclick="openLikedPost('${p.id}')" style="cursor:pointer;">
      ${getAvatarHtml(p.authorName, p.authorAvatar)}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#333;">${escapeHtml(p.authorName)} ${visLabel(p.visibility)}</div>
        <div style="font-size:13px;color:#555;margin:4px 0;word-break:break-word;">${escapeHtml(p.text || '(无文字)')}</div>
        ${p.image ? '<div style="font-size:11px;color:#6c5ce7;">[含图片]</div>' : ''}
        <div style="font-size:11px;color:#999;margin-top:2px;">${formatTime(p.createdAt)} · ❤️ ${(p.likes||[]).length} 赞</div>
      </div>
    </div>
  `).join('');
}

// 从点赞列表打开日记：不关闭点赞弹窗，直接在上面打开详情页
// 返回时会先关闭详情，再重新显示点赞弹窗
function openLikedPost(postId) {
  viewPost(postId);
}

// ---- 回收站 ----
let trashCache = [];
let trashSha = null;
let trashLoaded = false;
let trashVersion = 0;

async function openTrashModal() {
  document.getElementById('trash-modal').style.display = 'flex';
  openOverlay('trash-modal');
  if (trashLoaded) {
    renderTrashList();
  } else {
    document.getElementById('trash-list').innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0;">加载中...</p>';
  }
  loadTrashList();
}

function closeTrashModal() {
  closeOverlay('trash-modal');
}

async function loadTrashList() {
  const version = trashVersion;
  try {
    const { content, sha } = await ghGetFile('data/trash.json');
    // 期间若删除或恢复了某条，丢弃这次拉到的旧数据
    if (version !== trashVersion) return;
    trashCache = content || [];
    trashSha = sha;
    trashLoaded = true;
    renderTrashList();
  } catch (e) {
    console.error('读取回收站失败', e);
    if (!trashLoaded) {
      document.getElementById('trash-list').innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0;">加载失败，请稍后重试</p>';
    }
  }
}

function renderTrashList() {
  const myTrash = trashCache.filter(t => t.authorId === currentUser.id);
  const container = document.getElementById('trash-list');
  if (!myTrash.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0;">回收站是空的</p>';
    return;
  }
  container.innerHTML = myTrash.map(t => {
    const deletedDays = Math.floor((Date.now() - new Date(t.deletedAt).getTime()) / (24*60*60*1000));
    const remaining = 30 - deletedDays;
    return `<div class="comment-item" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        ${getAvatarHtml(t.authorName, t.authorAvatar)}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#333;">${escapeHtml(t.authorName)} ${visLabel(t.visibility)}</div>
          <div style="font-size:13px;color:#555;margin:4px 0;word-break:break-word;">${escapeHtml(t.text || '(无文字)')}</div>
          ${t.image ? '<div style="font-size:11px;color:#6c5ce7;">[含图片]</div>' : ''}
          ${t.video ? '<div style="font-size:11px;color:#6c5ce7;">[含视频]</div>' : ''}
          <div style="font-size:11px;color:#999;margin-top:4px;">删除于 ${formatTime(t.deletedAt)} · 还剩 ${remaining} 天自动清除</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button onclick="restoreTrashItem('${t.id}')" style="flex:1;padding:8px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">♻️ 恢复</button>
        <button onclick="permanentDeleteTrash('${t.id}')" style="flex:1;padding:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">❌ 永久删除</button>
      </div>
    </div>`;
  }).join('');
}

// 回收站写入：优先复用已拿到的 sha，避免每次操作多一次读取
async function writeTrashCache() {
  if (!trashSha) trashSha = (await ghGetFile('data/trash.json')).sha;
  // 回收站是整体覆盖，冲突时直接用本地这份重写，避免把刚删的条目合并回来
  trashSha = (await ghPutFile('data/trash.json', trashCache, trashSha, { replace: true })) || null;
}

async function restoreTrashItem(postId) {
  if (!confirm('确定恢复这篇日记吗？')) return;
  const item = trashCache.find(t => t.id === postId);
  if (!item) return;
  const prevCache = trashCache;
  const prevSha = trashSha;
  const { deletedAt, ...restored } = item;
  // 先在界面上立刻恢复，网络写入放到后面
  trashCache = trashCache.filter(t => t.id !== postId);
  trashVersion++;
  renderTrashList();
  if (!allPostsCache.find(p => p.id === restored.id)) allPostsCache.push(restored);
  renderFeed();
  try {
    await writeTrashCache();
    await enqueuePostsWrite(serverPosts => {
      if (!serverPosts.find(p => p.id === restored.id)) serverPosts.push(restored);
      return serverPosts;
    });
    showToast('♻️ 已恢复');
  } catch (e) {
    console.error('恢复失败', e);
    trashCache = prevCache;
    trashSha = prevSha;
    trashVersion++;
    allPostsCache = allPostsCache.filter(p => p.id !== restored.id);
    renderTrashList();
    renderFeed();
    alert('恢复失败，请检查网络后重试');
  }
}

async function permanentDeleteTrash(postId) {
  if (!confirm('确定永久删除吗？删除后无法恢复！')) return;
  const prevCache = trashCache;
  const prevSha = trashSha;
  // 先立刻从界面移除，再写云端
  trashCache = trashCache.filter(t => t.id !== postId);
  trashVersion++;
  renderTrashList();
  try {
    await writeTrashCache();
    showToast('✅ 已永久删除');
  } catch (e) {
    console.error('永久删除失败', e);
    trashCache = prevCache;
    trashSha = prevSha;
    trashVersion++;
    renderTrashList();
    alert('删除失败，请检查网络后重试');
  }
}

// 自动清理超过 30 天的回收站
async function cleanupOldTrash() {
  try {
    const { content: trash, sha } = await ghGetFile('data/trash.json');
    if (!trash || !trash.length) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const cleaned = trash.filter(t => new Date(t.deletedAt).getTime() > cutoff);
    if (cleaned.length !== trash.length) {
      await ghPutFile('data/trash.json', cleaned, sha);
    }
  } catch (e) {
    console.error('清理回收站失败', e);
  }
}

// ---- Profile editing ----
let pendingAvatar = null;
let pendingCover = null;

function openProfileModal() {
  document.getElementById('edit-username').value = currentUser.username || '';
  document.getElementById('edit-email').value = currentUser.email || '';
  document.getElementById('edit-bio').value = currentUser.bio || '';
  document.getElementById('edit-password').value = '';
  pendingAvatar = null;
  pendingCover = null;
  const avatarEdit = document.getElementById('profile-avatar-edit');
  setAvatarPreview(avatarEdit, currentUser.avatar, currentUser.username);
  // 封面预览
  const coverEdit = document.getElementById('profile-cover-edit');
  if (coverEdit) {
    if (currentUser.cover) {
      coverEdit.style.backgroundImage = `url('${mediaPagesUrl(currentUser.cover)}')`;
      coverEdit.textContent = '';
    } else {
      coverEdit.style.backgroundImage = '';
      coverEdit.textContent = '点击更换主页背景图';
    }
  }
  document.getElementById('profile-modal').style.display = 'flex';
  openOverlay('profile-modal');
}

function closeProfileModal() {
  closeOverlay('profile-modal');
}

// 头像上传（带裁剪）
let cropperImg = null;
let cropperState = { x: 0, y: 0, scale: 1, imgW: 0, imgH: 0 };
let sliderBusy = false; // 防止程序设值时触发 oninput 回写

document.addEventListener('DOMContentLoaded', () => {
  const avatarInput = document.getElementById('avatar-input');
  if (avatarInput) {
    avatarInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = evt => {
        const img = new Image();
        img.onload = () => openCropper(img);
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // 主页背景图上传（先裁剪再上传）
  const coverInput = document.getElementById('cover-input');
  if (coverInput) {
    coverInput.addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = evt => {
        const img = new Image();
        img.onload = () => openCoverCropper(img);
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // 裁剪交互
  const container = document.getElementById('cropper-container');
  if (container) {
    let startX, startY, startImgX, startImgY;
    let startDist = 0, startScale = 1;

    function onStart(e) {
      if (e.touches && e.touches.length === 2) {
        startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startScale = cropperState.scale;
      } else {
        const t = e.touches ? e.touches[0] : e;
        startX = t.clientX;
        startY = t.clientY;
        startImgX = cropperState.x;
        startImgY = cropperState.y;
      }
    }
    function onMove(e) {
      if (e.touches && e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        // 更平滑的缩放，限制单次变化幅度
        let newScale = startScale * (dist / startDist);
        newScale = Math.max(0.05, Math.min(5, newScale));
        cropperState.scale = newScale;
        updateSlider();
        drawCropper();
      } else {
        const t = e.touches ? e.touches[0] : e;
        cropperState.x = startImgX + (t.clientX - startX);
        cropperState.y = startImgY + (t.clientY - startY);
        drawCropper();
      }
      e.preventDefault();
    }
    container.addEventListener('mousedown', onStart);
    container.addEventListener('touchstart', onStart, { passive: false });
    container.addEventListener('mousemove', e => { if (e.buttons) onMove(e); });
    container.addEventListener('touchmove', onMove, { passive: false });
  }
});

function zoomBy(delta) {
  cropperState.scale = Math.max(0.05, Math.min(5, cropperState.scale + delta));
  updateSlider();
  drawCropper();
}

function zoomSlider(val) {
  if (sliderBusy) return;
  cropperState.scale = parseFloat(val);
  drawCropper();
}

function updateSlider() {
  const slider = document.getElementById('zoom-slider');
  if (slider) {
    sliderBusy = true;
    slider.value = cropperState.scale;
    // 下一帧解除标志，确保 oninput 不会回写
    requestAnimationFrame(() => { sliderBusy = false; });
  }
}

function openCropper(img) {
  cropperImg = img;
  const canvas = document.getElementById('cropper-canvas');
  const size = 280;
  canvas.width = size;
  canvas.height = size;
  // 初始缩放：让图片短边填满裁剪框
  const minSide = Math.min(img.width, img.height);
  cropperState.scale = size / minSide;
  cropperState.imgW = img.width;
  cropperState.imgH = img.height;
  // 居中
  cropperState.x = (size - img.width * cropperState.scale) / 2;
  cropperState.y = (size - img.height * cropperState.scale) / 2;
  updateSlider();
  drawCropper();
  document.getElementById('cropper-modal').style.display = 'flex';
  openOverlay('cropper-modal');
}

function drawCropper() {
  const canvas = document.getElementById('cropper-canvas');
  const ctx = canvas.getContext('2d');
  const size = 280;
  ctx.clearRect(0, 0, size, size);
  if (cropperImg) {
    const s = cropperState.scale;
    ctx.drawImage(cropperImg, cropperState.x, cropperState.y, cropperImg.width * s, cropperImg.height * s);
  }
}

function confirmCrop() {
  const canvas = document.getElementById('cropper-canvas');
  // 裁剪圆形区域，输出 256x256
  const out = document.createElement('canvas');
  out.width = 256;
  out.height = 256;
  const octx = out.getContext('2d');
  octx.beginPath();
  octx.arc(128, 128, 128, 0, Math.PI * 2);
  octx.closePath();
  octx.clip();
  const s = cropperState.scale;
  const ratio = 256 / 280;
  octx.drawImage(cropperImg, cropperState.x * ratio, cropperState.y * ratio, cropperImg.width * s * ratio, cropperImg.height * s * ratio);
  const dataUrl = out.toDataURL('image/jpeg', 0.9);
  pendingAvatar = dataUrl.split(',')[1];
  document.getElementById('profile-avatar-edit').src = dataUrl;
  closeCropper();
}

function closeCropper() {
  cropperImg = null;
  closeOverlay('cropper-modal');
}

// ---- 主页背景图裁剪（输出 1400×824，比例约 1.7:1）----
let coverCropImg = null;
const COVER_FRAME_W = 320;
const COVER_FRAME_H = 188;
let coverCropState = { scale: 1, min: 1, x: 0, y: 0 };

function openCoverCropper(img) {
  coverCropImg = img;
  const canvas = document.getElementById('cover-cropper-canvas');
  canvas.width = COVER_FRAME_W;
  canvas.height = COVER_FRAME_H;
  const min = Math.max(COVER_FRAME_W / img.width, COVER_FRAME_H / img.height);
  coverCropState = {
    scale: min,
    min,
    x: (COVER_FRAME_W - img.width * min) / 2,
    y: (COVER_FRAME_H - img.height * min) / 2
  };
  const slider = document.getElementById('cover-zoom-slider');
  if (slider) {
    slider.min = min;
    slider.max = min * 4;
    slider.step = min / 200;
    slider.value = min;
  }
  bindCoverCropper();
  drawCoverCropper();
  document.getElementById('cover-cropper-modal').style.display = 'flex';
  openOverlay('cover-cropper-modal');
}

function bindCoverCropper() {
  const box = document.getElementById('cover-cropper-container');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  let sx = 0, sy = 0, spx = 0, spy = 0, sdist = 0, sscale = 1;
  const start = e => {
    if (e.touches && e.touches.length === 2) {
      sdist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      sscale = coverCropState.scale;
    } else {
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      spx = coverCropState.x; spy = coverCropState.y;
    }
  };
  const move = e => {
    if (e.touches && e.touches.length === 2 && sdist) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setCoverScale(sscale * (dist / sdist));
    } else {
      const t = e.touches ? e.touches[0] : e;
      coverCropState.x = spx + (t.clientX - sx);
      coverCropState.y = spy + (t.clientY - sy);
      clampCover();
      drawCoverCropper();
    }
    e.preventDefault();
  };
  box.addEventListener('mousedown', start);
  box.addEventListener('touchstart', start, { passive: false });
  box.addEventListener('mousemove', e => { if (e.buttons) move(e); });
  box.addEventListener('touchmove', move, { passive: false });
}

function clampCover() {
  if (!coverCropImg) return;
  const w = coverCropImg.width * coverCropState.scale;
  const h = coverCropImg.height * coverCropState.scale;
  coverCropState.x = Math.min(0, Math.max(COVER_FRAME_W - w, coverCropState.x));
  coverCropState.y = Math.min(0, Math.max(COVER_FRAME_H - h, coverCropState.y));
}

function setCoverScale(s) {
  s = Math.max(coverCropState.min, Math.min(coverCropState.min * 4, s));
  const cx = COVER_FRAME_W / 2;
  const cy = COVER_FRAME_H / 2;
  const k = s / coverCropState.scale;
  coverCropState.x = cx - (cx - coverCropState.x) * k;
  coverCropState.y = cy - (cy - coverCropState.y) * k;
  coverCropState.scale = s;
  clampCover();
  const slider = document.getElementById('cover-zoom-slider');
  if (slider) slider.value = s;
  drawCoverCropper();
}

function coverZoomBy(delta) {
  setCoverScale(coverCropState.scale + coverCropState.min * delta);
}

function coverZoomSlider(val) {
  setCoverScale(parseFloat(val));
}

function drawCoverCropper() {
  const canvas = document.getElementById('cover-cropper-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, COVER_FRAME_W, COVER_FRAME_H);
  if (!coverCropImg) return;
  const s = coverCropState.scale;
  ctx.drawImage(coverCropImg, coverCropState.x, coverCropState.y, coverCropImg.width * s, coverCropImg.height * s);
}

function confirmCoverCrop() {
  if (!coverCropImg) return;
  const outW = 1400;
  const outH = Math.round(outW * COVER_FRAME_H / COVER_FRAME_W);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const r = outW / COVER_FRAME_W;
  const s = coverCropState.scale;
  out.getContext('2d').drawImage(
    coverCropImg,
    coverCropState.x * r,
    coverCropState.y * r,
    coverCropImg.width * s * r,
    coverCropImg.height * s * r
  );
  const dataUrl = out.toDataURL('image/jpeg', 0.8);
  pendingCover = dataUrl.split(',')[1];
  const coverEdit = document.getElementById('profile-cover-edit');
  if (coverEdit) {
    coverEdit.style.backgroundImage = `url('${dataUrl}')`;
    coverEdit.textContent = '';
  }
  closeCoverCropper();
}

function closeCoverCropper() {
  coverCropImg = null;
  closeOverlay('cover-cropper-modal');
}

async function saveProfile() {
  const newUsername = document.getElementById('edit-username').value.trim();
  const newEmail = document.getElementById('edit-email').value.trim();
  const newPassword = document.getElementById('edit-password').value;
  const newBio = document.getElementById('edit-bio').value.trim();

  if (!newUsername || !newEmail) {
    alert('昵称和邮箱不能为空');
    return;
  }
  if (newPassword && newPassword.length < 6) {
    alert('密码至少 6 位');
    return;
  }

  try {
    // 上传头像
    let avatarUrl = currentUser.avatar;
    if (pendingAvatar) {
      avatarUrl = await ghUploadMedia('avatar.jpg', pendingAvatar);
    }
    // 上传主页背景图
    let coverUrl = currentUser.cover;
    if (pendingCover) {
      showUploadProgress('正在上传主页背景图...');
      try {
        coverUrl = await ghUploadMedia('cover.jpg', pendingCover);
      } finally {
        hideUploadProgress();
      }
    }

    // 更新用户信息
    const { content: users, sha } = await ghGetFile('data/users.json');
    const user = users.find(u => u.id === currentUser.id);
    if (!user) { alert('用户不存在'); return; }

    // 检查昵称是否被占用
    if (newUsername !== user.username && users.find(u => u.username === newUsername)) {
      alert('昵称已被使用');
      return;
    }

    const oldName = user.username;
    user.username = newUsername;
    user.email = newEmail;
    user.avatar = avatarUrl;
    user.cover = coverUrl || null;
    user.bio = newBio;
    if (newPassword) {
      user.password = await hashPwd(newPassword);
    }
    await ghPutFile('data/users.json', users, sha);
    allUsersCache = users;

    // 如果昵称或头像变了，更新所有该用户的日记（通过队列）
    if (newUsername !== oldName || avatarUrl !== currentUser.avatar) {
      allPostsCache.forEach(p => {
        if (p.authorId === currentUser.id) {
          p.authorName = newUsername;
          p.authorAvatar = avatarUrl;
        }
      });
      await enqueuePostsWrite((serverPosts) => {
        serverPosts.forEach(p => {
          if (p.authorId === currentUser.id) {
            p.authorName = newUsername;
            p.authorAvatar = avatarUrl;
          }
        });
        return serverPosts;
      });
    }

    // 更新本地登录态
    setUser({
      id: currentUser.id,
      username: newUsername,
      email: newEmail,
      avatar: avatarUrl,
      cover: coverUrl || null,
      bio: newBio
    });

    closeProfileModal();
    loadSettings();
    showToast('✅ 个人信息已更新');
  } catch (e) {
    hideUploadProgress();
    alert('保存失败：' + (e && e.message ? e.message : e));
    console.error(e);
  }
}

// ---- UI helpers ----
function showAuth() {
  document.getElementById('auth-page').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  renderCachedFeed();
  switchTab('feed');
  loadUsersCache();
  loadNotifications();
  cleanupOldTrash();
  startPolling();
}

// 预加载用户列表（供个人主页、头像使用）
async function loadUsersCache() {
  try {
    const { content: users } = await ghGetFile('data/users.json');
    allUsersCache = users || [];
  } catch (e) {
    console.error('加载用户列表失败', e);
  }
}

// ---- 后台轮询：实时接收新消息和新动态 ----
let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  // 每 15 秒检查一次新通知和新动态
  pollTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      // 刷新通知
      const { content: notifs, sha } = await ghGetFile('data/notifications.json');
      notifsCache = notifs || [];
      notifsShaCache = sha;
      if (document.getElementById('notifications-list')) {
        renderNotifications();
      } else {
        updateNotifBadge();
      }
    } catch (e) { /* 静默 */ }
    try {
      // 刷新动态（只在动态页时重渲染，其他时候只更新缓存）
      const { content: posts, sha: psha } = await ghGetFile('data/posts.json');
      allPostsCache = posts || [];
      postsShaCache = psha;
      const feedTab = document.getElementById('tab-feed');
      if (feedTab && feedTab.style.display !== 'none') {
        const visible = posts.filter(p => canViewPost(p, currentUser.id));
        visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // 内容没变就不重绘，避免图片被反复重新加载导致闪烁
        const sig = JSON.stringify(visible);
        if (sig !== lastFeedSig) {
          lastFeedSig = sig;
          renderFeed(visible);
          saveFeedCache(visible);
        }
      }
    } catch (e) { /* 静默 */ }
  }, 15000);
}

function updateNotifBadge() {
  const list = notifsCache.filter(n => n.userId === currentUser.id && !n.read);
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (list.length > 0) {
      badge.textContent = list.length > 99 ? '99+' : list.length;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// 从后台切回前台时立即刷新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) {
    loadNotifications();
  }
});

function switchTab(tab) {
  const activeTab = document.querySelector('.tab-btn.active');
  const previousTab = activeTab ? activeTab.dataset.tab : null;
  if (tab !== 'feed' && musicState.kind === 'post') pauseMusic();
  if (previousTab === 'publish' && tab !== 'publish') {
    stopMusic();
    stopRecording();
  }
  if (tab !== 'feed') stopCurrentVoice();
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  const manageBtn = document.getElementById('btn-manage');
  if (manageBtn) manageBtn.style.display = (tab === 'feed' && !manageMode) ? 'inline-block' : 'none';
  const clearBtn = document.getElementById('btn-clear-publish');
  if (clearBtn) clearBtn.style.display = tab === 'publish' ? 'flex' : 'none';
  if (tab === 'publish') { loadFriendOptions(); maybeRestoreDraft(); setTimeout(setupChipBars, 60); }
  if (tab === 'friends') { loadFriendsPage(); loadNotifications(); }
  if (tab === 'settings') loadSettings();
  if (tab === 'feed') loadPosts();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 24px;border-radius:12px;z-index:9999;font-size:15px;box-shadow:0 8px 30px rgba(0,0,0,0.3);';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ---- Tab switching ----
function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('btn-login-tab').classList.add('active');
  document.getElementById('btn-reg-tab').classList.remove('active');
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
  document.getElementById('btn-reg-tab').classList.add('active');
  document.getElementById('btn-login-tab').classList.remove('active');
}

function onVisChange() {
  const v = document.getElementById('visibility').value;
  const friendBox = document.getElementById('friend-options');
  friendBox.style.display = v === 'selected' ? 'block' : 'none';
  selectedFriendIds = [];
  scheduleDraftSave();
}

// ---- 此时天气 / 此时心情（都可以多选） ----
let pickedWeather = [];
let pickedMood = [];

// 兼容旧动态：单值字符串与数组都接受
function metaList(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

function selectMoodChip(kind, btn) {
  const v = btn.dataset.value || '';
  const list = kind === 'weather' ? pickedWeather : pickedMood;
  const idx = list.indexOf(v);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(v);
  syncMoodChips();
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
}

function toggleChipBar(barId) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.classList.toggle('expanded');
  const btn = bar.querySelector('.chip-toggle-btn');
  if (btn) btn.textContent = bar.classList.contains('expanded') ? '收起' : '更多';
}

function setupChipBars() {
  ['weather-bar', 'mood-bar'].forEach(id => {
    const bar = document.getElementById(id);
    if (!bar) return;
    const btn = bar.querySelector('.chip-toggle-btn');
    if (!btn) return;
    // 测一下如果一行能放下所有 chips 就不用更多按钮
    // 先临时 expanded 测全宽 vs 收起到 one-line 的宽
    bar.classList.remove('expanded');
    const needMore = bar.scrollWidth > bar.clientWidth + 4;
    btn.style.display = needMore ? '' : 'none';
  });
}

function syncMoodChips() {
  document.querySelectorAll('#weather-bar .mood-chip-btn').forEach(b => {
    b.classList.toggle('active', pickedWeather.includes(b.dataset.value));
  });
  document.querySelectorAll('#mood-bar .mood-chip-btn').forEach(b => {
    b.classList.toggle('active', pickedMood.includes(b.dataset.value));
  });
}

// 动态正文：超过 100 字先折叠，可展开/收起
function postTextHtml(p) {
  const text = p.text || '';
  if (!text) return '';
  if (text.length <= 100) return `<p class="post-text">${escapeHtml(text)}</p>`;
  return `<p class="post-text clamp">${escapeHtml(text)}</p><button class="text-toggle" onclick="togglePostText(event, this)">展开全文</button>`;
}

function togglePostText(e, btn) {
  e.stopPropagation();
  const p = btn.previousElementSibling;
  if (!p) return;
  const clamped = p.classList.toggle('clamp');
  btn.textContent = clamped ? '展开全文' : '收起';
}

function postMetaHtml(p) {
  const chips = metaList(p.weather).concat(metaList(p.mood))
    .map(v => `<span class="post-meta-chip">${escapeHtml(v)}</span>`);
  return chips.length ? `<div class="post-meta-row">${chips.join('')}</div>` : '';
}

// ---- Init ----
// 全局：点任意头像 / 主页背景图看全图
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]');
  if (!z) return;
  if (e.target.closest('button')) return;
  const src = z.getAttribute('data-zoom');
  if (!src) return;
  e.preventDefault();
  e.stopPropagation();
  openSingleImage(src);
}, true);

window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) showApp();
  else showAuth();
});

// 草稿：输入即记录；离开页面 / 切到后台 / 关闭 App 前再保存一次
(function bindDraftAutosave() {
  const ta = document.getElementById('post-text');
  if (ta) ta.addEventListener('input', scheduleDraftSave);
  window.addEventListener('pagehide', () => { if (currentUser && formHasContent()) saveDraftNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentUser && formHasContent()) saveDraftNow();
  });
})();
