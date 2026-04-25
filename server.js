// ═══════════════════════════════════════════════════════════════
//  server.js  —  FitReward Backend
//  Node.js + Express + Google Fit API + JWT Auth
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const jwt        = require('jsonwebtoken');
const { google } = require('googleapis');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  MIDDLEWARE
// ──────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  `http://localhost:${process.env.PORT || 3000}`,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
}));

app.use(express.json());

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
//  GOOGLE OAUTH2 CLIENT
// ──────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read',
  'openid',
  'email',
  'profile',
];

// ══════════════════════════════════════════════
//  ROUTE 1 — Start Google OAuth Login
// ══════════════════════════════════════════════
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

// ══════════════════════════════════════════════
//  ROUTE 2 — OAuth Callback
// ══════════════════════════════════════════════
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(
      `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}?error=no_code`
    );
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2    = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    const payload = {
      googleId:     profile.id,
      name:         profile.name,
      email:        profile.email,
      photo:        profile.picture,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate:   tokens.expiry_date,
    };

    const appToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
    res.redirect(
      `${frontendUrl}?token=${appToken}` +
      `&name=${encodeURIComponent(profile.name)}` +
      `&email=${encodeURIComponent(profile.email)}` +
      `&photo=${encodeURIComponent(profile.picture || '')}`
    );
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
    res.redirect(`${frontendUrl}?error=auth_failed`);
  }
});

// ──────────────────────────────────────────────
//  JWT MIDDLEWARE
// ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded;

    req.oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    req.oauth2.setCredentials({
      access_token:  decoded.accessToken,
      refresh_token: decoded.refreshToken,
      expiry_date:   decoded.expiryDate,
    });

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ══════════════════════════════════════════════
//  GOOGLE FIT HELPERS
// ══════════════════════════════════════════════
async function fetchGoogleFitSteps(authClient, startTimeMs, endTimeMs) {
  const fitness = google.fitness({ version: 'v1', auth: authClient });

  const response = await fitness.users.dataset.aggregate({
    userId: 'me',
    requestBody: {
      aggregateBy: [{
        dataTypeName: 'com.google.step_count.delta',
        dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
      }],
      bucketByTime: { durationMillis: endTimeMs - startTimeMs },
      startTimeMillis: startTimeMs,
      endTimeMillis:   endTimeMs,
    },
  });

  let totalSteps = 0;
  (response.data.bucket || []).forEach(bucket => {
    (bucket.dataset || []).forEach(dataset => {
      (dataset.point || []).forEach(point => {
        (point.value || []).forEach(val => { totalSteps += val.intVal || 0; });
      });
    });
  });
  return totalSteps;
}

async function fetchGoogleFitStepsDaily(authClient, startTimeMs, endTimeMs) {
  const fitness = google.fitness({ version: 'v1', auth: authClient });

  const response = await fitness.users.dataset.aggregate({
    userId: 'me',
    requestBody: {
      aggregateBy: [{
        dataTypeName: 'com.google.step_count.delta',
        dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
      }],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: startTimeMs,
      endTimeMillis:   endTimeMs,
    },
  });

  return (response.data.bucket || []).map(bucket => {
    const date = new Date(parseInt(bucket.startTimeMillis));
    const day  = date.toLocaleDateString('en-US', { weekday: 'short' });
    let steps  = 0;
    (bucket.dataset || []).forEach(ds =>
      (ds.point || []).forEach(p =>
        (p.value || []).forEach(v => { steps += v.intVal || 0; })
      )
    );
    return { day, steps, date: date.toISOString().split('T')[0] };
  });
}

// ══════════════════════════════════════════════
//  ROUTE 3 — Today's Steps
// ══════════════════════════════════════════════
app.get('/api/steps/today', requireAuth, async (req, res) => {
  try {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const steps = await fetchGoogleFitSteps(req.oauth2, start.getTime(), now.getTime());

    res.json({
      steps,
      calories:    Math.round(steps * 0.04),
      distanceKm:  parseFloat(((steps * 0.78) / 1000).toFixed(2)),
      activeMins:  Math.round(steps / 100),
      date:        now.toISOString().split('T')[0],
    });
  } catch (err) {
    console.error('Steps today error:', err.message);
    res.status(500).json({ error: 'Failed to fetch step data', detail: err.message });
  }
});

// ══════════════════════════════════════════════
//  ROUTE 4 — Last 7 Days Steps
// ══════════════════════════════════════════════
app.get('/api/steps/week', requireAuth, async (req, res) => {
  try {
    const now   = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const days = await fetchGoogleFitStepsDaily(req.oauth2, start.getTime(), now.getTime());
    res.json({ days });
  } catch (err) {
    console.error('Steps week error:', err.message);
    res.status(500).json({ error: 'Failed to fetch weekly data', detail: err.message });
  }
});

// ══════════════════════════════════════════════
//  ROUTE 5 — Fitness Summary
// ══════════════════════════════════════════════
app.get('/api/fitness/summary', requireAuth, async (req, res) => {
  try {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const steps = await fetchGoogleFitSteps(req.oauth2, start.getTime(), now.getTime());
    const calories = Math.round(steps * 0.04);

    const REWARDS_SERVER = [
      { minCal: 0,   name: 'Hydrate!',        emoji: '💧', tier: 'Rest' },
      { minCal: 50,  name: 'Apple Slices',     emoji: '🍎', tier: 'Light' },
      { minCal: 100, name: 'Banana',           emoji: '🍌', tier: 'Warm' },
      { minCal: 150, name: 'Mixed Nuts',       emoji: '🥜', tier: 'Active' },
      { minCal: 200, name: 'Mini Cupcake',     emoji: '🧁', tier: 'Fit' },
      { minCal: 300, name: 'Dark Chocolate',   emoji: '🍫', tier: 'Athlete' },
      { minCal: 400, name: 'Pizza Slice',      emoji: '🍕', tier: 'Beast' },
      { minCal: 500, name: 'Full Burger Meal', emoji: '🍔', tier: 'Legend' },
    ];
    const reward = [...REWARDS_SERVER].reverse().find(r => calories >= r.minCal) || REWARDS_SERVER[0];

    const FITNESS_SERVER = [
      { maxSteps: 1999,     level: 'Sedentary' },
      { maxSteps: 4999,     level: 'Light Walker' },
      { maxSteps: 7999,     level: 'Moderate' },
      { maxSteps: 9999,     level: 'Active' },
      { maxSteps: 14999,    level: 'Fit' },
      { maxSteps: Infinity, level: 'Athlete' },
    ];
    const fitnessLevel = FITNESS_SERVER.find(f => steps <= f.maxSteps)?.level || 'Athlete';

    res.json({ steps, calories, reward, fitnessLevel, distanceKm: parseFloat(((steps * 0.78) / 1000).toFixed(2)) });
  } catch (err) {
    res.status(500).json({ error: 'Summary failed', detail: err.message });
  }
});

// ══════════════════════════════════════════════
//  ROUTE 6 — User Profile
// ══════════════════════════════════════════════
app.get('/api/user/profile', requireAuth, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email, photo: req.user.photo });
});

// ══════════════════════════════════════════════
//  ROUTE 7 — Health Check
// ══════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ──────────────────────────────────────────────
//  START SERVER
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏃 FitReward Server v2.0 on http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🔑 OAuth:  http://localhost:${PORT}/auth/google\n`);
});
