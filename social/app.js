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

async function ghPutFile(path, data, sha) {
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
    // merge: if data is array, combine with fresh content
    if (Array.isArray(data) && Array.isArray(fresh.content)) {
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

async function ghUploadMedia(name, base64) {
  const path = `media/${Date.now()}_${name}`;
  const url = `${GH.base}/repos/${GH.owner}/${GH.repo}/contents/social/${path}`;
  const body = {
    message: `upload media`,
    content: base64,
    branch: GH.branch
  };
  const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`上传失败 ${r.status}`);
  return `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/social/${path}`;
}

// ---- Password hash ----
async function hashPwd(pwd) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd + 'mlyz_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Auth state ----
let currentUser = JSON.parse(localStorage.getItem('mlyz_user') || 'null');

function setUser(u) {
  currentUser = u;
  localStorage.setItem('mlyz_user', JSON.stringify(u));
}

function logout() {
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
    setUser({ id: newUser.id, username: newUser.username, avatar: null, email: newUser.email });
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
    setUser({ id: user.id, username: user.username, avatar: user.avatar || null, email: user.email });
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
  if (!confirm(`确定删除选中的 ${selectedPostIds.size} 篇日记吗？`)) return;

  const { content: posts, sha } = await ghGetFile('data/posts.json');
  const filtered = posts.filter(p => !selectedPostIds.has(p.id));
  await ghPutFile('data/posts.json', filtered, sha);

  selectedPostIds.clear();
  showToast('🗑️ 删除成功');
  exitManageMode();
}

async function loadPosts() {
  if (!currentUser) return;
  await loadFriendships();
  const { content: posts } = await ghGetFile('data/posts.json');
  allPostsCache = posts || [];
  const visible = (posts || []).filter(p => canViewPost(p, currentUser.id));
  visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderFeed(visible);
}

function renderFeed(posts) {
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
  container.innerHTML = posts.map(p => `
    <div class="post-card" onclick="viewPost('${p.id}')">
      <div class="post-header">
        ${getAvatarHtml(p.authorName, p.authorAvatar)}
        <div style="flex:1;">
          <span class="post-author">${escapeHtml(p.authorName)}</span>
          <span class="post-vis">${visLabel(p.visibility)}</span>
        </div>
      </div>
      ${p.image ? `<img src="${p.image}" class="post-img">` : ''}
      ${p.video ? `<video src="${p.video}" controls class="post-video"></video>` : ''}
      <p class="post-text">${escapeHtml(p.text)}</p>
      <div class="post-time">${formatTime(p.createdAt)}</div>
    </div>
  `).join('');
}

function getAvatarHtml(name, avatarUrl) {
  if (avatarUrl) {
    return `<img src="${avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;margin-right:10px;flex-shrink:0;">`;
  }
  // 默认头像：昵称首字 + 渐变背景
  const initial = (name || '?').charAt(0).toUpperCase();
  const colors = ['#667eea','#764ba2','#f093fb','#4facfe','#43e97b','#fa709a','#fee140','#30cfd0'];
  const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
  return `<div style="width:36px;height:36px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;margin-right:10px;flex-shrink:0;">${escapeHtml(initial)}</div>`;
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
  return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ---- View post detail ----
async function viewPost(id) {
  const { content: posts } = await ghGetFile('data/posts.json');
  const post = posts.find(p => p.id === id);
  if (!post) return;
  if (!canViewPost(post, currentUser.id)) {
    alert('无权查看');
    return;
  }
  document.getElementById('detail-content').innerHTML = `
    <div class="detail-header">
      <span class="post-author">${escapeHtml(post.authorName)}</span>
      <span class="post-vis">${visLabel(post.visibility)}</span>
    </div>
    ${post.image ? `<img src="${post.image}" class="detail-img">` : ''}
    ${post.video ? `<video src="${post.video}" controls class="detail-video"></video>` : ''}
    <p class="detail-text">${escapeHtml(post.text)}</p>
    <div class="post-time">${formatTime(post.createdAt)}</div>
    <button onclick="closeDetail()" class="btn-secondary">返回</button>
  `;
  document.getElementById('detail-view').style.display = 'flex';
}

function closeDetail() {
  document.getElementById('detail-view').style.display = 'none';
}

// ---- Publish ----
let pendingImage = null;
let pendingVideo = null;

function addImage() {
  const input = document.getElementById('img-input');
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('图片请小于 5MB');
      return;
    }
    showToast('正在压缩图片...');
    const base64 = await compressImage(file, 1200, 0.8);
    pendingImage = base64;
    document.getElementById('img-preview').src = 'data:image/jpeg;base64,' + base64;
    document.getElementById('img-preview').style.display = 'block';
    showToast('✅ 图片已添加');
  };
  input.click();
}

function addVideo() {
  const input = document.getElementById('video-input');
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert('视频请小于 20MB');
      return;
    }
    showToast('正在处理视频...');
    const reader = new FileReader();
    reader.onload = ev => {
      const base64 = ev.target.result.split(',')[1];
      pendingVideo = base64;
      pendingVideoName = file.name;
      document.getElementById('video-preview').src = ev.target.result;
      document.getElementById('video-preview').style.display = 'block';
      showToast('✅ 视频已添加');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

let pendingVideoName = '';

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

async function publishPost() {
  const text = document.getElementById('post-text').value.trim();
  const visibility = document.getElementById('visibility').value;

  if (!text && !pendingImage && !pendingVideo) {
    alert('请输入内容或添加图片/视频');
    return;
  }

  try {
    showToast('发布中...');

    let imageUrl = null, videoUrl = null;
    if (pendingImage) {
      imageUrl = await ghUploadMedia('img.jpg', pendingImage);
    }
    if (pendingVideo) {
      videoUrl = await ghUploadMedia(pendingVideoName || 'video.mp4', pendingVideo);
    }

    const post = {
      id: 'p_' + Date.now(),
      authorId: currentUser.id,
      authorName: currentUser.username,
      authorAvatar: currentUser.avatar || null,
      text,
      image: imageUrl,
      video: videoUrl,
      visibility,
      selectedFriends: visibility === 'selected' ? selectedFriendIds : [],
      createdAt: new Date().toISOString()
    };

    const { content: posts, sha } = await ghGetFile('data/posts.json');
    posts.push(post);
    await ghPutFile('data/posts.json', posts, sha);

    // Reset form
    pendingImage = null;
    pendingVideo = null;
    pendingVideoName = '';
    document.getElementById('post-text').value = '';
    document.getElementById('img-preview').style.display = 'none';
    document.getElementById('video-preview').style.display = 'none';
    document.getElementById('visibility').value = 'private';

    showToast('✅ 发布成功！');
    switchTab('feed');
    loadPosts();
  } catch (e) {
    alert('发布失败：' + e.message);
    console.error(e);
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
}

// ---- Friends page ----
async function loadFriendsPage() {
  const { content: users } = await ghGetFile('data/users.json');
  await loadFriendships();

  const myFriends = users.filter(u => u.id !== currentUser.id && isFriend(u.id, currentUser.id));
  const others = users.filter(u => u.id !== currentUser.id && !isFriend(u.id, currentUser.id));

  let html = '<h3>👥 我的好友</h3>';
  if (myFriends.length) {
    html += myFriends.map(u => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#fff;border-radius:10px;margin-bottom:8px;">
        <span>${escapeHtml(u.username)}</span>
        <button onclick="removeFriend('${u.id}')" class="btn-secondary" style="padding:4px 10px;">删除</button>
      </div>
    `).join('');
  } else {
    html += '<p style="color:#999;">还没有好友</p>';
  }

  html += '<h3 style="margin-top:24px;">🔍 其他用户</h3>';
  if (others.length) {
    html += others.map(u => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#fff;border-radius:10px;margin-bottom:8px;">
        <span>${escapeHtml(u.username)}</span>
        <button onclick="addFriend('${u.id}')" class="btn-primary" style="padding:4px 10px;">+ 加好友</button>
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
  const { content: invites, sha } = await ghGetFile('data/invites.json');
  // 清理过期的
  const valid = cleanExpiredInvites(invites);
  if (valid.length !== invites.length) {
    await ghPutFile('data/invites.json', valid, sha);
  }

  const available = valid.filter(i => !i.used_by);
  document.getElementById('invite-list').innerHTML = available.map(i => {
    const remain = inviteRemaining(i);
    return `<div style="padding:10px;background:#fff;border-radius:10px;margin-bottom:8px;">
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
      avatarEl.src = currentUser.avatar || getAvatarUrl(currentUser.username);
    }
    const nameEl = document.getElementById('profile-name-preview');
    if (nameEl) nameEl.textContent = currentUser.username;
    const emailEl = document.getElementById('profile-email-preview');
    if (emailEl) emailEl.textContent = currentUser.email || '';
  }
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
  document.getElementById('export-modal').style.display = 'none';
}

function openImportModal() {
  importData = null;
  document.getElementById('import-file').value = '';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-modal').style.display = 'flex';
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

async function doImport() {
  if (!importData) {
    alert('请先选择备份文件');
    return;
  }
  if (!confirm(`确定导入 ${importData.posts.length} 篇日记吗？`)) return;

  const { content: posts, sha } = await ghGetFile('data/posts.json');
  // 重新生成 id，避免冲突；作者改为当前用户
  const newPosts = importData.posts.map(p => ({
    ...p,
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    authorId: currentUser.id,
    authorName: currentUser.username,
    authorAvatar: currentUser.avatar || null,
    createdAt: p.createdAt || new Date().toISOString()
  }));
  const merged = [...(posts || []), ...newPosts];
  await ghPutFile('data/posts.json', merged, sha);

  importData = null;
  closeImportModal();
  showToast('✅ 成功导入 ' + newPosts.length + ' 篇日记');
  switchTab('feed');
}

function closeImportModal() {
  document.getElementById('import-modal').style.display = 'none';
}

// ---- Profile editing ----
let pendingAvatar = null;

function openProfileModal() {
  document.getElementById('edit-username').value = currentUser.username || '';
  document.getElementById('edit-email').value = currentUser.email || '';
  document.getElementById('edit-password').value = '';
  pendingAvatar = null;
  const avatarEdit = document.getElementById('profile-avatar-edit');
  avatarEdit.src = currentUser.avatar || getAvatarUrl(currentUser.username);
  document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profile-modal').style.display = 'none';
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
  document.getElementById('cropper-modal').style.display = 'none';
  cropperImg = null;
}

async function saveProfile() {
  const newUsername = document.getElementById('edit-username').value.trim();
  const newEmail = document.getElementById('edit-email').value.trim();
  const newPassword = document.getElementById('edit-password').value;

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
    if (newPassword) {
      user.password = await hashPwd(newPassword);
    }
    await ghPutFile('data/users.json', users, sha);

    // 如果昵称或头像变了，更新所有该用户的日记
    if (newUsername !== oldName || avatarUrl !== currentUser.avatar) {
      const { content: posts, sha: postsSha } = await ghGetFile('data/posts.json');
      posts.forEach(p => {
        if (p.authorId === currentUser.id) {
          p.authorName = newUsername;
          p.authorAvatar = avatarUrl;
        }
      });
      await ghPutFile('data/posts.json', posts, postsSha);
    }

    // 更新本地登录态
    setUser({
      id: currentUser.id,
      username: newUsername,
      email: newEmail,
      avatar: avatarUrl
    });

    closeProfileModal();
    loadSettings();
    showToast('✅ 个人信息已更新');
  } catch (e) {
    alert('保存失败：' + e.message);
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
  switchTab('feed');
  loadPosts();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'publish') loadFriendOptions();
  if (tab === 'friends') loadFriendsPage();
  if (tab === 'settings') loadSettings();
  if (tab === 'feed') loadPosts();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:20px;z-index:9999;font-size:14px;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
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
}

function addSticker(s) {
  const ta = document.getElementById('post-text');
  ta.value += s;
  ta.focus();
}

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) showApp();
  else showAuth();
});
