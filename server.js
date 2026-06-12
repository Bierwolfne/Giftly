const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./giftly.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT    UNIQUE NOT NULL,
      passwordHash TEXT    NOT NULL,
      createdAt    TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      userEmail    TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      relationship TEXT    NOT NULL,
      birthday     TEXT,
      giftBudget   TEXT,
      createdAt    TEXT    NOT NULL,
      FOREIGN KEY (userEmail) REFERENCES users(email)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      userEmail   TEXT    NOT NULL,
      profileId   INTEGER NOT NULL,
      profileName TEXT    NOT NULL,
      giftId      INTEGER NOT NULL,
      giftName    TEXT    NOT NULL,
      giftPrice   REAL    NOT NULL,
      giftSource  TEXT,
      giftUrl     TEXT,
      assignedAt  TEXT    NOT NULL,
      FOREIGN KEY (userEmail)  REFERENCES users(email),
      FOREIGN KEY (profileId)  REFERENCES profiles(id)
    )
  `);
});

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  console.log('Signup attempt:', email);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await dbRun(
    'INSERT INTO users (email, passwordHash, createdAt) VALUES (?, ?, ?)',
    [normalizedEmail, passwordHash, new Date().toISOString()]
  );

  res.status(201).json({ message: 'Account created successfully.', email: normalizedEmail });
});

app.post('/profiles', async (req, res) => {
  const { userEmail, name, relationship, birthday, giftBudget } = req.body;

  if (!userEmail || !name || !relationship) {
    return res.status(400).json({ error: 'userEmail, name, and relationship are required.' });
  }

  const user = await dbGet('SELECT id FROM users WHERE email = ?', [userEmail.toLowerCase().trim()]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const result = await dbRun(
    'INSERT INTO profiles (userEmail, name, relationship, birthday, giftBudget, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    [userEmail.toLowerCase().trim(), name.trim(), relationship, birthday || null, giftBudget || null, new Date().toISOString()]
  );

  res.status(201).json({ id: result.lastID, name: name.trim(), relationship, birthday: birthday || null, giftBudget: giftBudget || null });
});

app.get('/profiles', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  const rows = await dbAll(
    'SELECT id, name, relationship, birthday, giftBudget FROM profiles WHERE userEmail = ? ORDER BY createdAt ASC',
    [email.toLowerCase().trim()]
  );

  res.json(rows);
});

app.post('/gifts', async (req, res) => {
  const { userEmail, profileId, profileName, giftId, giftName, giftPrice, giftSource, giftUrl } = req.body;

  if (!userEmail || !profileId || !giftId || !giftName) {
    return res.status(400).json({ error: 'userEmail, profileId, giftId, and giftName are required.' });
  }

  const profile = await dbGet('SELECT id FROM profiles WHERE id = ? AND userEmail = ?', [profileId, userEmail.toLowerCase().trim()]);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  const result = await dbRun(
    `INSERT INTO gifts (userEmail, profileId, profileName, giftId, giftName, giftPrice, giftSource, giftUrl, assignedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userEmail.toLowerCase().trim(), profileId, profileName, giftId, giftName, giftPrice || 0, giftSource || null, giftUrl || null, new Date().toISOString()]
  );

  res.status(201).json({ id: result.lastID, profileId, profileName, giftId, giftName });
});

app.get('/gifts', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  const rows = await dbAll(
    'SELECT id, profileId, profileName, giftId, giftName, giftPrice, giftSource, giftUrl, assignedAt FROM gifts WHERE userEmail = ? ORDER BY assignedAt ASC',
    [email.toLowerCase().trim()]
  );

  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Giftly server running at http://localhost:${PORT}`);
});
