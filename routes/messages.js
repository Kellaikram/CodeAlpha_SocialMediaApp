const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const findUser = name => db.prepare('SELECT id FROM users WHERE username = ?').get(String(name));

// One row per conversation: the other user, the last message and the unread count
router.get('/', requireAuth, (req, res) => {
  const id = req.user.id;
  res.json(db.prepare(`SELECT u.username, u.display_name, u.avatar IS NOT NULL AS has_avatar, m.content, m.created_at,
      (SELECT COUNT(*) FROM messages x WHERE x.sender_id = u.id AND x.receiver_id = ? AND x.is_read = 0) AS unread
    FROM users u JOIN messages m ON m.id = (SELECT MAX(id) FROM messages
      WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?))
    WHERE u.id != ? ORDER BY m.id DESC`).all(id, id, id, id).map(c => ({ ...c, has_avatar: !!c.has_avatar })));
});

router.get('/:username', requireAuth, (req, res) => {
  const other = findUser(req.params.username);
  if (!other) return res.status(404).json({ error: 'User not found' });
  const me = req.user.id;
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(other.id, me);
  const rows = db.prepare(`SELECT id, sender_id, content, created_at FROM messages
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY id DESC LIMIT 100`).all(me, other.id, other.id, me);
  res.json(rows.reverse().map(m => ({ id: m.id, content: m.content, created_at: m.created_at, mine: m.sender_id === me })));
});

router.post('/:username', requireAuth, (req, res) => {
  const other = findUser(req.params.username);
  if (!other) return res.status(404).json({ error: 'User not found' });
  if (other.id === req.user.id) return res.status(400).json({ error: 'You cannot message yourself' });
  const content = String(req.body?.content ?? '').trim();
  if (!content || content.length > 500) return res.status(400).json({ error: 'Message must be 1-500 characters' });
  const id = Number(db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)').run(req.user.id, other.id, content).lastInsertRowid);
  res.status(201).json({ id, content, mine: true });
});
module.exports = router;
