const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('WARNING: set JWT_SECRET in production.');

const sign = u => jwt.sign({ id: u.id, username: u.username, display_name: u.display_name }, SECRET, { expiresIn: '7d' });
const read = req => jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET);

function requireAuth(req, res, next) {
  try { req.user = read(req); next(); }
  catch { res.status(401).json({ error: 'Please log in first' }); }
}
// Sets req.user when a valid token is sent, but never blocks the request
function optionalAuth(req, res, next) {
  try { req.user = read(req); } catch { /* anonymous */ }
  next();
}
module.exports = { sign, requireAuth, optionalAuth };
