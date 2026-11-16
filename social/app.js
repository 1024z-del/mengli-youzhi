/* ============================================================
 * 梦里有zhi · 社交版
 * 账号 / 好友 / 每条日记单独授权
 * ============================================================ */

const cfg = window.MLYZ_CONFIG || {};
const $ = (sel) => document.querySelector(sel);

let sb = null;
let state = {
  user: null,
  profile: null,
  friends: [],          // [{id, username}]
  media: null,          // { dataUrl, type, file }
  feed: [],
  busy: false
};

/* ---------------- 基础工具 ---------------- */

let toastTimer = null;
function showToast(msg, duration = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const t = new Date(iso);
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/* ---------------- 启动 ---------------- */

async function boot() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    $('#setup-view').classList.remove('hidden');
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  bindAuthEvents();
  bindAppEvents();

  const { data } = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    await enterApp(data.session.user);
  } else {
    $('#auth-view').classList.remove('hidden');
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      state.user = null; state.profile = null; state.friends = []; state.feed = [];
      $('#app-view').classList.add('hidden');
      $('#auth-view').classList.remove('hidden');
    }
  });
}

/* ---------------- 登录 / 注册 ---------------- */

function bindAuthEvents() {
  $('#tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('#tab-signup').addEventListener('click', () => switchAuthTab('signup'));
  $('#btn-login').addEventListener('click', doLogin);
  $('#btn-signup').addEventListener('click', doSignup);
}

function switchAuthTab(which) {
  const isLogin = which === 'login';
  $('#tab-login').classList.toggle('active', isLogin);
  $('#tab-signup').classList.toggle('active', !isLogin);
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#signup-form').classList.toggle('hidden', isLogin);
  $('#auth-sub').textContent = isLogin ? '登录后进入你的私人空间' : '需要邀请码才能注册（向朋友要）';
  $('#auth-hint').textContent = '';
}

async function doLogin() {
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) return showToast('请填写邮箱和密码');

  const btn = $('#btn-login');
  btn.disabled = true; btn.textContent = '登录中...';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = '进入';

  if (error) {
    showToast(/Invalid login/i.test(error.message) ? '邮箱或密码不对' : '登录失败：' + error.message, 3000);
    return;
  }
  await enterApp(data.user);
}

async function doSignup() {
  const username = $('#signup-username').value.trim();
  const email = $('#signup-email').value.trim();
  const password = $('#signup-password').value;
  const invite = $('#signup-invite').value.trim().toUpperCase();

  if (!username || username.length < 2) return showToast('昵称至少 2 个字');
  if (!email.includes('@')) return showToast('邮箱格式不对');
  if (!password || password.length < 6) return showToast('密码至少 6 位');
  if (!invite) return showToast('请填写邀请码');

  const btn = $('#btn-signup');
  btn.disabled = true; btn.textContent = '检查邀请码...';

  try {
    const { data: taken } = await sb.rpc('username_taken', { p_username: username });
    if (taken) { showToast('这个昵称已被用了，换一个'); return; }

    const { data: valid } = await sb.rpc('check_invite', { p_code: invite });
    if (!valid) { showToast('邀请码无效或已被使用', 3000); return; }

    btn.textContent = '注册中...';
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { showToast('注册失败：' + error.message, 3000); return; }

    if (!data.session) {
      showToast('注册成功！请去邮箱点击确认链接，然后回来登录', 6000);
      switchAuthTab('login');
      return;
    }

    await sb.rpc('redeem_invite', { p_code: invite });

    const { error: pErr } = await sb.from('profiles').insert({ id: data.user.id, username });
    if (pErr) { showToast('保存资料失败：' + pErr.message, 3000); return; }

    await enterApp(data.user);
  } finally {
    btn.disabled = false; btn.textContent = '注册并进入';
  }
}

async function doLogout() {
  await sb.auth.signOut();
  location.reload();
}

async function enterApp(user) {
  state.user = user;
  $('#auth-view').classList.add('hidden');
  $('#setup-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');

  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile) {
    // 资料缺失（极少数情况），用一个临时昵称补上
    const tempName = '用户' + user.id.slice(0, 4);
    try {
      await sb.from('profiles').insert({ id: user.id, username: tempName });
    } catch (e) { /* 忽略 */ }
    state.profile = { id: user.id, username: tempName };
  } else {
    state.profile = profile;
  }

  $('#my-username').textContent = state.profile.username;
  $('#my-email').textContent = user.email || '-';

  await loadFriends();
  await loadFeed();
  await loadInvites();
  renderSelectedFriendChecks();
}

/* ---------------- 事件绑定 ---------------- */

function bindAppEvents() {
  // 底部导航
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
      if (page === 'feed') loadFeed();
      if (page === 'friends') { loadFriends(); loadInvites(); }
      if (page === 'publish') renderSelectedFriendChecks();
    });
  });

  $('#btn-refresh').addEventListener('click', async () => {
    showToast('刷新中...', 1200);
    await loadFriends();
    await loadFeed();
    await loadInvites();
    showToast('已刷新');
  });

  // 可见范围
  $('#visibility-select').addEventListener('change', (e) => {
    const show = e.target.value === 'selected';
    $('#selected-friends-box').classList.toggle('hidden', !show);
    if (show) renderSelectedFriendChecks();
  });

  // 贴纸
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = $('#post-text');
      ta.value += btn.textContent;
      ta.focus();
    });
  });

  // 图片 / 视频
  $('#btn-image').addEventListener('click', () => $('#file-image').click());
  $('#btn-video').addEventListener('click', () => $('#file-video').click());
  $('#file-image').addEventListener('change', (e) => handleMediaPick(e, 'image'));
  $('#file-video').addEventListener('change', (e) => handleMediaPick(e, 'video'));
  $('#btn-remove-media').addEventListener('click', clearMedia);

  // 发布
  $('#btn-publish').addEventListener('click', publish);

  // 好友相关
  $('#btn-gen-invite').addEventListener('click', generateInvite);
  $('#btn-add-friend').addEventListener('click', addFriend);
  $('#btn-logout').addEventListener('click', doLogout);

  // 大图
  $('#modal-close').addEventListener('click', () => $('#image-modal').classList.add('hidden'));
  $('#image-modal').addEventListener('click', (e) => {
    if (e.target.id === 'image-modal') $('#image-modal').classList.add('hidden');
  });
}

/* ---------------- 媒体处理 ---------------- */

function handleMediaPick(e, type) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (type === 'video') {
    if (file.size > 60 * 1024 * 1024) return showToast('视频太大啦，最多 60MB', 3000);
    const url = URL.createObjectURL(file);
    state.media = { type: 'video', file, previewUrl: url };
    $('#preview-img').classList.add('hidden');
    $('#preview-video').src = url;
    $('#preview-video').classList.remove('hidden');
    $('#media-preview').classList.remove('hidden');
    showToast(`🎬 视频已选（${(file.size / 1024 / 1024).toFixed(1)}MB）`);
    return;
  }

  // 图片：先压缩再上传，省流量也省空间
  showToast('⏳ 正在处理图片...', 1200);
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1600;
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return showToast('图片处理失败，换一张试试', 3000);
        const url = URL.createObjectURL(blob);
        state.media = { type: 'image', file: new File([blob], 'photo.jpg', { type: 'image/jpeg' }), previewUrl: url };
        $('#preview-video').classList.add('hidden');
        $('#preview-img').src = url;
        $('#preview-img').classList.remove('hidden');
        $('#media-preview').classList.remove('hidden');
        showToast(`📷 图片已选（${Math.round(blob.size / 1024)}KB）`);
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => showToast('这张图片读不出来，换一张试试', 3000);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearMedia() {
  if (state.media && state.media.previewUrl) URL.revokeObjectURL(state.media.previewUrl);
  state.media = null;
  $('#media-preview').classList.add('hidden');
  $('#preview-img').classList.add('hidden');
  $('#preview-video').classList.add('hidden');
  $('#preview-img').removeAttribute('src');
  $('#preview-video').removeAttribute('src');
}

/* ---------------- 发布 ---------------- */

async function publish() {
  if (state.busy) return;
  const text = $('#post-text').value.trim();
  const visibility = $('#visibility-select').value;
  if (!text && !state.media) return showToast('写点什么，或者加张图吧');

  let selectedIds = [];
  if (visibility === 'selected') {
    selectedIds = [...document.querySelectorAll('#selected-friends-list input:checked')].map(i => i.value);
    if (selectedIds.length === 0) return showToast('请至少选择一位好友，或改成"仅自己"');
  }

  state.busy = true;
  const btn = $('#btn-publish');
  btn.disabled = true; btn.textContent = '发布中...';

  try {
    let mediaPath = null;
    let mediaType = null;

    if (state.media) {
      btn.textContent = '上传中...';
      const file = state.media.file;
      const ext = state.media.type === 'video'
        ? (file.name.split('.').pop() || 'mp4')
        : 'jpg';
      const path = `${state.user.id}/${Date.now()}-${randomCode(8)}.${ext}`;
      const { error: upErr } = await sb.storage.from('media').upload(path, file, { upsert: false });
      if (upErr) { showToast('上传失败：' + upErr.message, 4000); return; }
      mediaPath = path;
      mediaType = state.media.type;
    }

    btn.textContent = '发布中...';
    const { data: post, error } = await sb.from('posts').insert({
      author_id: state.user.id,
      text: text || null,
      media_path: mediaPath,
      media_type: mediaType,
      stickers: [],
      visibility
    }).select().single();

    if (error) { showToast('发布失败：' + error.message, 4000); return; }

    if (visibility === 'selected' && selectedIds.length > 0) {
      const rows = selectedIds.map(uid => ({ post_id: post.id, user_id: uid }));
      const { error: aclErr } = await sb.from('post_acl').insert(rows);
      if (aclErr) showToast('部分好友授权失败：' + aclErr.message, 4000);
    }

    // 清空表单
    $('#post-text').value = '';
    clearMedia();
    $('#visibility-select').value = 'private';
    $('#selected-friends-box').classList.add('hidden');

    showToast('✨ 发布成功');
    await loadFeed();
    document.querySelector('.nav-item[data-page="feed"]').click();
  } finally {
    state.busy = false;
    btn.disabled = false; btn.textContent = '✨ 发布';
  }
}

/* ---------------- 动态 ---------------- */

async function loadFeed() {
  if (!state.user) return;
  const { data: posts, error } = await sb.from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) { showToast('加载失败：' + error.message, 3000); return; }

  const list = posts || [];
  const authorIds = [...new Set(list.map(p => p.author_id))];
  let nameMap = {};
  if (authorIds.length > 0) {
    const { data: profs } = await sb.from('profiles').select('id, username').in('id', authorIds);
    (profs || []).forEach(p => { nameMap[p.id] = p.username; });
  }

  // 生成图片的临时访问链接
  const items = [];
  for (const p of list) {
    let mediaUrl = null;
    if (p.media_path) {
      const { data: signed } = await sb.storage.from('media').createSignedUrl(p.media_path, 3600);
      mediaUrl = signed ? signed.signedUrl : null;
    }
    items.push({ ...p, authorName: nameMap[p.author_id] || '未知用户', mediaUrl });
  }

  state.feed = items;
  renderFeed();
}

function renderFeed() {
  const container = $('#feed-list');
  const empty = $('#feed-empty');
  container.innerHTML = '';
  $('#feed-count').textContent = state.feed.length ? `共 ${state.feed.length} 条` : '';

  if (state.feed.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  state.feed.forEach(post => {
    const isMine = post.author_id === state.user.id;
    const visLabel = post.visibility === 'private' ? '🔒 仅自己'
      : post.visibility === 'friends' ? '👥 好友可见' : '📩 部分好友';

    const card = document.createElement('article');
    card.className = 'post-card';

    let mediaHtml = '';
    if (post.mediaUrl && post.media_type === 'image') {
      mediaHtml = `<div class="post-media"><img src="${post.mediaUrl}" alt="图片"></div>`;
    } else if (post.mediaUrl && post.media_type === 'video') {
      mediaHtml = `<div class="post-media"><video src="${post.mediaUrl}" controls playsinline preload="metadata"></video></div>`;
    }

    const stickerHtml = (post.stickers && post.stickers.length)
      ? `<div class="post-stickers">${post.stickers.map(escapeHtml).join('')}</div>` : '';

    card.innerHTML = `
      <div class="post-head">
        <div class="avatar">${escapeHtml((post.authorName || '?').slice(0, 1))}</div>
        <span class="post-author">${escapeHtml(post.authorName)}${isMine ? '（我）' : ''}</span>
        <span class="post-time">${timeAgo(post.created_at)}</span>
      </div>
      ${post.text ? `<p class="post-text">${escapeHtml(post.text)}</p>` : ''}
      ${stickerHtml}
      ${mediaHtml}
      <div class="post-foot">
        <span class="badge">${isMine ? visLabel : '来自好友'}</span>
        ${isMine ? '<button class="del-btn">删除</button>' : ''}
      </div>
    `;

    const img = card.querySelector('img');
    if (img) {
      img.addEventListener('click', () => {
        $('#modal-img').src = img.src;
        $('#image-modal').classList.remove('hidden');
      });
    }

    const del = card.querySelector('.del-btn');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm('删除这条日记？')) return;
        const { error } = await sb.from('posts').delete().eq('id', post.id);
        if (error) return showToast('删除失败：' + error.message, 3000);
        if (post.media_path) await sb.storage.from('media').remove([post.media_path]);
        showToast('已删除');
        loadFeed();
      });
    }

    container.appendChild(card);
  });
}

/* ---------------- 好友 ---------------- */

async function loadFriends() {
  if (!state.user) return;
  const me = state.user.id;
  const { data, error } = await sb.from('friendships')
    .select('*')
    .or(`user_a.eq.${me},user_b.eq.${me}`);

  if (error) { console.warn(error); return; }

  const otherIds = (data || []).map(f => (f.user_a === me ? f.user_b : f.user_a));
  state.friends = [];

  if (otherIds.length > 0) {
    const { data: profs } = await sb.from('profiles').select('id, username').in('id', otherIds);
    state.friends = (profs || []).map(p => ({ id: p.id, username: p.username }));
  }

  renderFriends();
}

function renderFriends() {
  const box = $('#friends-list');
  const empty = $('#friends-empty');
  box.innerHTML = '';

  if (state.friends.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  state.friends.forEach(f => {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `
      <div class="avatar">${escapeHtml(f.username.slice(0, 1))}</div>
      <span class="name">${escapeHtml(f.username)}</span>
      <button class="del">删除好友</button>
    `;
    row.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`删除好友 ${f.username}？`)) return;
      const me = state.user.id;
      const { error } = await sb.from('friendships').delete()
        .or(`and(user_a.eq.${me},user_b.eq.${f.id}),and(user_a.eq.${f.id},user_b.eq.${me})`);
      if (error) return showToast('删除失败：' + error.message, 3000);
      showToast('已删除好友');
      await loadFriends();
      await loadFeed();
    });
    box.appendChild(row);
  });
}

function renderSelectedFriendChecks() {
  const box = $('#selected-friends-list');
  if (!box) return;
  const checked = new Set([...box.querySelectorAll('input:checked')].map(i => i.value));
  box.innerHTML = '';

  if (state.friends.length === 0) {
    box.innerHTML = '<p class="muted small">还没有好友，先去「好友」页添加</p>';
    return;
  }

  state.friends.forEach(f => {
    const label = document.createElement('label');
    label.className = 'friend-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = f.id;
    input.checked = checked.has(f.id);
    label.appendChild(input);
    label.appendChild(document.createTextNode(f.username));
    box.appendChild(label);
  });
}

async function addFriend() {
  const name = $('#add-friend-name').value.trim();
  if (!name) return showToast('请输入对方昵称');
  if (name === state.profile.username) return showToast('不能加自己');

  const { data: profile, error } = await sb.from('profiles').select('id, username').eq('username', name).maybeSingle();
  if (error) return showToast('查询失败：' + error.message, 3000);
  if (!profile) return showToast('没有找到这个昵称', 3000);

  const me = state.user.id;
  if (state.friends.some(f => f.id === profile.id)) return showToast('你们已经是好友了');

  const [a, b] = [me, profile.id].sort();
  const { error: insErr } = await sb.from('friendships').insert({ user_a: a, user_b: b });
  if (insErr) return showToast('添加失败：' + insErr.message, 3000);

  $('#add-friend-name').value = '';
  showToast(`✅ 已和 ${profile.username} 成为好友`);
  await loadFriends();
  await loadFeed();
}

/* ---------------- 邀请码 ---------------- */

async function loadInvites() {
  if (!state.user) return;
  const { data, error } = await sb.from('invite_codes')
    .select('*')
    .eq('created_by', state.user.id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.warn(error); return; }
  renderInvites(data || []);
}

function renderInvites(list) {
  const box = $('#invite-list');
  box.innerHTML = '';
  if (list.length === 0) {
    box.innerHTML = '<p class="muted small">还没有生成邀请码</p>';
    return;
  }
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'invite-item';
    div.innerHTML = `
      <span>${escapeHtml(item.code)}</span>
      <span class="used">${item.used_by ? '已使用' : '未使用'}</span>
    `;
    if (!item.used_by) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', () => {
        navigator.clipboard?.writeText(item.code);
        showToast('已复制邀请码');
      });
    }
    box.appendChild(div);
  });
}

async function generateInvite() {
  const code = randomCode(6);
  const { error } = await sb.from('invite_codes').insert({ code, created_by: state.user.id });
  if (error) return showToast('生成失败：' + error.message, 3000);
  showToast(`🎟️ 新邀请码：${code}`, 3000);
  await loadInvites();
}

/* ---------------- 启动 ---------------- */

boot();
