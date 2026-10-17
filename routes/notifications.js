const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT n.id, n.type, n.post_id, n.is_read, n.created_at, u.username, u.display_name,
      u.avatar IS NOT NULL AS has_avatar, substr(p.content, 1, 80) AS snippet
    FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN posts p ON p.id = n.post_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 40`).all(req.user.id)
    .map(n => ({ ...n, has_avatar: !!n.has_avatar, is_read: !!n.is_read })));
});

// Unread counters used by the navigation badges
router.get('/count', requireAuth, (req, res) => {
  const n = sql => db.prepare(sql).get(req.user.id).n;
  res.json({
    notifications: n('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0'),
    messages: n('SELECT COUNT(*) n FROM messages WHERE receiver_id = ? AND is_read = 0')
  });
});

router.post('/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});
module.exports = router;
