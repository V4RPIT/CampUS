/**
 * Campus Chat – server.js
 * Express (REST API) + Socket.IO (realtime) + SQLite (storage).
 * Sections: 1 Config/DB · 2 Helpers · 3 Auth · 4 Profile · 5 Communities · 6 Messages · 7 Realtime
 */
const express = require('express'), http = require('http'), crypto = require('crypto');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// ───────── 1. CONFIG & DATABASE (env vars: see .env.example) ─────────
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const INVITE = process.env.SIGNUP_INVITE || '';          // if set, signup requires it (anti-spam)
const DB_PATH = process.env.DB_PATH || './chat.db';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-only-change-me') {
  console.error('Set JWT_SECRET before running in production'); process.exit(1);
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// To add a feature that needs new data, add a table/column here (use ALTER TABLE for existing DBs).
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, hash TEXT,
  recovery_hash TEXT, avatar TEXT DEFAULT '', bio TEXT DEFAULT '', flair TEXT DEFAULT '', created INTEGER);
CREATE TABLE IF NOT EXISTS communities(id INTEGER PRIMARY KEY, name TEXT, code TEXT UNIQUE, owner_id INTEGER, avatar TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS members(community_id INTEGER, user_id INTEGER, PRIMARY KEY(community_id,user_id));
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY, community_id INTEGER, name TEXT);
CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, channel_id INTEGER, dm_key TEXT, user_id INTEGER, body TEXT, attachment TEXT, attachment_id INTEGER, reply_to_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, message_id INTEGER NOT NULL, created INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,message_id));
CREATE INDEX IF NOT EXISTS i_msg_ch ON messages(channel_id,id);
CREATE INDEX IF NOT EXISTS i_msg_dm ON messages(dm_key,id);
CREATE INDEX IF NOT EXISTS i_notifications_user ON notifications(user_id,is_read,id);`);
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachment')) {
  db.exec('ALTER TABLE messages ADD COLUMN attachment TEXT');
}
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachment_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN attachment_id INTEGER');
}
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'reply_to_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER');
}
if (!db.prepare('PRAGMA table_info(communities)').all().some(column => column.name === 'avatar')) {
  db.exec("ALTER TABLE communities ADD COLUMN avatar TEXT DEFAULT ''");
}

// ───────── 2. HELPERS ─────────
const pub = u => ({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio, flair: u.flair });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const isMember = (cid, uid) => !!db.prepare('SELECT 1 FROM members WHERE community_id=? AND user_id=?').get(cid, uid);
const dmKey = (a, b) => [a, b].sort((x, y) => x - y).join(':');           // same key for both people in a DM
const newRecovery = () => crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-'); // XXXX-XXXX-XXXX
const MSG_SQL = 'SELECT m.id,m.channel_id,m.dm_key,m.body,m.attachment,m.attachment_id,m.reply_to_id,m.ts,u.id AS user_id,u.username,u.avatar,u.flair,a.name AS attachment_name,a.type AS attachment_type,a.size AS attachment_size,r.id AS replied_id,r.body AS replied_body,ru.username AS replied_username,ra.name AS replied_attachment_name FROM messages m JOIN users u ON u.id=m.user_id LEFT JOIN attachments a ON a.id=m.attachment_id LEFT JOIN messages r ON r.id=m.reply_to_id LEFT JOIN users ru ON ru.id=r.user_id LEFT JOIN attachments ra ON ra.id=r.attachment_id';
const publicMessage = row => {
  const { attachment_id, attachment_name, attachment_type, attachment_size, reply_to_id, replied_id, replied_body, replied_username, replied_attachment_name, ...message } = row;
  const attachment = message.attachment
    ? JSON.parse(message.attachment)
    : attachment_id ? { id: attachment_id, name: attachment_name, type: attachment_type, size: attachment_size } : null;
  const reply = reply_to_id ? {
    id: replied_id || reply_to_id,
    username: replied_username || 'Unknown',
    body: replied_body || '',
    attachment_name: replied_attachment_name || null,
    deleted: !replied_id
  } : null;
  return { ...message, attachment, reply };
};
const okAvatar = a => a === '' || (typeof a === 'string' && a.length < 150000 && /^(data:image\/|https:\/\/)/.test(a));

function auth(req, res, next) {           // protects routes: needs "Authorization: Bearer <token>"
  try { req.user = getUser(jwt.verify((req.headers.authorization || '').slice(7), SECRET).id); if (!req.user) throw 0; next(); }
  catch { res.status(401).json({ error: 'Please log in again' }); }
}
const fail = (res, code, error) => res.status(code).json({ error });

const app = express();
app.set('trust proxy', 1);                // needed behind Render/Railway/Fly so rate limits see real IPs
app.use(express.json({ limit: '300kb' }));
app.get('/health', (_, res) => res.send('ok'));

app.post('/api/attachments', auth, express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'Choose a non-empty file to upload');
  let name;
  try { name = decodeURIComponent(req.get('X-File-Name') || 'attachment'); }
  catch { return fail(res, 400, 'Invalid file name'); }
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'attachment';
  const requestedType = req.get('X-File-Type') || '';
  const type = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(requestedType)
    ? requestedType : 'application/octet-stream';
  const result = db.prepare('INSERT INTO attachments(owner_id,name,type,size,data,created) VALUES(?,?,?,?,?,?)')
    .run(req.user.id, name, type, req.body.length, req.body, Date.now());
  res.status(201).json({ id: Number(result.lastInsertRowid), name, type, size: req.body.length });
});

app.get('/api/attachments/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 404, 'Attachment not found');
  const attachment = db.prepare('SELECT a.*,m.channel_id,m.dm_key FROM attachments a JOIN messages m ON m.attachment_id=a.id WHERE a.id=?').get(id);
  if (!attachment) return fail(res, 404, 'Attachment not found');
  const allowed = attachment.channel_id !== null
    ? isMember(db.prepare('SELECT community_id FROM channels WHERE id=?').get(attachment.channel_id)?.community_id, req.user.id)
    : attachment.dm_key.split(':').map(Number).includes(req.user.id);
  if (!allowed) return fail(res, 404, 'Attachment not found');
  const safeName = attachment.name.replace(/["\\\r\n]/g, '_');
  res.set({
    'Content-Type': attachment.type,
    'Content-Length': attachment.size,
    'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  });
  res.send(attachment.data);
});

app.use(express.static('public'));

// Anti-spam: tighten/loosen these numbers as needed
const signupLimit = rateLimit({ windowMs: 3600e3, limit: 5, message: { error: 'Too many signups from this network. Try later.' } });
const authLimit = rateLimit({ windowMs: 900e3, limit: 20, message: { error: 'Too many attempts. Try again in a few minutes.' } });

// ───────── 3. AUTH: signup / login / recovery ─────────
app.post('/api/signup', signupLimit, (req, res) => {
  const { username, password, website, invite } = req.body;
  if (website) return fail(res, 400, 'Rejected');                         // honeypot field: bots fill it, humans can't see it
  if (INVITE && invite !== INVITE) return fail(res, 403, 'Invalid invite code');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) return fail(res, 400, 'Username: 3-20 letters, numbers or _');
  if (String(password || '').length < 8) return fail(res, 400, 'Password must be 8+ characters');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return fail(res, 409, 'Username already taken');
  const rec = newRecovery();               // no email needed: user saves this code to reset a forgotten password
  const id = db.prepare('INSERT INTO users(username,hash,recovery_hash,created) VALUES(?,?,?,?)')
    .run(username, bcrypt.hashSync(password, 10), bcrypt.hashSync(rec, 10), Date.now()).lastInsertRowid;
  res.json({ token: sign({ id }), recoveryCode: rec });
});

app.post('/api/login', authLimit, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username || '');
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) return fail(res, 401, 'Wrong username or password');
  res.json({ token: sign(u) });
});

app.post('/api/recover', authLimit, (req, res) => {
  const { username, code, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!u || !bcrypt.compareSync(String(code || '').trim().toUpperCase(), u.recovery_hash)) return fail(res, 401, 'Invalid username or recovery code');
  if (String(password || '').length < 8) return fail(res, 400, 'Password must be 8+ characters');
  const rec = newRecovery();               // codes are single-use: issue a fresh one
  db.prepare('UPDATE users SET hash=?, recovery_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), bcrypt.hashSync(rec, 10), u.id);
  res.json({ token: sign(u), recoveryCode: rec });
});

// ───────── 4. PROFILE ─────────
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));
app.put('/api/me', auth, (req, res) => {
  const { avatar = '', bio = '', flair = '' } = req.body;
  if (!okAvatar(avatar)) return fail(res, 400, 'Avatar must be a small image');
  db.prepare('UPDATE users SET avatar=?, bio=?, flair=? WHERE id=?')
    .run(avatar, String(bio).slice(0, 190), String(flair).slice(0, 20), req.user.id);
  res.json(pub(getUser(req.user.id)));
});

// ───────── 5. COMMUNITIES & CHANNELS ─────────
// Put a user's live sockets into the rooms of a community's channels.
const joinRooms = (uid, cid) => db.prepare('SELECT id FROM channels WHERE community_id=?').all(cid)
  .forEach(c => io.in('u:' + uid).socketsJoin('c:' + c.id));

app.get('/api/communities', auth, (req, res) => res.json(db.prepare(
  'SELECT c.id,c.name,c.avatar FROM communities c JOIN members m ON m.community_id=c.id WHERE m.user_id=? ORDER BY c.id').all(req.user.id)));

app.post('/api/communities', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 30);
  if (name.length < 2) return fail(res, 400, 'Name too short');
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();      // invite code others use to join
  const cid = db.prepare('INSERT INTO communities(name,code,owner_id) VALUES(?,?,?)').run(name, code, req.user.id).lastInsertRowid;
  db.prepare('INSERT INTO members VALUES(?,?)').run(cid, req.user.id);
  ['general', 'notes', 'memes'].forEach(n => db.prepare('INSERT INTO channels(community_id,name) VALUES(?,?)').run(cid, n)); // default sections
  joinRooms(req.user.id, cid);
  res.json({ id: cid, name, avatar: '' });
});

app.post('/api/communities/join', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM communities WHERE code=?').get(String(req.body.code || '').trim().toUpperCase());
  if (!c) return fail(res, 404, 'No community with that code');
  db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').run(c.id, req.user.id);
  joinRooms(req.user.id, c.id);
  res.json({ id: c.id, name: c.name, avatar: c.avatar || '' });
});

app.get('/api/communities/:id', auth, (req, res) => {
  const id = +req.params.id;
  if (!isMember(id, req.user.id)) return fail(res, 403, 'Not a member');
  const c = db.prepare('SELECT * FROM communities WHERE id=?').get(id);
  res.json({
    id, name: c.name, avatar: c.avatar || '', code: c.code, owner: c.owner_id,
    channels: db.prepare('SELECT id,name FROM channels WHERE community_id=? ORDER BY id').all(id),
    members: db.prepare('SELECT u.id,u.username,u.avatar,u.bio,u.flair FROM users u JOIN members m ON m.user_id=u.id WHERE m.community_id=?').all(id)
  });
});

app.put('/api/communities/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const community = db.prepare('SELECT id,owner_id,avatar FROM communities WHERE id=?').get(id);
  if (!community) return fail(res, 404, 'Community not found');
  if (community.owner_id !== req.user.id) return fail(res, 403, 'Only the community owner can change its picture');
  const avatar = req.body.avatar;
  if (!okAvatar(avatar)) return fail(res, 400, 'Community picture must be a small image');
  db.prepare('UPDATE communities SET avatar=? WHERE id=?').run(avatar, id);
  res.json({ id, avatar });
});

app.post('/api/communities/:id/channels', auth, (req, res) => {   // only the owner can add sections
  const id = +req.params.id, c = db.prepare('SELECT * FROM communities WHERE id=?').get(id);
  if (!c || c.owner_id !== req.user.id) return fail(res, 403, 'Only the owner can add channels');
  const name = String(req.body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
  if (!name) return fail(res, 400, 'Bad name');
  const chId = db.prepare('INSERT INTO channels(community_id,name) VALUES(?,?)').run(id, name).lastInsertRowid;
  db.prepare('SELECT user_id FROM members WHERE community_id=?').all(id).forEach(m => io.in('u:' + m.user_id).socketsJoin('c:' + chId));
  res.json({ id: chId, name });
});

app.put('/api/communities/:id/channels/:channelId', auth, (req, res) => {
  const id = +req.params.id, channelId = +req.params.channelId;
  const community = db.prepare('SELECT owner_id FROM communities WHERE id=?').get(id);
  if (!community || community.owner_id !== req.user.id) return fail(res, 403, 'Only the owner can rename channels');
  const channel = db.prepare('SELECT id FROM channels WHERE id=? AND community_id=?').get(channelId, id);
  if (!channel) return fail(res, 404, 'Channel not found');
  const name = String(req.body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
  if (!name) return fail(res, 400, 'Bad name');
  db.prepare('UPDATE channels SET name=? WHERE id=?').run(name, channelId);
  res.json({ id: channelId, name });
});

app.delete('/api/communities/:id/channels/:channelId', auth, (req, res) => {
  const communityId = Number(req.params.id), channelId = Number(req.params.channelId);
  const community = db.prepare('SELECT owner_id FROM communities WHERE id=?').get(communityId);
  if (!community || community.owner_id !== req.user.id) return fail(res, 403, 'Only the community owner can delete channels');
  const channel = db.prepare('SELECT id FROM channels WHERE id=? AND community_id=?').get(channelId, communityId);
  if (!channel) return fail(res, 404, 'Channel not found');
  const members = db.prepare('SELECT user_id FROM members WHERE community_id=?').all(communityId).map(member => member.user_id);
  const removeChannel = db.transaction(() => {
    const attachmentIds = db.prepare('SELECT attachment_id FROM messages WHERE channel_id=? AND attachment_id IS NOT NULL')
      .all(channelId).map(message => message.attachment_id);
    db.prepare('DELETE FROM notifications WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?)').run(channelId);
    db.prepare('UPDATE messages SET reply_to_id=NULL WHERE reply_to_id IN (SELECT id FROM messages WHERE channel_id=?)').run(channelId);
    db.prepare('DELETE FROM messages WHERE channel_id=?').run(channelId);
    db.prepare('DELETE FROM channels WHERE id=?').run(channelId);
    attachmentIds.forEach(id => {
      if (!db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(id)) db.prepare('DELETE FROM attachments WHERE id=?').run(id);
    });
  });
  removeChannel();
  io.to('c:' + channelId).emit('channel-deleted', { channel_id: channelId, community_id: communityId });
  io.in('c:' + channelId).socketsLeave('c:' + channelId);
  members.forEach(userId => {
    const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0').get(userId).count;
    io.to('u:' + userId).emit('notifications-updated', { unread });
  });
  res.json({ ok: true, id: channelId });
});

// ───────── 6. MESSAGE HISTORY (new messages arrive via Socket.IO) ─────────
app.get('/api/messages', auth, (req, res) => {
  if (req.query.channel) {
    const ch = db.prepare('SELECT community_id FROM channels WHERE id=?').get(+req.query.channel);
    if (!ch || !isMember(ch.community_id, req.user.id)) return fail(res, 403, 'No access');
    return res.json(db.prepare(MSG_SQL + ' WHERE m.channel_id=? ORDER BY m.id DESC LIMIT 100').all(+req.query.channel).reverse().map(publicMessage));
  }
  const other = db.prepare('SELECT id FROM users WHERE username=?').get(req.query.dm || '');
  if (!other) return fail(res, 404, 'User not found');
  res.json(db.prepare(MSG_SQL + ' WHERE m.dm_key=? ORDER BY m.id DESC LIMIT 100').all(dmKey(req.user.id, other.id)).reverse().map(publicMessage));
});

app.get('/api/notifications', auth, (req, res) => {
  const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).count;
  const rows = db.prepare(
    'SELECT m.id,m.channel_id,m.dm_key,m.body,m.attachment,m.attachment_id,m.reply_to_id,m.ts,u.id AS user_id,u.username,u.avatar,u.flair,' +
    'a.name AS attachment_name,a.type AS attachment_type,a.size AS attachment_size,r.id AS replied_id,r.body AS replied_body,' +
    'ru.username AS replied_username,ra.name AS replied_attachment_name,n.id AS notification_id,n.is_read,c.name AS channel_name,c.community_id ' +
    'FROM notifications n JOIN messages m ON m.id=n.message_id JOIN users u ON u.id=m.user_id ' +
    'LEFT JOIN attachments a ON a.id=m.attachment_id LEFT JOIN messages r ON r.id=m.reply_to_id ' +
    'LEFT JOIN users ru ON ru.id=r.user_id LEFT JOIN attachments ra ON ra.id=r.attachment_id ' +
    'LEFT JOIN channels c ON c.id=m.channel_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 50'
  ).all(req.user.id);
  const items = rows.map(row => {
    const message = publicMessage(row);
    return {
      ...message,
      notification_id: row.notification_id,
      is_read: !!row.is_read,
      channel_name: row.channel_name,
      dm_peer: row.dm_key ? db.prepare('SELECT username FROM users WHERE id=?').get(
        Number(row.dm_key.split(':').find(id => Number(id) !== req.user.id))
      )?.username : null
    };
  });
  res.json({ unread, items });
});

app.post('/api/notifications/read', auth, (req, res) => {
  const { all, notificationId, channel, dm } = req.body || {};
  if (all) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  } else if (notificationId !== undefined) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(Number(notificationId), req.user.id);
  } else if (channel !== undefined) {
    const channelId = Number(channel);
    const access = Number.isSafeInteger(channelId) && db.prepare(
      'SELECT 1 FROM channels c JOIN members m ON m.community_id=c.community_id WHERE c.id=? AND m.user_id=?'
    ).get(channelId, req.user.id);
    if (!access) return fail(res, 403, 'No access to that channel');
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND message_id IN (SELECT id FROM messages WHERE channel_id=?)')
      .run(req.user.id, channelId);
  } else if (typeof dm === 'string') {
    const other = db.prepare('SELECT id FROM users WHERE username=?').get(dm);
    if (!other) return fail(res, 404, 'User not found');
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND message_id IN (SELECT id FROM messages WHERE dm_key=?)')
      .run(req.user.id, dmKey(req.user.id, other.id));
  } else return fail(res, 400, 'Choose a notification or conversation to mark as read');
  res.json({ unread: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).count });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return fail(res, 404, 'Message not found');
  const message = db.prepare('SELECT id,user_id,channel_id,dm_key,attachment_id FROM messages WHERE id=?').get(id);
  if (!message) return fail(res, 404, 'Message not found');
  const owner = message.channel_id === null ? null : db.prepare(
    'SELECT c.owner_id FROM channels ch JOIN communities c ON c.id=ch.community_id WHERE ch.id=?'
  ).get(message.channel_id)?.owner_id;
  if (message.user_id !== req.user.id && owner !== req.user.id) return fail(res, 403, 'Only the sender or community owner can delete this message');
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM notifications WHERE message_id=?').run(id);
    db.prepare('UPDATE messages SET reply_to_id=NULL WHERE reply_to_id=?').run(id);
    db.prepare('DELETE FROM messages WHERE id=?').run(id);
    if (message.attachment_id && !db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(message.attachment_id)) {
      db.prepare('DELETE FROM attachments WHERE id=?').run(message.attachment_id);
    }
  });
  remove();
  if (message.channel_id !== null) io.to('c:' + message.channel_id).emit('message-deleted', { id, channel_id: message.channel_id });
  else {
    const [first, second] = message.dm_key.split(':').map(Number);
    const sender = db.prepare('SELECT username FROM users WHERE id=?').get(message.user_id);
    const other = db.prepare('SELECT username FROM users WHERE id=?').get(message.user_id === first ? second : first);
    io.to('u:' + first).emit('message-deleted', { id, peer: message.user_id === first ? other.username : sender.username });
    if (second !== first) io.to('u:' + second).emit('message-deleted', { id, peer: message.user_id === second ? other.username : sender.username });
  }
  res.json({ ok: true, id });
});

app.get('/api/dms', auth, (req, res) => {          // list of people you have chatted with
  const me = req.user.id;
  const keys = db.prepare('SELECT dm_key FROM messages WHERE dm_key LIKE ? OR dm_key LIKE ? GROUP BY dm_key ORDER BY MAX(id) DESC')
    .all(me + ':%', '%:' + me).map(r => r.dm_key.split(':').map(Number).find(x => x !== me) ?? me);
  res.json(keys.map(id => pub(getUser(id))));
});

// ───────── 7. REALTIME (Socket.IO) ─────────
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1200 * 1024 });
io.use((s, next) => {                               // every socket must present a valid token
  try { s.user = getUser(jwt.verify(s.handshake.auth.token, SECRET).id); s.user ? next() : next(new Error('auth')); }
  catch { next(new Error('auth')); }
});
io.on('connection', s => {
  const me = s.user;
  s.join('u:' + me.id);                             // personal room (used for DMs)
  db.prepare('SELECT ch.id FROM channels ch JOIN members m ON m.community_id=ch.community_id WHERE m.user_id=?')
    .all(me.id).forEach(r => s.join('c:' + r.id)); // one room per channel the user can see
  let recent = [];
  let typingState = null, typingTimeout;
  const stopTyping = () => {
    clearTimeout(typingTimeout);
    if (!typingState) return;
    io.to(typingState.room).emit('typing', { ...typingState.event, typing: false });
    typingState = null;
  };
  s.on('typing', ({ channel, dm, typing } = {}) => {
    if (!typing) return stopTyping();
    let room, event;
    if (channel !== undefined) {
      const channelId = Number(channel);
      const ok = Number.isInteger(channelId) &&
        db.prepare('SELECT 1 FROM channels c JOIN members m ON m.community_id=c.community_id WHERE c.id=? AND m.user_id=?').get(channelId, me.id);
      if (!ok) return stopTyping();
      room = 'c:' + channelId;
      event = { channel_id: channelId, user_id: me.id, username: me.username };
    } else if (typeof dm === 'string') {
      const other = db.prepare('SELECT id FROM users WHERE username=?').get(dm);
      if (!other || other.id === me.id) return stopTyping();
      room = 'u:' + other.id;
      event = { peer: me.username, user_id: me.id, username: me.username };
    } else return stopTyping();
    if (typingState && typingState.room !== room) stopTyping();
    typingState = { room, event };
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 4000);
    io.to(room).emit('typing', { ...event, typing: true });
  });
  s.on('send', ({ channel, dm, body, attachmentId, replyToId } = {}, acknowledge) => {
    const reply = result => { if (typeof acknowledge === 'function') acknowledge(result); };
    stopTyping();
    const now = Date.now();
    recent = recent.filter(t => now - t < 5000);
    if (recent.length >= 8) {
      const error = 'Slow down a little before sending another message.';
      s.emit('warn', 'Slow down a little!');
      return reply({ ok: false, error });
    }
    recent.push(now);
    body = String(body || '').trim().slice(0, 2000);
    const hasAttachment = attachmentId !== undefined && attachmentId !== null;
    const attachmentIdNumber = Number(attachmentId);
    const uploadedAttachment = hasAttachment && Number.isSafeInteger(attachmentIdNumber)
      ? db.prepare('SELECT id FROM attachments WHERE id=? AND owner_id=?').get(attachmentIdNumber, me.id)
      : null;
    if (hasAttachment && !uploadedAttachment) return reply({ ok: false, error: 'Attachment upload expired or not found. Please upload it again.' });
    if (!body && !uploadedAttachment) return reply({ ok: false, error: 'Write a message or attach a file first.' });
    const hasReply = replyToId !== undefined && replyToId !== null;
    const replyId = Number(replyToId);
    if (hasReply && (!Number.isSafeInteger(replyId) || replyId <= 0)) return reply({ ok: false, error: 'That reply message is not available.' });
    if (channel !== undefined) {
      const channelId = Number(channel);
      const ok = Number.isInteger(channelId) &&
        db.prepare('SELECT 1 FROM channels c JOIN members m ON m.community_id=c.community_id WHERE c.id=? AND m.user_id=?').get(channelId, me.id);
      if (!ok) return reply({ ok: false, error: 'You no longer have access to that channel.' });
      if (hasReply && !db.prepare('SELECT 1 FROM messages WHERE id=? AND channel_id=?').get(replyId, channelId)) {
        return reply({ ok: false, error: 'That reply message is not in this channel.' });
      }
      const recipients = db.prepare('SELECT user_id FROM members WHERE community_id=(SELECT community_id FROM channels WHERE id=?) AND user_id!=?')
        .all(channelId, me.id).map(member => member.user_id);
      const id = db.prepare('INSERT INTO messages(channel_id,user_id,body,attachment,attachment_id,reply_to_id,ts) VALUES(?,?,?,?,?,?,?)')
        .run(channelId, me.id, body, null, uploadedAttachment?.id || null, hasReply ? replyId : null, now).lastInsertRowid;
      const recordNotifications = db.transaction(() => recipients.forEach(userId => {
        db.prepare('INSERT OR IGNORE INTO notifications(user_id,message_id,created) VALUES(?,?,?)').run(userId, id, now);
      }));
      recordNotifications();
      io.to('c:' + channelId).emit('msg', publicMessage(db.prepare(MSG_SQL + ' WHERE m.id=?').get(id)));
      recipients.forEach(userId => {
        const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0').get(userId).count;
        io.to('u:' + userId).emit('notifications-updated', { unread });
      });
      return reply({ ok: true });
    } else if (typeof dm === 'string') {
      const other = db.prepare('SELECT id,username FROM users WHERE username=?').get(dm);
      if (!other) {
        s.emit('warn', 'User not found');
        return reply({ ok: false, error: 'User not found.' });
      }
      const key = dmKey(me.id, other.id);
      if (hasReply && !db.prepare('SELECT 1 FROM messages WHERE id=? AND dm_key=?').get(replyId, key)) {
        return reply({ ok: false, error: 'That reply message is not in this conversation.' });
      }
      const id = db.prepare('INSERT INTO messages(dm_key,user_id,body,attachment,attachment_id,reply_to_id,ts) VALUES(?,?,?,?,?,?,?)')
        .run(key, me.id, body, null, uploadedAttachment?.id || null, hasReply ? replyId : null, now).lastInsertRowid;
      const row = publicMessage(db.prepare(MSG_SQL + ' WHERE m.id=?').get(id));
      io.to('u:' + me.id).emit('msg', { ...row, peer: other.username });          // "peer" = the other person, from each side's view
      if (other.id !== me.id) {
        io.to('u:' + other.id).emit('msg', { ...row, peer: me.username });
        db.prepare('INSERT OR IGNORE INTO notifications(user_id,message_id,created) VALUES(?,?,?)').run(other.id, id, now);
        const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0').get(other.id).count;
        io.to('u:' + other.id).emit('notifications-updated', { unread });
      }
      return reply({ ok: true });
    } else reply({ ok: false, error: 'Open a channel or direct message before sending.' });
  });
  s.on('disconnect', stopTyping);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return fail(res, 413, 'File exceeds the 50 MB upload limit');
  next(err);
});

server.listen(PORT, () => console.log('Campus Chat running on port ' + PORT));
