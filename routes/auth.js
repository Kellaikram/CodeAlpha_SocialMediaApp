const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, requireAuth } = require('../middleware/auth');

const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;

router.post('/register', (req, res) => {
  const { username, email, password, display_name } = req.body || {};
  if (!USERNAME.test(username || '')) return res.status(400).json({ error: 'Username: 3-20 letters, numbers or _' });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Username already taken' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
  const name = String(display_name || '').trim().slice(0, 40) || username;
  const r = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?,?,?,?)')
    .run(username, email.toLowerCase(), bcrypt.hashSync(password, 10), name);
  const user = { id: Number(r.lastInsertRowid), username, display_name: name, has_avatar: false };
  res.status(201).json({ token: sign(user), user });
});

// "login" can be the email or the username
router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  const l = String(login || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(l.toLowerCase(), l);
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'Invalid login or password' });
  const user = { id: u.id, username: u.username, display_name: u.display_name, has_avatar: !!u.avatar };
  res.json({ token: sign(user), user });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
module.exports = router;
