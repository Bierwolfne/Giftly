require('dotenv').config();

const express = require('express');
const bcrypt  = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app  = express();
const PORT = process.env.PORT || 3000;

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// ── Webhook — raw body required; registered BEFORE express.json() ─────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.mode === 'subscription') {
        await dbRun(
          'UPDATE users SET subscriptionStatus = ? WHERE stripeCustomerId = ?',
          ['active', obj.customer]
        ).catch(err => console.error('DB error in webhook:', err));
      }
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await dbRun(
        'UPDATE users SET subscriptionStatus = ? WHERE stripeCustomerId = ?',
        [obj.status, obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;

    case 'customer.subscription.deleted':
      await dbRun(
        'UPDATE users SET subscriptionStatus = ? WHERE stripeCustomerId = ?',
        ['canceled', obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;

    case 'invoice.payment_failed':
      await dbRun(
        'UPDATE users SET subscriptionStatus = ? WHERE stripeCustomerId = ?',
        ['past_due', obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./giftly.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      email              TEXT    UNIQUE NOT NULL,
      passwordHash       TEXT    NOT NULL,
      name               TEXT,
      stripeCustomerId   TEXT,
      subscriptionStatus TEXT    DEFAULT 'free',
      createdAt          TEXT    NOT NULL
    )
  `);

  // Migrations for existing databases
  db.run(`ALTER TABLE users ADD COLUMN name TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN stripeCustomerId TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN subscriptionStatus TEXT DEFAULT 'free'`, () => {});

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

  db.run(`ALTER TABLE profiles ADD COLUMN interests TEXT`, () => {});

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

// ── DB helpers ────────────────────────────────────────────────────────────────

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

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  console.log('Signup attempt:', email);

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedName     = name.trim();

  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await dbRun(
    'INSERT INTO users (email, passwordHash, name, createdAt) VALUES (?, ?, ?, ?)',
    [normalizedEmail, passwordHash, trimmedName, new Date().toISOString()]
  );

  res.status(201).json({ message: 'Account created successfully.', email: normalizedEmail, name: trimmedName });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await dbGet('SELECT email, passwordHash, name FROM users WHERE email = ?', [normalizedEmail]);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json({ email: user.email, name: user.name || null });
});

// ── User ──────────────────────────────────────────────────────────────────────

app.get('/user', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email is required.' });

  const user = await dbGet(
    'SELECT email, name, subscriptionStatus FROM users WHERE email = ?',
    [email.toLowerCase().trim()]
  );
  if (!user) return res.status(404).json({ error: 'User not found.' });

  res.json({ email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus || 'free' });
});

// ── Stripe checkout ───────────────────────────────────────────────────────────

app.post('/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on this server.' });

  const { userEmail } = req.body;
  if (!userEmail) return res.status(400).json({ error: 'userEmail is required.' });

  const user = await dbGet('SELECT * FROM users WHERE email = ?', [userEmail.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name:  user.name || undefined,
    });
    customerId = customer.id;
    await dbRun('UPDATE users SET stripeCustomerId = ? WHERE email = ?', [customerId, user.email]);
  }

  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  // Use a pre-created price ID if set, otherwise build the price inline
  const lineItem = process.env.STRIPE_PRICE_ID
    ? { price: process.env.STRIPE_PRICE_ID, quantity: 1 }
    : {
        price_data: {
          currency:     'usd',
          product_data: { name: 'Giftly Pro', description: 'Monthly Giftly Pro subscription' },
          unit_amount:  999,
          recurring:    { interval: 'month' },
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    line_items:           [lineItem],
    success_url:          `${baseUrl}/dashboard.html?upgrade=success`,
    cancel_url:           `${baseUrl}/dashboard.html?upgrade=canceled`,
  });

  res.json({ url: session.url });
});

// ── Profiles ──────────────────────────────────────────────────────────────────

app.post('/profiles', async (req, res) => {
  const { userEmail, name, relationship, birthday, giftBudget, interests } = req.body;

  if (!userEmail || !name || !relationship) {
    return res.status(400).json({ error: 'userEmail, name, and relationship are required.' });
  }

  const user = await dbGet('SELECT id FROM users WHERE email = ?', [userEmail.toLowerCase().trim()]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const interestsJson = Array.isArray(interests) && interests.length > 0
    ? JSON.stringify(interests)
    : null;

  const result = await dbRun(
    'INSERT INTO profiles (userEmail, name, relationship, birthday, giftBudget, interests, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userEmail.toLowerCase().trim(), name.trim(), relationship, birthday || null, giftBudget || null, interestsJson, new Date().toISOString()]
  );

  res.status(201).json({ id: result.lastID, name: name.trim(), relationship, birthday: birthday || null, giftBudget: giftBudget || null, interests: interestsJson });
});

app.get('/profiles', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  const rows = await dbAll(
    'SELECT id, name, relationship, birthday, giftBudget, interests FROM profiles WHERE userEmail = ? ORDER BY createdAt ASC',
    [email.toLowerCase().trim()]
  );

  res.json(rows);
});

// ── Gifts ─────────────────────────────────────────────────────────────────────

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
