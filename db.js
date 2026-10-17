const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const db = new DatabaseSync(process.env.DB_FILE || 'social.db');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id != followed_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
`);


// Migrations for databases created by an older version
const addCol = (t, c, def) => {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
};
addCol('users', 'avatar', 'TEXT');
addCol('posts', 'image', 'TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON post_tags(tag);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id);
`);

// Helpers shared by the routes
db.addTags = (postId, text) => {
  const tags = new Set((String(text).match(/#\p{L}[\p{L}\p{N}_]{1,29}/gu) || []).map(t => t.slice(1).toLowerCase()));
  for (const t of tags) db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?,?)').run(postId, t);
};
db.notify = (userId, actorId, type, postId = null) => {
  if (userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)').run(userId, actorId, type, postId);
};

// Demo data so the feed is not empty on first run (password for all demo users: password123)
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const hash = bcrypt.hashSync('password123', 10);
  const iu = db.prepare('INSERT INTO users (username, email, password_hash, display_name, bio) VALUES (?,?,?,?,?)');
  const ip = db.prepare('INSERT INTO posts (user_id, content) VALUES (?,?)');
  [
    ['ada', 'Ada Lovelace', 'First programmer. Poetical science.', ['Just wrote the very first algorithm. Not bad for 1843 ⚡ #firstalgorithm #coding', 'Imagination is the discovering faculty.']],
    ['linus', 'Linus T.', 'Kernel hacker. Coffee enthusiast.', ['Talk is cheap. Show me the code.', 'Shipped a tiny side project this weekend. Open source, of course. #opensource #coding']],
    ['grace', 'Grace Hopper', 'Compiler pioneer. Debugging since forever.', ['Found a real bug in the machine today. Taped it in the logbook 🐛 #debugging', 'The most dangerous phrase: we have always done it this way.']]
  ].forEach(([u, n, b, posts]) => {
    const id = Number(iu.run(u, `${u}@demo.local`, hash, n, b).lastInsertRowid);
    posts.forEach(t => db.addTags(Number(ip.run(id, t).lastInsertRowid), t));
  });
}
module.exports = db;
