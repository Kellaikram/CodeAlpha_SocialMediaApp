const router = require('express').Router();
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validImage, sendImage } = require('../lib');

const findUser = name => db.prepare('SELECT * FROM users WHERE username = ?').get(String(name));
const PEOPLE = `SELECT u.id, u.username, u.display_name, u.avatar IS NOT NULL AS has_avatar,
  (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS followers,
  EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_id = u.id) AS is_following FROM users u`;
const fmt = r => ({ ...r, has_avatar: !!r.has_avatar, is_following: !!r.is_following });

// Search users (?q=) or, with no query, suggest people you don't follow yet
router.get('/', optionalAuth, (req, res) => {
  const uid = req.user?.id || 0, q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(`${PEOPLE} WHERE u.username LIKE ? OR u.display_name LIKE ? ORDER BY followers DESC LIMIT 8`).all(uid, `%${q}%`, `%${q}%`)
    : db.prepare(`${PEOPLE} WHERE u.id != ? AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_id = u.id)
        ORDER BY followers DESC, u.id LIMIT 5`).all(uid, uid, uid);
  res.json(rows.map(fmt));
});

router.put('/me', requireAuth, (req, res) => {
  const name = String(req.body?.display_name ?? '').trim(), bio = String(req.body?.bio ?? '').trim();
  const { avatar } = req.body || {};
  if (!name || name.length > 40) return res.status(400).json({ error: 'Name must be 1-40 characters' });
  if (bio.length > 160) return res.status(400).json({ error: 'Bio must be 160 characters max' });
  if (avatar !== undefined && avatar !== null && !validImage(avatar, 400000)) return res.status(400).json({ error: 'Invalid image' });
  if (avatar === undefined) db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.id);
  else db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar = ? WHERE id = ?').run(name, bio, avatar, req.user.id);
  res.json({ username: req.user.username, display_name: name, bio });
});

router.get('/:username', optionalAuth, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const n = sql => db.prepare(sql).get(u.id).n;
  res.json({
    username: u.username, display_name: u.display_name, bio: u.bio, created_at: u.created_at, has_avatar: !!u.avatar,
    posts: n('SELECT COUNT(*) n FROM posts WHERE user_id = ?'),
    followers: n('SELECT COUNT(*) n FROM follows WHERE followed_id = ?'),
    following: n('SELECT COUNT(*) n FROM follows WHERE follower_id = ?'),
    is_following: req.user ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(req.user.id, u.id) : false,
    is_me: req.user?.id === u.id
  });
});

router.get('/:username/avatar', (req, res) => sendImage(res, findUser(req.params.username)?.avatar));

const list = (col, other) => (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(db.prepare(`${PEOPLE} WHERE u.id IN (SELECT ${other} FROM follows WHERE ${col} = ?) ORDER BY u.username LIMIT 100`)
    .all(req.user?.id || 0, u.id).map(fmt));
};
router.get('/:username/followers', optionalAuth, list('followed_id', 'follower_id'));
router.get('/:username/following', optionalAuth, list('follower_id', 'followed_id'));

router.post('/:username/follow', requireAuth, (req, res) => {
  const t = findUser(req.params.username);
  if (!t) return res.status(404).json({ error: 'User not found' });
  if (t.id === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself' });
  const r = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?,?)').run(req.user.id, t.id);
  if (r.changes > 0) db.notify(t.id, req.user.id, 'follow');
  res.json({ following: true });
});

router.delete('/:username/follow', requireAuth, (req, res) => {
  const t = findUser(req.params.username);
  if (!t) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.user.id, t.id);
  res.json({ following: false });
});
module.exports = router;
