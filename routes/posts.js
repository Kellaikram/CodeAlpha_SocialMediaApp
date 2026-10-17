const router = require('express').Router();
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validImage, sendImage } = require('../lib');

const SELECT = `SELECT p.id, p.content, p.created_at, u.username, u.display_name,
  u.avatar IS NOT NULL AS has_avatar, p.image IS NOT NULL AS has_image,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
  EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS saved
  FROM posts p JOIN users u ON u.id = p.user_id`;
const fmt = r => ({ ...r, liked: !!r.liked, saved: !!r.saved, has_image: !!r.has_image, has_avatar: !!r.has_avatar });
const getPost = (id, uid) => { const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(uid, uid, id); return r && fmt(r); };
const pid = req => parseInt(req.params.id, 10) || 0;
const exists = id => db.prepare('SELECT user_id FROM posts WHERE id = ?').get(id);
const likeCount = id => db.prepare('SELECT COUNT(*) n FROM likes WHERE post_id = ?').get(id).n;

// Feed filters: ?feed=following|saved  ?user=username  ?tag=hashtag  ?before=id (pagination)
router.get('/', optionalAuth, (req, res) => {
  const uid = req.user?.id || 0, where = [], args = [uid, uid];
  if (req.query.user) { where.push('u.username = ?'); args.push(String(req.query.user)); }
  if (req.query.tag) { where.push('EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.tag = ?)'); args.push(String(req.query.tag).toLowerCase()); }
  if (req.query.feed === 'following' || req.query.feed === 'saved') {
    if (!uid) return res.status(401).json({ error: 'Please log in first' });
    if (req.query.feed === 'saved') where.push('p.id IN (SELECT post_id FROM bookmarks WHERE user_id = ?)');
    else where.push('(p.user_id = ? OR p.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?))');
    args.push(uid);
    if (req.query.feed === 'following') args.push(uid);
  }
  if (req.query.before) { where.push('p.id < ?'); args.push(parseInt(req.query.before, 10) || 0); }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 20`;
  res.json(db.prepare(sql).all(...args).map(fmt));
});

router.get('/tags/trending', (req, res) => {
  res.json(db.prepare('SELECT tag, COUNT(*) n FROM post_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 6').all());
});

router.post('/', requireAuth, (req, res) => {
  const content = String(req.body?.content ?? '').trim(), image = req.body?.image ?? null;
  if (content.length > 280) return res.status(400).json({ error: 'Post must be 280 characters max' });
  if (image !== null && !validImage(image, 1500000)) return res.status(400).json({ error: 'Invalid image' });
  if (!content && !image) return res.status(400).json({ error: 'Post must have text or an image' });
  const id = Number(db.prepare('INSERT INTO posts (user_id, content, image) VALUES (?,?,?)').run(req.user.id, content, image).lastInsertRowid);
  db.addTags(id, content);
  res.status(201).json(getPost(id, req.user.id));
});

router.get('/:id', optionalAuth, (req, res) => {
  const p = getPost(pid(req), req.user?.id || 0);
  p ? res.json(p) : res.status(404).json({ error: 'Post not found' });
});

router.get('/:id/image', (req, res) => sendImage(res, db.prepare('SELECT image FROM posts WHERE id = ?').get(pid(req))?.image));

router.delete('/:id', requireAuth, (req, res) => {
  const p = exists(pid(req));
  if (!p) return res.status(404).json({ error: 'Post not found' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own posts' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(pid(req));
  res.json({ ok: true });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const p = exists(pid(req));
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const r = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?,?)').run(req.user.id, pid(req));
  if (r.changes > 0) db.notify(p.user_id, req.user.id, 'like', pid(req));
  res.json({ liked: true, likes: likeCount(pid(req)) });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  if (!exists(pid(req))) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, pid(req));
  res.json({ liked: false, likes: likeCount(pid(req)) });
});

router.post('/:id/save', requireAuth, (req, res) => {
  if (!exists(pid(req))) return res.status(404).json({ error: 'Post not found' });
  db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, post_id) VALUES (?,?)').run(req.user.id, pid(req));
  res.json({ saved: true });
});

router.delete('/:id/save', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(req.user.id, pid(req));
  res.json({ saved: false });
});

router.get('/:id/comments', (req, res) => {
  if (!exists(pid(req))) return res.status(404).json({ error: 'Post not found' });
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username, u.display_name, u.avatar IS NOT NULL AS has_avatar
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(pid(req))
    .map(c => ({ ...c, has_avatar: !!c.has_avatar })));
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const p = exists(pid(req));
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const content = String(req.body?.content ?? '').trim();
  if (!content || content.length > 200) return res.status(400).json({ error: 'Comment must be 1-200 characters' });
  const id = Number(db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?,?,?)').run(pid(req), req.user.id, content).lastInsertRowid);
  db.notify(p.user_id, req.user.id, 'comment', pid(req));
  res.status(201).json({ id, content, username: req.user.username, display_name: req.user.display_name });
});

// The comment author or the post owner can delete a comment
router.delete('/:id/comments/:cid', requireAuth, (req, res) => {
  const c = db.prepare('SELECT c.user_id, p.user_id AS owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND c.post_id = ?')
    .get(parseInt(req.params.cid, 10) || 0, pid(req));
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (req.user.id !== c.user_id && req.user.id !== c.owner) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(parseInt(req.params.cid, 10));
  res.json({ ok: true });
});
module.exports = router;
