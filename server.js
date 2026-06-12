const express = require('express');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// In-memory user store (replace with a database in production)
const users = new Map();

app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

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

  if (users.has(normalizedEmail)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  users.set(normalizedEmail, { email: normalizedEmail, passwordHash, createdAt: new Date() });

  res.status(201).json({ message: 'Account created successfully.', email: normalizedEmail });
});

app.listen(PORT, () => {
  console.log(`Giftly server running at http://localhost:${PORT}`);
});
