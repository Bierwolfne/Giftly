const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./giftly.db');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL,
    passwordHash TEXT    NOT NULL,
    createdAt    TEXT    NOT NULL
  )
`);

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

app.listen(PORT, () => {
  console.log(`Giftly server running at http://localhost:${PORT}`);
});
