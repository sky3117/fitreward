# 🏃 FitReward v2.0

> Walk more. Burn more. Eat better (or indulge more 😄)

## ✨ Features
- 🔐 Google OAuth2 Login
- 📊 Real-time step tracking via Google Fit API
- 🔥 Calorie calculation
- 🎁 Food rewards based on activity
- 📈 Weekly chart
- 🎮 Demo mode (no login needed)
- 🎚️ Step slider for demo testing

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your Google credentials

# 3. Run server
npm start
# OR for development:
npm run dev
```

Open http://localhost:3000

## 🎮 Demo Mode
Click **"Try Demo"** on login screen — no Google account needed!
Use the step slider to see rewards change in real-time.

## 📁 Structure
```
fitreward/
├── server.js          # Express backend + Google Fit API
├── package.json
├── .env.example       # Copy to .env
└── public/
    ├── index.html     # Frontend UI
    ├── style.css      # Dark theme styles
    └── app.js         # Frontend logic
```
