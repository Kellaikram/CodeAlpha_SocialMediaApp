// npm test — starts the real server on port 3998 with a throwaway database and calls every API route.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3998;
const BASE = `http://localhost:${PORT}/api`;
const DB_FILE = path.join(__dirname, 'test.db');
const stamp = Date.now().toString(36);
const A = { username: `alice_${stamp}`, email: `alice${stamp}@example.com`, password: 'password123' };
const B = { username: `bob_${stamp}`, email: `bob${stamp}@example.com`, password: 'password123' };
let server, ta, tb, postId;

async function call(p, { method = 'GET', body, auth } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const clean = () => { for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.rmSync(f, { force: true }); } catch {} } };

before(async () => {
  clean();
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_FILE, JWT_SECRET: 'test-secret' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/posts'); return; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error('Server did not start');
});
after(() => { server.kill(); });

// ---------- Auth ----------
test('register rejects bad input', async () => {
  const post = body => call('/auth/register', { method: 'POST', body });
  assert.equal((await post({ ...A, username: 'a!' })).status, 400);
  assert.equal((await post({ ...A, password: '123' })).status, 400);
  assert.equal((await post({ ...A, email: 'nope' })).status, 400);
});

test('register creates users and returns tokens', async () => {
  const a = await call('/auth/register', { method: 'POST', body: A });
  const b = await call('/auth/register', { method: 'POST', body: B });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  ta = a.data.token; tb = b.data.token;
  assert.ok(ta && tb);
});

test('register rejects duplicate username (any case) and email', async () => {
  const u = await call('/auth/register', { method: 'POST', body: { ...A, username: A.username.toUpperCase(), email: 'other@example.com' } });
  assert.equal(u.status, 409);
  const e = await call('/auth/register', { method: 'POST', body: { ...A, username: `x_${stamp}` } });
  assert.equal(e.status, 409);
});

test('login works with email or username, fails with wrong password', async () => {
  assert.equal((await call('/auth/login', { method: 'POST', body: { login: A.email, password: A.password } })).status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { login: A.username, password: A.password } })).status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { login: A.email, password: 'wrong-password' } })).status, 401);
});

test('GET /auth/me needs a valid token', async () => {
  assert.equal((await call('/auth/me')).status, 401);
  assert.equal((await call('/auth/me', { auth: ta })).data.user.username, A.username);
});

// ---------- Posts ----------
test('creating a post validates auth and length', async () => {
  const body = { content: 'Hello NeonSocial ⚡' };
  assert.equal((await call('/posts', { method: 'POST', body })).status, 401);
  assert.equal((await call('/posts', { method: 'POST', body: { content: '   ' }, auth: ta })).status, 400);
  assert.equal((await call('/posts', { method: 'POST', body: { content: 'x'.repeat(281) }, auth: ta })).status, 400);
  const r = await call('/posts', { method: 'POST', body, auth: ta });
  assert.equal(r.status, 201);
  assert.equal(r.data.username, A.username);
  assert.equal(r.data.likes, 0);
  postId = r.data.id;
});

test('public feed lists the new post', async () => {
  const r = await call('/posts');
  assert.equal(r.status, 200);
  const p = r.data.find(x => x.id === postId);
  assert.ok(p);
  assert.equal(p.liked, false);
});

// ---------- Likes ----------
test('like / unlike counts are correct and idempotent', async () => {
  assert.equal((await call(`/posts/${postId}/like`, { method: 'POST' })).status, 401);
  await call(`/posts/${postId}/like`, { method: 'POST', auth: ta });
  const again = await call(`/posts/${postId}/like`, { method: 'POST', auth: ta });
  assert.equal(again.data.likes, 1);
  assert.equal((await call(`/posts/${postId}/like`, { method: 'POST', auth: tb })).data.likes, 2);
  assert.equal((await call(`/posts/${postId}/like`, { method: 'DELETE', auth: tb })).data.likes, 1);
  const mine = (await call('/posts', { auth: ta })).data.find(x => x.id === postId);
  assert.equal(mine.liked, true);
  assert.equal((await call('/posts/999999/like', { method: 'POST', auth: ta })).status, 404);
});

// ---------- Comments ----------
test('comments: auth, validation, listing and counter', async () => {
  const url = `/posts/${postId}/comments`;
  assert.equal((await call(url, { method: 'POST', body: { content: 'hi' } })).status, 401);
  assert.equal((await call(url, { method: 'POST', body: { content: '' }, auth: tb })).status, 400);
  assert.equal((await call(url, { method: 'POST', body: { content: 'Nice post!' }, auth: tb })).status, 201);
  const list = await call(url);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].username, B.username);
  assert.equal((await call('/posts')).data.find(x => x.id === postId).comments, 1);
});

// ---------- Follows ----------
test('follow rules: not yourself, unknown user, follow and unfollow', async () => {
  assert.equal((await call(`/users/${A.username}/follow`, { method: 'POST', auth: ta })).status, 400);
  assert.equal((await call('/users/nobody_here/follow', { method: 'POST', auth: ta })).status, 404);
  assert.equal((await call('/users/ada/follow', { method: 'POST', auth: ta })).data.following, true);
  const ada = await call('/users/ada', { auth: ta });
  assert.equal(ada.data.is_following, true);
  assert.ok(ada.data.followers >= 1);
  assert.equal((await call('/users/ada/follow', { method: 'DELETE', auth: ta })).data.following, false);
  assert.equal((await call('/users/ada', { auth: ta })).data.is_following, false);
});

test('following feed = my posts + posts of people I follow', async () => {
  assert.equal((await call('/posts?feed=following')).status, 401);
  await call('/users/ada/follow', { method: 'POST', auth: ta });
  const feed = (await call('/posts?feed=following', { auth: ta })).data;
  assert.ok(feed.some(p => p.id === postId));
  assert.ok(feed.some(p => p.username === 'ada'));
  assert.ok(feed.every(p => [A.username, 'ada'].includes(p.username)));
  const bobFeed = (await call('/posts?feed=following', { auth: tb })).data;
  assert.ok(!bobFeed.some(p => p.id === postId));
});

// ---------- Profiles ----------
test('profile shows counts and can be edited', async () => {
  const p = await call(`/users/${A.username}`);
  assert.equal(p.status, 200);
  assert.equal(p.data.posts, 1);
  assert.equal(p.data.following, 1);
  assert.equal((await call('/users/me', { method: 'PUT', body: { display_name: 'Alice', bio: 'x' } })).status, 401);
  assert.equal((await call('/users/me', { method: 'PUT', body: { display_name: '', bio: '' }, auth: ta })).status, 400);
  const r = await call('/users/me', { method: 'PUT', body: { display_name: 'Alice Neon', bio: 'Full stack dreamer' }, auth: ta });
  assert.equal(r.status, 200);
  const after = await call(`/users/${A.username}`);
  assert.equal(after.data.display_name, 'Alice Neon');
  assert.equal(after.data.bio, 'Full stack dreamer');
  assert.equal((await call('/users/does_not_exist')).status, 404);
});

test('user search finds people by name', async () => {
  const r = await call(`/users?q=alice_${stamp}`);
  assert.ok(r.data.some(u => u.username === A.username));
});

// ---------- Extra features ----------
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('image posts: validation, upload and serving', async () => {
  assert.equal((await call('/posts', { method: 'POST', body: { content: 'x', image: 'not-an-image' }, auth: ta })).status, 400);
  const r = await call('/posts', { method: 'POST', body: { content: '', image: PNG }, auth: ta });
  assert.equal(r.status, 201);
  assert.equal(r.data.has_image, true);
  const img = await fetch(`${BASE}/posts/${r.data.id}/image`);
  assert.equal(img.status, 200);
  assert.ok(img.headers.get('content-type').startsWith('image/png'));
  assert.equal((await fetch(`${BASE}/posts/${postId}/image`)).status, 404);
});

test('GET /posts/:id returns one post, 404 if missing', async () => {
  const r = await call(`/posts/${postId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.id, postId);
  assert.equal((await call('/posts/999999')).status, 404);
});

test('hashtags are indexed, trending and filterable', async () => {
  const tag = `tag${stamp}`;
  const r = await call('/posts', { method: 'POST', body: { content: `Learning #${tag} today` }, auth: ta });
  assert.equal(r.status, 201);
  assert.ok((await call('/posts/tags/trending')).data.some(t => t.tag === tag));
  const f = await call(`/posts?tag=${tag}`);
  assert.equal(f.data.length, 1);
  assert.equal(f.data[0].id, r.data.id);
});

test('bookmarks: save, saved feed, unsave', async () => {
  assert.equal((await call(`/posts/${postId}/save`, { method: 'POST' })).status, 401);
  assert.equal((await call(`/posts/${postId}/save`, { method: 'POST', auth: tb })).data.saved, true);
  assert.ok((await call('/posts?feed=saved', { auth: tb })).data.some(p => p.id === postId && p.saved));
  assert.equal((await call('/posts?feed=saved')).status, 401);
  await call(`/posts/${postId}/save`, { method: 'DELETE', auth: tb });
  assert.ok(!(await call('/posts?feed=saved', { auth: tb })).data.some(p => p.id === postId));
});

test('notifications: likes, comments and follows notify the other user', async () => {
  await call(`/users/${A.username}/follow`, { method: 'POST', auth: tb });
  const n = await call('/notifications', { auth: ta });
  const types = n.data.map(x => x.type);
  assert.ok(types.includes('like') && types.includes('comment') && types.includes('follow'));
  assert.ok(n.data.every(x => x.username === B.username));
  assert.ok((await call('/notifications/count', { auth: ta })).data.notifications >= 3);
  await call('/notifications/read', { method: 'POST', auth: ta });
  assert.equal((await call('/notifications/count', { auth: ta })).data.notifications, 0);
  assert.equal((await call('/notifications')).status, 401);
});

test('comment deletion: author or post owner only', async () => {
  const url = `/posts/${postId}/comments`;
  const cb = await call(url, { method: 'POST', body: { content: 'temp' }, auth: tb });
  const ca = await call(url, { method: 'POST', body: { content: 'mine' }, auth: ta });
  assert.equal((await call(`${url}/${ca.data.id}`, { method: 'DELETE', auth: tb })).status, 403);
  assert.equal((await call(`${url}/${cb.data.id}`, { method: 'DELETE', auth: ta })).status, 200);
  assert.equal((await call(`${url}/${ca.data.id}`, { method: 'DELETE', auth: ta })).status, 200);
});

test('followers / following lists', async () => {
  const f = await call(`/users/${A.username}/followers`, { auth: ta });
  assert.ok(f.data.some(u => u.username === B.username));
  const g = await call(`/users/${B.username}/following`);
  assert.ok(g.data.some(u => u.username === A.username));
  assert.equal((await call('/users/nobody_here/followers')).status, 404);
});

test('avatar upload and serving', async () => {
  const put = avatar => call('/users/me', { method: 'PUT', body: { display_name: 'Alice Neon', bio: 'Full stack dreamer', avatar }, auth: ta });
  assert.equal((await put('bad')).status, 400);
  assert.equal((await put(PNG)).status, 200);
  assert.equal((await call(`/users/${A.username}`)).data.has_avatar, true);
  assert.equal((await fetch(`${BASE}/users/${A.username}/avatar`)).status, 200);
  assert.equal((await fetch(`${BASE}/users/${B.username}/avatar`)).status, 404);
  assert.equal((await put(null)).status, 200);
  assert.equal((await call(`/users/${A.username}`)).data.has_avatar, false);
});

test('direct messages: send, conversations, unread counter, read', async () => {
  const send = (to, content, auth) => call(`/messages/${to}`, { method: 'POST', body: { content }, auth });
  assert.equal((await send(A.username, 'hey')).status, 401);
  assert.equal((await send(B.username, 'me', tb)).status, 400);
  assert.equal((await send(A.username, '', tb)).status, 400);
  assert.equal((await send('nobody_here', 'x', ta)).status, 404);
  assert.equal((await send(A.username, 'Hello Alice', tb)).status, 201);
  const conv = await call('/messages', { auth: ta });
  assert.equal(conv.data[0].username, B.username);
  assert.equal(conv.data[0].unread, 1);
  assert.equal((await call('/notifications/count', { auth: ta })).data.messages, 1);
  const th = await call(`/messages/${B.username}`, { auth: ta });
  assert.equal(th.data.length, 1);
  assert.equal(th.data[0].mine, false);
  assert.equal((await call('/notifications/count', { auth: ta })).data.messages, 0);
});

// ---------- Delete ----------
test('only the owner can delete a post; comments and likes go with it', async () => {
  assert.equal((await call(`/posts/${postId}`, { method: 'DELETE', auth: tb })).status, 403);
  assert.equal((await call(`/posts/${postId}`, { method: 'DELETE', auth: ta })).status, 200);
  assert.ok(!(await call('/posts')).data.some(p => p.id === postId));
  assert.equal((await call(`/posts/${postId}`, { method: 'DELETE', auth: ta })).status, 404);
  assert.equal((await call(`/posts/${postId}/comments`)).status, 404);
});

test('unknown API route returns 404 JSON', async () => {
  assert.equal((await call('/nope')).status, 404);
});
