require('dotenv').config();

const express = require('express');
const bcrypt  = require('bcrypt');
const { Pool } = require('pg');

const { runAgent } = require('./agent');

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
          'UPDATE users SET "subscriptionStatus" = $1 WHERE "stripeCustomerId" = $2',
          ['active', obj.customer]
        ).catch(err => console.error('DB error in webhook:', err));
      }
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await dbRun(
        'UPDATE users SET "subscriptionStatus" = $1 WHERE "stripeCustomerId" = $2',
        [obj.status, obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;

    case 'customer.subscription.deleted':
      await dbRun(
        'UPDATE users SET "subscriptionStatus" = $1 WHERE "stripeCustomerId" = $2',
        ['canceled', obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;

    case 'invoice.payment_failed':
      await dbRun(
        'UPDATE users SET "subscriptionStatus" = $1 WHERE "stripeCustomerId" = $2',
        ['past_due', obj.customer]
      ).catch(err => console.error('DB error in webhook:', err));
      break;
  }

  res.json({ received: true });
});

app.use(express.json());


// Render's managed Postgres requires SSL. rejectUnauthorized:false accepts its
// certificate chain. Skip SSL for local connections (they're typically non-TLS).
const isLocalDb = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

// [id, name, description, price, category, interests, icon, bg, source, url]
const CATALOG_SEEDS = [
  [1,  'Anker 622 Magnetic Battery (MagSafe)',    '5,000mAh MagSafe battery snaps to iPhone 12+. No cable needed, folds flat.',                      36,  'tech',    '["Tech","Gaming"]',           '🔋', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B09NWBBQMZ'],
  [2,  'Kindle Paperwhite 16 GB (2023)',           '7" 300ppi glare-free display, warm light, weeks of battery life, IPX8 waterproof.',               160, 'tech',    '["Tech","Reading"]',          '📖', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B0CFPJYX1H'],
  [3,  'Apple AirTag 4-Pack',                      'Precision Finding with Ultra Wideband, works with iPhone Find My. IPX6 rated.',                    89,  'tech',    '["Tech","Travel"]',           '📍', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B0932QJ2JZ'],
  [4,  'Sony WF-C700N True Wireless Earbuds',      'Active noise cancellation, 15-hr battery (35hr with case), multipoint pairing, IPX4.',             100, 'tech',    '["Tech","Music","Gaming"]',   '🎧', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B0BWTL6HMH'],
  [5,  'Govee LED Desk Lamp + Wireless Charger',   'Touch dimming, 4 color temps, 10W Qi charging pad built into base, USB-A port.',                   46,  'tech',    '["Tech","Gaming"]',           '💡', '#EFF6FF', 'Amazon',     'https://www.amazon.com/s?k=govee+desk+lamp+wireless+charger'],
  [6,  'Fujifilm Instax Mini Link 2 Printer',      'Prints credit-card photos from your phone via Bluetooth. Includes 10-shot film pack.',              90,  'tech',    '["Tech","Travel"]',           '📷', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B09P4KG5ZC'],
  [7,  'Logitech MX Master 3S Wireless Mouse',     'Near-silent clicks, MagSpeed scroll, 8K DPI, works on any surface including glass.',               100, 'tech',    '["Tech","Gaming"]',           '🖱️', '#EFF6FF', 'Amazon',     'https://www.amazon.com/dp/B09HM94VDS'],
  [8,  'Personalized Leather-Bound Journal',       'Hand-stitched full-grain leather, name in gold foil, 200 acid-free lined pages, A5.',              45,  'reading', '["Reading"]',                 '📓', '#F0FDF4', 'Etsy',       'https://www.etsy.com/search?q=personalized+leather+journal'],
  [9,  'Marble Arch Bookend Pair',                 'Solid white Carrara marble, 6" arch, heavy enough for a full shelf. Sold as a pair.',               54,  'reading', '["Reading"]',                 '🗿', '#F0FDF4', 'Etsy',       'https://www.etsy.com/search?q=marble+arch+bookends'],
  [10, 'Botanical Magnetic Bookmark Set (6)',       'Hand-painted wildflower prints on 300gsm card, laminated with strong magnets.',                     16,  'reading', '["Reading"]',                 '🔖', '#F0FDF4', 'Etsy',       'https://www.etsy.com/search?q=botanical+magnetic+bookmark+set'],
  [11, 'Glocusent LED Neck Reading Light',          'Rechargeable hands-free book light. 3 color temps × 5 brightness levels. 60-hr battery.',          20,  'reading', '["Reading"]',                 '🔦', '#F0FDF4', 'Amazon',     'https://www.amazon.com/dp/B09HNM3B97'],
  [12, 'Leuchtturm1917 Hardcover Notebook A5',      'Lay-flat smyth-sewn binding, 120g/m² blank pages, elastic closure, ribbon marker.',                22,  'reading', '["Reading"]',                 '🎨', '#F0FDF4', 'Amazon',     'https://www.amazon.com/dp/B07MBHJ7JH'],
  [13, 'Audible Premium Plus 3-Month Gift',         'Unlimited Audible Plus catalog + 3 premium title credits. Delivered by email instantly.',           45,  'reading', '["Reading","Tech"]',          '🎙️', '#F0FDF4', 'Amazon',     'https://www.amazon.com/s?k=audible+gift+membership+3+month'],
  [14, 'Slip Pure Silk Pillowcase – Queen',         '22-momme Slipsilk prevents hair breakage and morning creases. Machine washable.',                   89,  'fashion', '["Fashion"]',                 '🌙', '#FDF4F4', 'Amazon',     'https://www.amazon.com/s?k=slip+pure+silk+pillowcase+queen'],
  [15, 'Artisan Soap & Body Cream Gift Box',        'Six goat-milk soaps and two shea-butter creams in seasonal scents. Ribbon-wrapped.',                58,  'fashion', '["Fashion"]',                 '🧴', '#FDF4F4', 'Etsy',       'https://www.etsy.com/search?q=artisan+soap+lotion+gift+box'],
  [16, 'Jade Roller & Gua Sha Set',                 'Authentic nephrite jade cools and de-puffs skin. Comes with velvet pouch and how-to card.',         26,  'fashion', '["Fashion"]',                 '💚', '#FDF4F4', 'Amazon',     'https://www.amazon.com/s?k=jade+roller+gua+sha+set+nephrite'],
  [17, 'Alaska Bear Weighted Silk Eye Mask',        '22-momme mulberry silk, gentle microbead weight, adjustable strap. Blocks all light.',              24,  'fashion', '["Fashion"]',                 '😴', '#FDF4F4', 'Amazon',     'https://www.amazon.com/s?k=alaska+bear+weighted+silk+sleep+mask'],
  [18, 'Rosemary & Castor Hair Growth Set',         'Scalp massager + cold-pressed castor oil + rosemary serum. Handmade, vegan.',                       32,  'fashion', '["Fashion"]',                 '💆', '#FDF4F4', 'Etsy',       'https://www.etsy.com/search?q=rosemary+castor+oil+hair+growth+gift'],
  [19, 'Rifle Paper Co. Floral Canvas Pouch',       'Block-printed cotton canvas, zip top, two inside pockets. 9×5", great for travel.',                38,  'fashion', '["Fashion","Travel"]',        '👜', '#FDF4F4', 'Amazon',     'https://www.amazon.com/s?k=rifle+paper+co+floral+canvas+pouch'],
  [20, 'Razer Kraken X USB Gaming Headset',         '7.1 surround sound, lightweight frame, bendable cardioid mic, cross-platform compatible.',          50,  'gaming',  '["Gaming","Tech"]',           '🎧', '#F5F0FF', 'Amazon',     'https://www.amazon.com/dp/B07FDBH9RM'],
  [21, 'SteelSeries QcK Heavy XXL Mouse Pad',       'Extra-thick base, micro-textured cloth, anti-fray stitched edges, 36"×12".',                       30,  'gaming',  '["Gaming","Tech"]',           '🖱️', '#F5F0FF', 'Amazon',     'https://www.amazon.com/dp/B000UVRU6A'],
  [22, 'Xbox Game Pass Ultimate 3-Month',           '100+ games, Xbox Live Gold, and EA Play included. Delivered by email.',                             45,  'gaming',  '["Gaming","Tech"]',           '🎮', '#F5F0FF', 'Amazon',     'https://www.amazon.com/s?k=xbox+game+pass+ultimate+3+month+gift'],
  [23, 'Nintendo Switch Sports',                    'Six sports: Tennis, Soccer, Bowling, Volleyball, Badminton, and Chambara. 1–4 players.',            50,  'gaming',  '["Gaming","Sports"]',         '🏸', '#F5F0FF', 'Amazon',     'https://www.amazon.com/dp/B09TFQ42W6'],
  [24, 'Elgato Stream Deck Mini',                   '6 customizable LCD keys for streaming, editing, or app shortcuts. Plug-and-play USB.',              90,  'gaming',  '["Gaming","Tech"]',           '🎛️', '#F5F0FF', 'Amazon',     'https://www.amazon.com/dp/B07DYRS1WH'],
  [25, 'Custom Engraved Controller Stand',          'Hand-cut wood stand for Xbox, PS5, or Nintendo controllers. Gamertag laser-engraved.',              32,  'gaming',  '["Gaming"]',                  '🕹️', '#F5F0FF', 'Etsy',       'https://www.etsy.com/search?q=custom+gaming+controller+stand+engraved'],
  [26, 'National Parks Scratch-Off Poster',         '24×17" scratch-off all 63 US National Parks as you visit. Foil artwork underneath.',                25,  'travel',  '["Travel","Sports"]',         '🗺️', '#FFFBEB', 'Amazon',     'https://www.amazon.com/dp/B078H5LZSH'],
  [27, 'Nikon Aculon A211 Binoculars 10×42',        'Eco-glass multi-coated optics, rubber-armored body. Great for hiking and birding.',                 75,  'travel',  '["Travel","Sports"]',         '🔭', '#FFFBEB', 'Amazon',     'https://www.amazon.com/dp/B004JVKXAS'],
  [28, 'Sea to Summit Nano Tarp Poncho',             'Silnylon, packs to 100g, doubles as emergency tarp. 10 snap closures, stuff sack included.',       60,  'travel',  '["Travel","Sports"]',         '🌧️', '#FFFBEB', 'Amazon',     'https://www.amazon.com/s?k=sea+to+summit+poncho+tarp'],
  [29, 'ENO DoubleNest Hammock',                    'Holds 400 lbs, sets up in 2 minutes, weighs 19oz. Includes stuff sack and slings.',                 70,  'travel',  '["Travel","Sports"]',         '🌴', '#FFFBEB', 'Amazon',     'https://www.amazon.com/dp/B001L9T3PO'],
  [30, 'Cotopaxi Batac 24L Backpack',               'Recycled materials, padded laptop sleeve, dual water bottle pockets. Carry-on compliant.',          90,  'travel',  '["Travel","Sports"]',         '🎒', '#FFFBEB', 'Amazon',     'https://www.amazon.com/s?k=cotopaxi+batac+24l+backpack'],
  [31, 'Airbnb Experience Gift Card ($100)',         'Good for any Airbnb Experience worldwide: cooking, tours, art workshops, and more.',               100, 'travel',  '["Travel","Cooking","Music"]', '🌍', '#FFFBEB', 'Airbnb',     'https://www.airbnb.com/gift-cards'],
  [32, 'Stargazing Night Gift Kit',                 'Personalized star map of a meaningful date + insulated thermos + constellation guide.',             62,  'travel',  '["Travel"]',                  '🌠', '#FFFBEB', 'Etsy',       'https://www.etsy.com/search?q=stargazing+night+gift+kit'],
  [33, 'Yellowbird Hot Sauce Variety 6-Pack',       '6 small-batch sauces: Habanero, Ghost Pepper, Jalapeño, Serrano, Sriracha, and Classic.',           45,  'cooking', '["Cooking"]',                 '🌶️', '#FFF7ED', 'Amazon',     'https://www.amazon.com/s?k=yellowbird+hot+sauce+variety+pack'],
  [34, '3-Month Single-Origin Coffee Sub',          'Freshly roasted beans bi-weekly from rotating farms worldwide. Whole bean or ground.',              72,  'cooking', '["Cooking"]',                 '☕', '#FFF7ED', 'Etsy',       'https://www.etsy.com/search?q=single+origin+coffee+subscription+gift'],
  [35, 'Vahdam India Starter Tea Kit (8 teas)',     '8 full-leaf teas from Indian estates — Assam, Darjeeling, Chai, herbal. Bamboo infuser.',           36,  'cooking', '["Cooking"]',                 '🍵', '#FFF7ED', 'Amazon',     'https://www.amazon.com/dp/B01NAFDTWK'],
  [36, 'Brightland ALIVE + AWAKE Olive Oil Duo',   'Two 375ml bottles: bright cold-pressed EVOO and herb-infused. California single-harvest.',           55,  'cooking', '["Cooking"]',                 '🫒', '#FFF7ED', 'Amazon',     'https://www.amazon.com/s?k=brightland+olive+oil+duo'],
  [37, 'Compartés Artisan Chocolate Set (10)',      '10 single-origin bars in bold flavors: Rose & Champagne, Horchata, Avocado Toast, and more.',       48,  'cooking', '["Cooking"]',                 '🍫', '#FFF7ED', 'Amazon',     'https://www.amazon.com/s?k=compartes+chocolate+bar+gift+set'],
  [38, 'Totally Bamboo 3-Piece Cutting Boards',    'Graduated S/M/L boards with juice groove. NSF certified, moisture-resistant bamboo.',               35,  'cooking', '["Cooking"]',                 '🪵', '#FFF7ED', 'Amazon',     'https://www.amazon.com/dp/B001Y0PUE0'],
  [39, 'MasterClass All-Access Annual Pass',        'Unlimited classes with 180+ instructors: Gordon Ramsay, Ina Garten, Thomas Keller, and more.',      120, 'cooking', '["Cooking","Sports","Music"]', '👨‍🍳', '#FFF7ED', 'MasterClass','https://www.masterclass.com/gift'],
  [40, 'JBL Clip 4 Waterproof Speaker',            'IP67 waterproof, 10hr battery, carabiner clip. Bold JBL sound, built for outdoors.',                80,  'music',   '["Music","Sports","Travel"]',  '🔊', '#FFF0F5', 'Amazon',     'https://www.amazon.com/dp/B09FKG7SBF'],
  [41, 'Fender Play 3-Month Gift Membership',       'Structured video lessons for guitar, bass, and ukulele. Beginner to advanced paths.',               30,  'music',   '["Music"]',                   '🎸', '#FFF0F5', 'Amazon',     'https://www.amazon.com/s?k=fender+play+gift+card'],
  [42, 'Vinyl Record Storage Crate (Walnut)',       'Solid walnut, holds 60 LPs, fits standard 12" sleeves. Hand-finished natural grain.',               45,  'music',   '["Music"]',                   '🎶', '#FFF0F5', 'Etsy',       'https://www.etsy.com/search?q=vinyl+record+storage+crate+walnut+wood'],
  [43, 'Crosley Cruiser Plus Record Player',        'Built-in Bluetooth speaker, 3-speed, pitch control, RCA output. Vintage suitcase style.',           80,  'music',   '["Music","Tech"]',            '🎵', '#FFF0F5', 'Amazon',     'https://www.amazon.com/dp/B098N8FQMF'],
  [44, 'Blue Snowball iCE USB Microphone',          'Plug-and-play USB condenser mic for podcasting and streaming. Cardioid pickup pattern.',            50,  'music',   '["Music","Tech"]',            '🎙️', '#FFF0F5', 'Amazon',     'https://www.amazon.com/dp/B014RIRQOA'],
  [45, 'Music Watercolor Portrait Commission',      'Artist paints a custom watercolor of your person playing their instrument. 8×10" archival print.',  55,  'music',   '["Music"]',                   '🎼', '#FFF0F5', 'Etsy',       'https://www.etsy.com/search?q=personalized+music+watercolor+portrait'],
  [46, 'TheraBand Pro Resistance Band Set',         'All 5 resistance levels, latex-free option. Physical-therapist grade, 5ft per band.',               25,  'sports',  '["Sports"]',                  '💪', '#F0FCFF', 'Amazon',     'https://www.amazon.com/s?k=theraband+professional+resistance+band+set'],
  [47, 'Manduka PRO Yoga Mat 6mm',                  '6mm dense cushion, closed-cell surface, lifetime guarantee. Non-slip even when wet.',               120, 'sports',  '["Sports"]',                  '🧘', '#F0FCFF', 'Amazon',     'https://www.amazon.com/s?k=manduka+pro+yoga+mat'],
  [48, 'Fitbit Inspire 3 Fitness Tracker',          'Daily Readiness Score, stress management, SpO2 sensor, 10-day battery. Slim design.',               100, 'sports',  '["Sports","Tech"]',           '⌚', '#F0FCFF', 'Amazon',     'https://www.amazon.com/dp/B0B5G7H9TG'],
  [49, "Dr Teal's Foaming Bath Soak Gift Set",      '5 Epsom salt soaks: Lavender, Eucalyptus, Pink Himalayan, Charcoal, Pure. 34oz each.',              30,  'sports',  '["Sports"]',                  '🛁', '#F0FCFF', 'Amazon',     'https://www.amazon.com/s?k=dr+teals+foaming+bath+soak+gift+set'],
  [50, 'SKLZ Agility Cone Set with Carry Bag',      '20 disc cones + 4 standard cones + carry bag. For speed training, drills, and kids.',               22,  'sports',  '["Sports"]',                  '🏃', '#F0FCFF', 'Amazon',     'https://www.amazon.com/s?k=sklz+agility+cone+set'],
];

// ── Schema + seed ───────────────────────────────────────────────────────────
// camelCase identifiers are quoted so Postgres preserves their case (unquoted
// identifiers fold to lowercase, which would break row-property access).
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                   SERIAL PRIMARY KEY,
      email                TEXT UNIQUE NOT NULL,
      "passwordHash"       TEXT NOT NULL,
      name                 TEXT,
      "stripeCustomerId"   TEXT,
      "subscriptionStatus" TEXT DEFAULT 'free',
      "createdAt"          TEXT NOT NULL
    )
  `);

  // Migrations for existing databases
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT DEFAULT 'free'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id           SERIAL PRIMARY KEY,
      "userEmail"  TEXT NOT NULL,
      name         TEXT NOT NULL,
      relationship TEXT NOT NULL,
      birthday     TEXT,
      "giftBudget" TEXT,
      "createdAt"  TEXT NOT NULL,
      FOREIGN KEY ("userEmail") REFERENCES users(email)
    )
  `);

  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS interests TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id            SERIAL PRIMARY KEY,
      "userEmail"   TEXT NOT NULL,
      "profileId"   INTEGER NOT NULL,
      "profileName" TEXT NOT NULL,
      "giftId"      INTEGER NOT NULL,
      "giftName"    TEXT NOT NULL,
      "giftPrice"   REAL NOT NULL,
      "giftSource"  TEXT,
      "giftUrl"     TEXT,
      "assignedAt"  TEXT NOT NULL,
      FOREIGN KEY ("userEmail") REFERENCES users(email),
      FOREIGN KEY ("profileId") REFERENCES profiles(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_catalog (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      price       REAL NOT NULL,
      category    TEXT NOT NULL,
      interests   TEXT,
      icon        TEXT,
      bg          TEXT,
      source      TEXT,
      url         TEXT
    )
  `);

  // Bulk-insert the catalog seeds; existing ids are left untouched.
  const placeholders = CATALOG_SEEDS
    .map((_, i) => `(${Array.from({ length: 10 }, (_, j) => `$${i * 10 + j + 1}`).join(',')})`)
    .join(',');
  await pool.query(
    `INSERT INTO gift_catalog (id,name,description,price,category,interests,icon,bg,source,url)
     VALUES ${placeholders}
     ON CONFLICT (id) DO NOTHING`,
    CATALOG_SEEDS.flat()
  );
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// dbGet → first row (or undefined); dbAll → all rows; dbRun → full result.
// Inserts that need the new id append `RETURNING id` and read result.rows[0].id.
async function dbGet(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

function dbRun(sql, params) {
  return pool.query(sql, params);
}

async function dbAll(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
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

  const existing = await dbGet('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await dbRun(
    'INSERT INTO users (email, "passwordHash", name, "createdAt") VALUES ($1, $2, $3, $4)',
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
  const user = await dbGet('SELECT email, "passwordHash", name FROM users WHERE email = $1', [normalizedEmail]);

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
    'SELECT email, name, "subscriptionStatus" FROM users WHERE email = $1',
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

  const user = await dbGet('SELECT * FROM users WHERE email = $1', [userEmail.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name:  user.name || undefined,
    });
    customerId = customer.id;
    await dbRun('UPDATE users SET "stripeCustomerId" = $1 WHERE email = $2', [customerId, user.email]);
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

  const user = await dbGet('SELECT id FROM users WHERE email = $1', [userEmail.toLowerCase().trim()]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const interestsJson = Array.isArray(interests) && interests.length > 0
    ? JSON.stringify(interests)
    : null;

  const result = await dbRun(
    'INSERT INTO profiles ("userEmail", name, relationship, birthday, "giftBudget", interests, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [userEmail.toLowerCase().trim(), name.trim(), relationship, birthday || null, giftBudget || null, interestsJson, new Date().toISOString()]
  );

  res.status(201).json({ id: result.rows[0].id, name: name.trim(), relationship, birthday: birthday || null, giftBudget: giftBudget || null, interests: interestsJson });
});

app.get('/profiles', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  const rows = await dbAll(
    'SELECT id, name, relationship, birthday, "giftBudget", interests FROM profiles WHERE "userEmail" = $1 ORDER BY "createdAt" ASC',
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

  const profile = await dbGet('SELECT id FROM profiles WHERE id = $1 AND "userEmail" = $2', [profileId, userEmail.toLowerCase().trim()]);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  const result = await dbRun(
    `INSERT INTO gifts ("userEmail", "profileId", "profileName", "giftId", "giftName", "giftPrice", "giftSource", "giftUrl", "assignedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [userEmail.toLowerCase().trim(), profileId, profileName, giftId, giftName, giftPrice || 0, giftSource || null, giftUrl || null, new Date().toISOString()]
  );

  res.status(201).json({ id: result.rows[0].id, profileId, profileName, giftId, giftName });
});

app.get('/gifts', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  const rows = await dbAll(
    'SELECT id, "profileId", "profileName", "giftId", "giftName", "giftPrice", "giftSource", "giftUrl", "assignedAt" FROM gifts WHERE "userEmail" = $1 ORDER BY "assignedAt" ASC',
    [email.toLowerCase().trim()]
  );

  res.json(rows);
});

// ── Gift catalog ──────────────────────────────────────────────────────────────

app.get('/api/gifts', async (req, res) => {
  const { category } = req.query;
  const sql = (category && category !== 'all')
    ? 'SELECT * FROM gift_catalog WHERE category = $1 ORDER BY id'
    : 'SELECT * FROM gift_catalog ORDER BY id';
  const params = (category && category !== 'all') ? [category] : [];

  const rows = await dbAll(sql, params);
  res.json(rows.map(r => ({
    id:        r.id,
    cat:       r.category,
    name:      r.name,
    desc:      r.description,
    price:     r.price,
    source:    r.source,
    icon:      r.icon,
    bg:        r.bg,
    interests: JSON.parse(r.interests || '[]'),
    url:       r.url,
  })));
});
// ── Autonomous agent ────────────────────────────────────────────────────────
app.post('/agent', async (req, res) => {
  const { task, maxTokens } = req.body || {};

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ error: 'A non-empty "task" string is required.' });
  }

  try {
    const result = await runAgent(task, { maxTokens });
    res.json(result);
  } catch (err) {
    console.error('Agent error:', err.message);
    const status = /ANTHROPIC_API_KEY/.test(err.message) ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.use(express.static(__dirname));

// ── Startup: verify the DB connection, build the schema, then listen ──────────
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('Connected to PostgreSQL.');
    await initDb();
    app.listen(PORT, () => {
      console.log(`Giftly server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }
})();
