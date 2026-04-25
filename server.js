require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
// DEBUG LOGS
// ──────────────────────────────────────────────
console.log("🔥 SERVER STARTING...");
console.log("PORT:", PORT);
console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? "OK" : "MISSING");
console.log("CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "OK" : "MISSING");
console.log("JWT_SECRET:", process.env.JWT_SECRET ? "OK" : "MISSING");

// ──────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// GOOGLE OAUTH SETUP
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

// ──────────────────────────────────────────────
// AUTH ROUTES
// ──────────────────────────────────────────────
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send("❌ No code");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    const token = jwt.sign({
      name: data.name,
      email: data.email,
      photo: data.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
    }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.redirect(`/?token=${token}`);
  } catch (err) {
    console.error("❌ Auth error:", err);
    res.send("❌ Auth failed: " + err.message);
  }
});

// ──────────────────────────────────────────────
// JWT MIDDLEWARE
// ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);

    req.oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    req.oauth2.setCredentials({
      access_token: decoded.accessToken,
      refresh_token: decoded.refreshToken,
      expiry_date: decoded.expiryDate,
    });

    next();
  } catch (err) {
    console.error("❌ JWT error:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ──────────────────────────────────────────────
// HELPER — aaj ke steps fetch karna
// ──────────────────────────────────────────────
async function getSteps(auth) {
  const fitness = google.fitness({ version: 'v1', auth });
  const now = Date.now();
  const start = now - 86400000; // pichhle 24 ghante

  const response = await fitness.users.dataset.aggregate({
    userId: 'me',
    requestBody: {
      aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: start,
      endTimeMillis: now,
    },
  });

  let steps = 0;
  response.data.bucket?.forEach(b =>
    b.dataset?.forEach(d =>
      d.point?.forEach(p =>
        p.value?.forEach(v => steps += v.intVal || 0)
      )
    )
  );
  return steps;
}

// ──────────────────────────────────────────────
// API ROUTES
// ──────────────────────────────────────────────

// Aaj ke steps — frontend yahi maangta hai
app.get('/api/steps/today', requireAuth, async (req, res) => {
  try {
    const steps = await getSteps(req.oauth2);
    console.log("✅ /api/steps/today =>", steps);
    res.json({ steps });
  } catch (e) {
    console.error("❌ /api/steps/today error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Weekly steps — pichhle 7 din
app.get('/api/steps/week', requireAuth, async (req, res) => {
  try {
    const fitness = google.fitness({ version: 'v1', auth: req.oauth2 });
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;

    const response = await fitness.users.dataset.aggregate({
      userId: 'me',
      requestBody: {
        aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: sevenDaysAgo,
        endTimeMillis: now,
      },
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = (response.data.bucket || []).map(bucket => {
      const date = new Date(parseInt(bucket.startTimeMillis));
      let steps = 0;
      bucket.dataset?.forEach(d =>
        d.point?.forEach(p =>
          p.value?.forEach(v => steps += v.intVal || 0)
        )
      );
      return { day: dayNames[date.getDay()], steps };
    });

    console.log("✅ /api/steps/week =>", days);
    res.json({ days });
  } catch (e) {
    console.error("❌ /api/steps/week error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Purana route — backward compatibility ke liye
app.get('/api/steps', requireAuth, async (req, res) => {
  try {
    const steps = await getSteps(req.oauth2);
    res.json({ steps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ──────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});