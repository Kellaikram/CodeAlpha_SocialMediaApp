const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const me = () => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } };
const link = u => `/profile.html?u=${encodeURIComponent(u)}`;
const params = new URLSearchParams(location.search);
const safe = p => p.catch(e => toast(e.message));
// Hashtags (#tag) and mentions (@user) become links; text is escaped first
const rich = t => esc(t)
  .replace(/#(\p{L}[\p{L}\p{N}_]{1,29})/gu, '<a class="tag" href="/?tag=$1">#$1</a>')
  .replace(/@([a-zA-Z0-9_]{3,20})/g, '<a class="tag" href="/profile.html?u=$1">@$1</a>');

const avatar = (u, cls = '') => `<a class="avatar ${cls}" href="${link(u.username)}"><span>${
  u.has_avatar ? `<img src="/api/users/${encodeURIComponent(u.username)}/avatar" alt="">` : esc((u.display_name || u.username)[0].toUpperCase())}</span></a>`;

function ago(s) {
  const d = (Date.now() - new Date(s.replace(' ', 'T') + 'Z')) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}

async function api(path, opts = {}) {
  const t = localStorage.getItem('token');
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && t) { localStorage.removeItem('token'); localStorage.removeItem('user'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
const showMsg = (el, text) => { el.innerHTML = `<div class="msg">${esc(text)}</div>`; };

// Resize an image in the browser so uploads stay small (square crop for avatars)
function readImage(file, max, square) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
      const k = Math.min(1, max / Math.max(sw, sh)), c = document.createElement('canvas');
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read this image'));
    img.src = url;
  });
}

// ----- Theme, navigation and badges -----
if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');
const setBadge = (sel, n) => { const b = $(sel); if (b) { b.textContent = n; b.hidden = !n; } };
async function pollBadges() {
  if (!localStorage.getItem('token')) return;
  try { const c = await api('/notifications/count'); setBadge('#b-n', c.notifications); setBadge('#b-m', c.messages); } catch { /* logged out */ }
}

function renderNav() {
  const u = me(), page = document.body.dataset.page, on = p => (page === p ? 'on' : '');
  $('header').innerHTML = `<a class="brand" href="/">Circle</a>
    <nav>
      <a href="/" class="${on('home')}">🏠 <span>Home</span></a>
      ${u ? `<a href="/messages.html" class="${on('messages')}">✉️ <span>Messages</span><b class="badge" id="b-m" hidden></b></a>
             <a href="/notifications.html" class="${on('notifications')}">🔔 <span>Notifications</span><b class="badge" id="b-n" hidden></b></a>
             <a href="${link(u.username)}" class="${on('profile')}">👤 <span>Profile</span></a>
             <a href="#" id="logout">🚪 <span>Logout</span></a>`
          : `<a href="/login.html" class="${on('login')}">🔑 <span>Login</span></a>`}
      <a href="#" id="theme">🌓 <span>Theme</span></a>
    </nav>
    ${u ? `<div class="me">${avatar(u)}<div><strong>${esc(u.display_name)}</strong><div class="muted">@${esc(u.username)}</div></div></div>` : ''}`;
  const lo = $('#logout');
  if (lo) lo.onclick = e => { e.preventDefault(); localStorage.removeItem('token'); localStorage.removeItem('user'); location.href = '/'; };
  $('#theme').onclick = e => {
    e.preventDefault();
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; localStorage.setItem('theme', next);
  };
  pollBadges();
}

// ----- Posts -----
function postHTML(p) {
  const u = me();
  return `<article class="post" data-id="${p.id}">${avatar(p)}<div class="pbody">
    <div class="phead"><a href="${link(p.username)}"><strong>${esc(p.display_name)}</strong> <span class="muted">@${esc(p.username)}</span></a>
      <span class="muted"><a href="/post.html?id=${p.id}">${ago(p.created_at)}</a>${u && u.username === p.username ? ' <button class="x" data-act="del" title="Delete">✕</button>' : ''}</span></div>
    ${p.content ? `<p class="ptext">${rich(p.content)}</p>` : ''}
    ${p.has_image ? `<img class="pimg" src="/api/posts/${p.id}/image" loading="lazy" alt="">` : ''}
    <div class="actions">
      <button class="act ${p.liked ? 'on' : ''}" data-act="like">${p.liked ? '♥' : '♡'} <span>${p.likes}</span></button>
      <button class="act" data-act="comments">💬 <span>${p.comments}</span></button>
      <button class="act ${p.saved ? 'on-save' : ''}" data-act="save" title="Save">${p.saved ? '★' : '☆'}</button>
    </div><div class="cbox" hidden></div></div></article>`;
}

async function loadComments(post) {
  const list = await api(`/posts/${post.dataset.id}/comments`), u = me();
  post.querySelector('.cbox').innerHTML = list.map(c => `<div class="comment">${avatar(c)}<div class="grow">
    <a href="${link(c.username)}"><strong>${esc(c.display_name)}</strong></a> <span class="muted">${c.created_at ? ago(c.created_at) : 'just now'}</span>
    <div>${rich(c.content)}</div></div>${u && u.username === c.username ? `<button class="x" data-act="delc" data-cid="${c.id}" title="Delete">✕</button>` : ''}</div>`).join('') +
    (u ? '<div class="crow"><input class="cinput" maxlength="200" placeholder="Write a comment..."><button class="btn small" data-act="send">Send</button></div>'
       : '<p class="muted">Log in to comment.</p>');
  post.querySelector('[data-act=comments] span').textContent = list.length;
}

function bindPosts(box) {
  box.onkeydown = e => { if (e.key === 'Enter' && e.target.classList.contains('cinput')) e.target.nextElementSibling.click(); };
  box.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const post = b.closest('.post'), id = post.dataset.id, act = b.dataset.act;
    const needLogin = () => { if (!me()) { location.href = '/login.html'; return true; } };
    try {
      if (act === 'like') {
        if (needLogin()) return;
        const r = await api(`/posts/${id}/like`, { method: b.classList.contains('on') ? 'DELETE' : 'POST' });
        b.classList.toggle('on', r.liked);
        b.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.likes}</span>`;
      } else if (act === 'save') {
        if (needLogin()) return;
        const r = await api(`/posts/${id}/save`, { method: b.classList.contains('on-save') ? 'DELETE' : 'POST' });
        b.classList.toggle('on-save', r.saved);
        b.textContent = r.saved ? '★' : '☆';
        toast(r.saved ? 'Saved ★' : 'Removed from saved');
      } else if (act === 'del') {
        if (confirm('Delete this post?')) { await api('/posts/' + id, { method: 'DELETE' }); post.remove(); toast('Post deleted'); }
      } else if (act === 'comments') {
        const cb = post.querySelector('.cbox');
        cb.hidden = !cb.hidden;
        if (!cb.hidden) await loadComments(post);
      } else if (act === 'send') {
        const inp = post.querySelector('.cinput'), text = inp.value.trim();
        if (!text) return;
        await api(`/posts/${id}/comments`, { method: 'POST', body: { content: text } });
        await loadComments(post);
        post.querySelector('.cinput').focus();
      } else if (act === 'delc') {
        await api(`/posts/${id}/comments/${b.dataset.cid}`, { method: 'DELETE' });
        await loadComments(post);
      }
    } catch (err) { toast(err.message); }
  };
}

// ----- People, follow, trending -----
const personHTML = u => `<div class="person">${avatar(u)}<div class="grow">
  <a href="${link(u.username)}"><strong>${esc(u.display_name)}</strong></a><div class="muted">@${esc(u.username)}</div></div>
  ${me() && me().username !== u.username ? `<button class="btn small ${u.is_following ? 'secondary' : ''}" data-follow="${esc(u.username)}">${u.is_following ? 'Following' : 'Follow'}</button>` : ''}</div>`;

async function toggleFollow(btn) {
  if (!me()) { location.href = '/login.html'; return; }
  const was = btn.classList.contains('secondary');
  const r = await api(`/users/${encodeURIComponent(btn.dataset.follow)}/follow`, { method: was ? 'DELETE' : 'POST' });
  btn.classList.toggle('secondary', r.following);
  btn.textContent = r.following ? 'Following' : 'Follow';
}

function initSidebar(onFollow) {
  const people = $('#people');
  if (!people) return;
  const show = async q => {
    const list = await api('/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    people.innerHTML = list.map(personHTML).join('') || '<p class="muted">No one found.</p>';
  };
  people.onclick = e => { const b = e.target.closest('[data-follow]'); if (b) safe(toggleFollow(b).then(() => onFollow && onFollow())); };
  let t;
  $('#usearch').oninput = e => { clearTimeout(t); t = setTimeout(() => safe(show(e.target.value.trim())), 250); };
  safe(show());
  safe(api('/posts/tags/trending').then(tags => {
    $('#trending').innerHTML = tags.map(t => `<a class="trend" href="/?tag=${encodeURIComponent(t.tag)}"><strong>#${esc(t.tag)}</strong><div class="muted">${t.n} post${t.n > 1 ? 's' : ''}</div></a>`).join('') || '<p class="muted">No hashtags yet.</p>';
  }));
}

const pages = {
  home() {
    const feed = $('#feed'), more = $('#more'), box = $('#composer'), u = me(), tag = params.get('tag');
    let mode = 'all', before = null, image = null;

    if (tag) $('#tagbar').innerHTML = `<div class="panel banner"><strong>Posts tagged #${esc(tag)}</strong><a class="tag" href="/">✕ Clear</a></div>`;
    if (!u) box.innerHTML = '<div class="panel">👋 <a class="tag" href="/login.html"><strong>Log in or register</strong></a> to post, like, comment, message and follow people.</div>';
    else {
      box.innerHTML = `<div class="composer">${avatar(u)}<div class="cwrap"><textarea id="text" rows="2" maxlength="280" placeholder="What's happening, ${esc(u.display_name)}?"></textarea>
        <div class="preview" id="preview" hidden><img id="pimg" alt=""><button id="rmimg" title="Remove">✕</button></div>
        <div class="bar"><button class="iconbtn" id="attach" title="Add photo">📷</button><input type="file" id="file" accept="image/*" hidden>
        <span class="muted" id="count">280</span><button class="btn" id="publish">Post</button></div></div></div>`;
      $('#text').oninput = e => { $('#count').textContent = 280 - e.target.value.length; };
      $('#attach').onclick = () => $('#file').click();
      $('#file').onchange = e => safe(readImage(e.target.files[0], 900, false).then(d => { image = d; $('#pimg').src = d; $('#preview').hidden = false; }));
      $('#rmimg').onclick = () => { image = null; $('#file').value = ''; $('#preview').hidden = true; };
      $('#publish').onclick = () => safe((async () => {
        const p = await api('/posts', { method: 'POST', body: { content: $('#text').value, image } });
        $('#text').value = ''; $('#count').textContent = 280; $('#rmimg').click();
        feed.querySelector('.empty')?.remove();
        feed.insertAdjacentHTML('afterbegin', postHTML(p));
        toast('Posted ✓');
      })());
    }

    const load = async reset => {
      if (reset) { feed.innerHTML = ''; before = null; }
      if (mode !== 'all' && !me()) { feed.innerHTML = '<p class="empty">Log in to use this tab.</p>'; more.hidden = true; return; }
      const list = await api(`/posts?feed=${mode}${tag ? '&tag=' + encodeURIComponent(tag) : ''}${before ? '&before=' + before : ''}`);
      const emptyText = mode === 'saved' ? 'Nothing saved yet. Tap ☆ on a post.' : 'Nothing here yet. Follow people or write the first post!';
      feed.insertAdjacentHTML('beforeend', list.map(postHTML).join('') || (reset ? `<p class="empty">${emptyText}</p>` : ''));
      if (list.length) before = list[list.length - 1].id;
      more.hidden = list.length < 20;
    };
    bindPosts(feed);
    more.onclick = () => safe(load(false));
    $('.tabs').onclick = e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
      mode = t.dataset.mode;
      safe(load(true));
    };
    initSidebar(() => load(true));
    safe(load(true));
  },

  async post() {
    const feed = $('#feed');
    try {
      feed.innerHTML = postHTML(await api('/posts/' + encodeURIComponent(params.get('id'))));
      bindPosts(feed);
      const art = feed.querySelector('.post');
      art.querySelector('.cbox').hidden = false;
      await loadComments(art);
    } catch (e) { feed.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
    initSidebar();
  },

  async profile() {
    const name = params.get('u') || (me() && me().username);
    if (!name) { location.href = '/login.html'; return; }
    const head = $('#head'), feed = $('#feed');

    const draw = async () => {
      let p;
      try { p = await api('/users/' + encodeURIComponent(name)); }
      catch (e) { head.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return false; }
      head.innerHTML = `<div class="pcard"><div class="cover"></div><div class="pinfo">${avatar(p, 'lg')}<div class="grow">
        <h2>${esc(p.display_name)}</h2><div class="muted">@${esc(p.username)}</div>
        <p>${esc(p.bio || 'No bio yet.')}</p>
        <div class="stats"><div><b>${p.posts}</b>Posts</div><div data-list="followers"><b>${p.followers}</b>Followers</div><div data-list="following"><b>${p.following}</b>Following</div></div>
        <div class="btns">${p.is_me ? '<button class="btn secondary" id="edit">Edit profile</button>'
          : `<button class="btn ${p.is_following ? 'secondary' : ''}" data-follow="${esc(p.username)}">${p.is_following ? 'Following' : 'Follow'}</button>
             ${me() ? `<a class="btn secondary" href="/messages.html?u=${encodeURIComponent(p.username)}">Message</a>` : ''}`}</div>
        </div></div></div><div id="editbox"></div>`;
      const f = $('[data-follow]');
      if (f) f.onclick = () => safe(toggleFollow(f).then(draw));
      document.querySelectorAll('[data-list]').forEach(el => el.onclick = () => safe((async () => {
        const kind = el.dataset.list, list = await api(`/users/${encodeURIComponent(name)}/${kind}`);
        $('#listbox').innerHTML = `<div class="panel"><h3 style="margin-bottom:8px;text-transform:capitalize">${kind}</h3>${list.map(personHTML).join('') || '<p class="muted">No one yet.</p>'}</div>`;
      })()));
      const ed = $('#edit');
      if (ed) ed.onclick = () => {
        let newAvatar; // undefined = unchanged, null = remove, data URL = new photo
        $('#editbox').innerHTML = `<div class="panel"><label>Profile photo<input type="file" id="efile" accept="image/*"></label>
          ${p.has_avatar ? '<button class="btn secondary small" id="rmav" style="margin-bottom:12px">Remove current photo</button>' : ''}
          <label>Display name<input id="en" maxlength="40" value="${esc(p.display_name)}"></label>
          <label>Bio<textarea id="eb" rows="3" maxlength="160">${esc(p.bio)}</textarea></label>
          <button class="btn" id="save">Save</button><div id="emsg"></div></div>`;
        $('#efile').onchange = e => safe(readImage(e.target.files[0], 256, true).then(d => { newAvatar = d; toast('Photo ready, press Save'); }));
        const rm = $('#rmav'); if (rm) rm.onclick = () => { newAvatar = null; toast('Photo will be removed'); };
        $('#save').onclick = async () => {
          try {
            const r = await api('/users/me', { method: 'PUT', body: { display_name: $('#en').value, bio: $('#eb').value, avatar: newAvatar } });
            localStorage.setItem('user', JSON.stringify({ ...me(), display_name: r.display_name, has_avatar: newAvatar === undefined ? p.has_avatar : !!newAvatar }));
            toast('Profile updated ✓'); renderNav(); draw();
          } catch (err) { showMsg($('#emsg'), err.message); }
        };
      };
      return true;
    };

    initSidebar(draw);
    if (await draw()) {
      const list = await api('/posts?user=' + encodeURIComponent(name));
      feed.innerHTML = list.map(postHTML).join('') || '<p class="empty">No posts yet.</p>';
      bindPosts(feed);
    }
  },

  async notifications() {
    if (!me()) { location.href = '/login.html?next=/notifications.html'; return; }
    const text = { like: 'liked your post', comment: 'commented on your post', follow: 'started following you' };
    const list = await api('/notifications');
    $('#list').innerHTML = list.map(n => `<div class="notif ${n.is_read ? '' : 'new'}">${avatar(n)}<div>
      <a href="${n.post_id ? '/post.html?id=' + n.post_id : link(n.username)}"><strong>${esc(n.display_name)}</strong> ${text[n.type]}</a>
      <span class="muted">${ago(n.created_at)}</span>${n.snippet ? `<div class="muted">${esc(n.snippet)}</div>` : ''}</div></div>`).join('')
      || '<p class="empty">No notifications yet.</p>';
    await api('/notifications/read', { method: 'POST' });
    setBadge('#b-n', 0);
  },

  messages() {
    if (!me()) { location.href = '/login.html?next=/messages.html'; return; }
    const convs = $('#convs'), thread = $('#thread');
    let current = params.get('u');
    thread.innerHTML = '<p class="empty">Select a conversation</p>';

    const loadConvs = async () => {
      const list = await api('/messages');
      convs.innerHTML = list.map(c => `<div class="person conv ${c.username === current ? 'on' : ''}" data-u="${esc(c.username)}">${avatar(c)}
        <div class="grow"><strong>${esc(c.display_name)}</strong><div class="muted">${esc(c.content.slice(0, 36))}</div></div>
        ${c.unread ? `<b class="badge">${c.unread}</b>` : ''}</div>`).join('')
        || '<p class="muted pad">No conversations yet. Open a profile and tap Message.</p>';
    };
    const refresh = async first => {
      if (!current || !$('#msgs')) return;
      const msgs = await api('/messages/' + encodeURIComponent(current)), box = $('#msgs');
      const near = first || box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
      box.innerHTML = msgs.map(m => `<div class="bubble ${m.mine ? 'mine' : ''}">${esc(m.content)}</div>`).join('') || '<p class="empty">Say hi 👋</p>';
      if (near) box.scrollTop = box.scrollHeight;
      loadConvs(); pollBadges();
    };
    const send = async () => {
      const i = $('#mtext'), t = i.value.trim();
      if (!t) return;
      try { await api('/messages/' + encodeURIComponent(current), { method: 'POST', body: { content: t } }); i.value = ''; refresh(true); }
      catch (e) { toast(e.message); }
    };
    const open = u => {
      current = u;
      history.replaceState(null, '', '/messages.html?u=' + encodeURIComponent(u));
      thread.innerHTML = `<div class="thead"><a href="${link(u)}"><strong>@${esc(u)}</strong></a></div><div id="msgs"></div>
        <div class="crow"><input id="mtext" maxlength="500" placeholder="Message..."><button class="btn" id="msend">Send</button></div>`;
      $('#msend').onclick = send;
      $('#mtext').onkeydown = e => { if (e.key === 'Enter') send(); };
      safe(refresh(true));
    };
    convs.onclick = e => { const c = e.target.closest('[data-u]'); if (c && !e.target.closest('a')) open(c.dataset.u); };
    setInterval(() => safe(refresh(false)), 4000);
    safe(loadConvs());
    if (current) open(current);
  },

  login() {
    const msg = $('#msg'), next = params.get('next');
    const go = async (path, body) => {
      try {
        const r = await api(path, { method: 'POST', body });
        localStorage.setItem('token', r.token); localStorage.setItem('user', JSON.stringify(r.user));
        location.href = next && next.startsWith('/') ? next : '/';
      } catch (e) { showMsg(msg, e.message); }
    };
    $('#loginForm').onsubmit = e => { e.preventDefault(); go('/auth/login', { login: $('#llogin').value, password: $('#lpass').value }); };
    $('#regForm').onsubmit = e => {
      e.preventDefault();
      go('/auth/register', { display_name: $('#rname').value, username: $('#ruser').value, email: $('#remail').value, password: $('#rpass').value });
    };
  }
};

renderNav();
setInterval(pollBadges, 15000);
pages[document.body.dataset.page]?.();
