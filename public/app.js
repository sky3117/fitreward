/* ═══════════════════════════════════════════════════════
   app.js  —  FitReward Frontend Logic
   Handles: OAuth login, Google Fit API, UI rendering
════════════════════════════════════════════════════════ */

// ─── CONFIG ────────────────────────────────────────────
const CONFIG = {
  BACKEND_URL:   'http://localhost:3000',
  GOAL_STEPS:    10000,
  WEIGHT_KG:     70,
  CAL_PER_STEP:  0.04,
  STEP_LENGTH_M: 0.78,
};

// ─── REWARD TABLE ──────────────────────────────────────
const REWARDS = [
  { minCal: 0,   emoji: '💧', name: 'Hydrate!',         desc: 'Drink a cold glass of water',          color: '#38bdf8', tier: 'Rest' },
  { minCal: 50,  emoji: '🍎', name: 'Apple Slices',     desc: "Fresh crisp apple — nature's snack",   color: '#4ade80', tier: 'Light' },
  { minCal: 100, emoji: '🍌', name: 'Banana',           desc: "Nature's energy bar — go for it!",     color: '#facc15', tier: 'Warm' },
  { minCal: 150, emoji: '🥜', name: 'Mixed Nuts',       desc: 'A handful of almonds & cashews',       color: '#fb923c', tier: 'Active' },
  { minCal: 200, emoji: '🧁', name: 'Mini Cupcake',     desc: 'You earned a sweet treat!',            color: '#c084fc', tier: 'Fit' },
  { minCal: 300, emoji: '🍫', name: 'Dark Chocolate',   desc: 'A full bar of 70% cocoa bliss!',       color: '#a16207', tier: 'Athlete' },
  { minCal: 400, emoji: '🍕', name: 'Pizza Slice',      desc: "Go ahead champ — you've earned it!",   color: '#f97316', tier: 'Beast' },
  { minCal: 500, emoji: '🍔', name: 'Full Burger Meal', desc: 'Legend status. Feast unlocked! 🏆',    color: '#ef4444', tier: 'Legend' },
];

// ─── FITNESS LEVELS ────────────────────────────────────
const FITNESS_LEVELS = [
  { maxSteps: 1999,     label: 'Sedentary',    icon: '🛋️', pct: 8,  color: '#94a3b8' },
  { maxSteps: 4999,     label: 'Light Walker', icon: '🚶', pct: 28, color: '#38bdf8' },
  { maxSteps: 7999,     label: 'Moderate',     icon: '🏃', pct: 50, color: '#4ade80' },
  { maxSteps: 9999,     label: 'Active',       icon: '⚡', pct: 72, color: '#facc15' },
  { maxSteps: 14999,    label: 'Fit',          icon: '🏅', pct: 88, color: '#fb923c' },
  { maxSteps: Infinity, label: 'Athlete',      icon: '🏆', pct: 99, color: '#c084fc' },
];

// ─── STATE ─────────────────────────────────────────────
let state = {
  user:        null,
  token:       null,
  steps:       0,
  weeklyData:  [],
  isDemoMode:  false,
};

// ══════════════════════════════════════════════════════
//  AUTH  — Login / Logout
// ══════════════════════════════════════════════════════

function loginWithGoogle() {
  window.location.href = `${CONFIG.BACKEND_URL}/auth/google`;
}

/** Demo mode — no login needed */
function loginDemo() {
  state.isDemoMode = true;
  state.user = { name: 'Demo User', email: 'demo@fitreward.app', photo: '' };
  state.steps = 8543;
  state.weeklyData = generateMockWeeklyData();
  localStorage.setItem('fitreward_demo', 'true');
  showDashboard();
  renderDashboard();
  // Show the step adjuster in demo mode
  document.getElementById('step-adjuster').style.display = 'block';
}

function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  const name   = params.get('name');
  const email  = params.get('email');
  const photo  = params.get('photo');

  if (token) {
    state.token = token;
    state.user  = { name, email, photo };
    localStorage.setItem('fitreward_token', token);
    localStorage.setItem('fitreward_user',  JSON.stringify({ name, email, photo }));
    window.history.replaceState({}, document.title, '/');
    showDashboard();
    loadFitnessData();
    // Hide demo adjuster for real users
    document.getElementById('step-adjuster').style.display = 'none';
  }
}

function restoreSession() {
  // Demo mode restore
  if (localStorage.getItem('fitreward_demo') === 'true') {
    state.isDemoMode = true;
    state.user = { name: 'Demo User', email: 'demo@fitreward.app', photo: '' };
    state.steps = 8543;
    state.weeklyData = generateMockWeeklyData();
    showDashboard();
    renderDashboard();
    document.getElementById('step-adjuster').style.display = 'block';
    return true;
  }
  // Real session restore
  const token = localStorage.getItem('fitreward_token');
  const user  = localStorage.getItem('fitreward_user');
  if (token && user) {
    state.token = token;
    state.user  = JSON.parse(user);
    showDashboard();
    loadFitnessData();
    document.getElementById('step-adjuster').style.display = 'none';
    return true;
  }
  return false;
}

function logout() {
  localStorage.removeItem('fitreward_token');
  localStorage.removeItem('fitreward_user');
  localStorage.removeItem('fitreward_demo');
  state = { user: null, token: null, steps: 0, weeklyData: [], isDemoMode: false };
  showLogin();
}

// ══════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ══════════════════════════════════════════════════════

function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('dashboard-screen').classList.remove('active');
  initParticles();
}

function showDashboard() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('dashboard-screen').classList.add('active');

  if (state.user) {
    document.getElementById('user-name').textContent = state.user.name || 'User';
    const avatarEl = document.getElementById('user-avatar');
    if (state.user.photo) {
      avatarEl.src = state.user.photo;
      avatarEl.style.display = 'block';
    }
  }

  const now = new Date();
  document.getElementById('date-display').textContent = "Today's Activity";
  document.getElementById('date-sub').textContent =
    now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Streak (mock calculation based on weekly data)
  updateStreak();
}

function updateStreak() {
  // Simple streak: count consecutive days with > 0 steps from weekly data
  const streak = state.weeklyData
    ? state.weeklyData.filter(d => d.steps > 0).length
    : 0;
  document.getElementById('streak-count').textContent = streak;
}

// ══════════════════════════════════════════════════════
//  DATA FETCHING
// ══════════════════════════════════════════════════════

async function loadFitnessData() {
  try {
    const [todayRes, weekRes] = await Promise.all([
      fetchFromBackend('/api/steps/today'),
      fetchFromBackend('/api/steps/week'),
    ]);
    state.steps      = todayRes.steps || 0;
    state.weeklyData = weekRes.days   || generateMockWeeklyData();
    renderDashboard();
  } catch (err) {
    console.warn('Backend not connected — using mock data:', err.message);
    state.steps      = 8543;
    state.weeklyData = generateMockWeeklyData();
    renderDashboard();
  }
}

async function fetchFromBackend(endpoint) {
  const res = await fetch(`${CONFIG.BACKEND_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function syncGoogleFit() {
  const btn      = document.getElementById('sync-btn');
  const syncIcon = document.getElementById('sync-icon');

  btn.classList.add('syncing');
  syncIcon.style.animation = 'spin 1s linear infinite';
  btn.innerHTML = '<span>⟳</span> Syncing…';

  if (state.isDemoMode) {
    // Demo: randomize steps slightly
    state.steps = Math.floor(state.steps * (0.9 + Math.random() * 0.3));
    state.weeklyData = generateMockWeeklyData();
    await new Promise(r => setTimeout(r, 800));
    renderDashboard();
  } else {
    await loadFitnessData();
  }

  syncIcon.style.animation = 'none';
  btn.classList.remove('syncing');
  btn.innerHTML = '<span>✓</span> Synced!';
  setTimeout(() => { btn.innerHTML = '<span id="sync-icon">⟳</span> Sync'; }, 2000);
}

// ══════════════════════════════════════════════════════
//  DEMO — STEP SLIDER & QUICK BUTTONS
// ══════════════════════════════════════════════════════

function onSliderChange(val) {
  const v = parseInt(val);
  state.steps = v;
  document.getElementById('slider-val').textContent = v.toLocaleString();
  // Update the last day in weekly data too
  if (state.weeklyData.length) {
    state.weeklyData[state.weeklyData.length - 1].steps = v;
  }
  renderDashboard(false); // no animation on drag
}

function setSteps(val) {
  state.steps = val;
  document.getElementById('step-slider').value = val;
  document.getElementById('slider-val').textContent = val.toLocaleString();
  if (state.weeklyData.length) {
    state.weeklyData[state.weeklyData.length - 1].steps = val;
  }
  renderDashboard(true);
}

// ══════════════════════════════════════════════════════
//  CALCULATIONS
// ══════════════════════════════════════════════════════

function calcCalories(steps)      { return Math.round(steps * CONFIG.CAL_PER_STEP); }
function calcDistance(steps)      { return ((steps * CONFIG.STEP_LENGTH_M) / 1000).toFixed(2); }
function calcActiveMinutes(steps) { return Math.round(steps / 100); }
function calcSpeed(steps) {
  const mins = calcActiveMinutes(steps);
  if (mins === 0) return '0.0';
  return ((parseFloat(calcDistance(steps)) / mins) * 60).toFixed(1);
}
function getReward(calories)     { return [...REWARDS].reverse().find(r => calories >= r.minCal) || REWARDS[0]; }
function getNextReward(calories) { return REWARDS.find(r => r.minCal > calories); }
function getFitnessLevel(steps)  { return FITNESS_LEVELS.find(l => steps <= l.maxSteps) || FITNESS_LEVELS.at(-1); }

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════

function renderDashboard(animate = true) {
  const steps    = state.steps;
  const calories = calcCalories(steps);
  const reward   = getReward(calories);
  const next     = getNextReward(calories);
  const fitness  = getFitnessLevel(steps);
  const goalPct  = Math.min((steps / CONFIG.GOAL_STEPS) * 100, 100);

  // — Steps
  if (animate) animateNumber('steps-display', steps);
  else document.getElementById('steps-display').textContent = steps.toLocaleString();

  document.getElementById('steps-progress').style.width = goalPct + '%';
  document.getElementById('goal-pct').textContent        = Math.round(goalPct) + '%';
  document.getElementById('steps-note').textContent      =
    steps >= CONFIG.GOAL_STEPS
      ? `🎉 Goal achieved! ${(steps - CONFIG.GOAL_STEPS).toLocaleString()} extra steps!`
      : `${(CONFIG.GOAL_STEPS - steps).toLocaleString()} more steps to goal`;

  // — Calories
  if (animate) animateNumber('cal-display', calories);
  else document.getElementById('cal-display').textContent = calories.toLocaleString();

  document.getElementById('distance-val').textContent = calcDistance(steps) + ' km';
  document.getElementById('active-val').textContent   = calcActiveMinutes(steps) + ' min';
  document.getElementById('speed-val').textContent    = calcSpeed(steps) + ' km/h';

  // — Fitness ring
  const circ   = 2 * Math.PI * 50;
  const offset = circ - (fitness.pct / 100) * circ;
  const ring   = document.getElementById('ring-fg');
  ring.style.strokeDashoffset = offset;
  ring.style.stroke           = fitness.color;
  document.getElementById('ring-emoji').textContent    = fitness.icon;
  document.getElementById('fitness-label').textContent = fitness.label;
  document.getElementById('fitness-label').style.color = fitness.color;
  document.getElementById('fitness-pct').textContent   = fitness.pct + 'th percentile';

  // — Reward banner
  const banner = document.getElementById('reward-banner');
  banner.style.borderColor = reward.color + '55';
  banner.style.boxShadow   = `0 0 40px ${reward.color}15`;

  document.getElementById('reward-shine').style.background =
    `linear-gradient(90deg, transparent, ${reward.color}88, transparent)`;
  document.getElementById('reward-emoji').textContent     = reward.emoji;
  document.getElementById('reward-tier').textContent      = `🎁 REWARD UNLOCKED · ${reward.tier}`;
  document.getElementById('reward-tier').style.background = reward.color + '22';
  document.getElementById('reward-tier').style.color      = reward.color;
  document.getElementById('reward-name').textContent      = reward.name;
  document.getElementById('reward-desc').textContent      = reward.desc;
  document.getElementById('reward-meta').innerHTML        =
    `You burned <span style="color:${reward.color};font-weight:700">${calories} kcal</span>` +
    (next
      ? ` · Next reward at <span style="color:#e2e8f0">${next.minCal} kcal</span>`
      : ' · Max reward reached! 🏆');

  renderRewardLadder(calories);
  renderWeeklyChart();
  updateStreak();

  // Sync slider with current steps (demo mode)
  const slider = document.getElementById('step-slider');
  if (slider && state.isDemoMode) {
    slider.value = steps;
    document.getElementById('slider-val').textContent = steps.toLocaleString();
  }
}

function renderRewardLadder(calories) {
  const el = document.getElementById('reward-ladder');
  el.innerHTML = REWARDS.slice(1).map(r => {
    const unlocked = calories >= r.minCal;
    return `
      <div class="ladder-item ${unlocked ? 'unlocked' : ''}">
        <span class="ladder-icon">${r.emoji}</span>
        <div class="ladder-bar">
          <div class="ladder-fill" style="width:${unlocked ? 100 : 0}%;background:${r.color}"></div>
        </div>
      </div>`;
  }).join('');
}

function renderWeeklyChart() {
  const data   = state.weeklyData;
  const maxVal = Math.max(...data.map(d => d.steps), 1);
  const barsEl = document.getElementById('chart-bars');
  const daysEl = document.getElementById('chart-days');

  barsEl.innerHTML = data.map((d, i) => {
    const h      = Math.round((d.steps / maxVal) * 110);
    const cal    = calcCalories(d.steps);
    const reward = getReward(cal);
    const isToday = i === data.length - 1;
    return `
      <div class="bar-col">
        <div class="bar-tooltip">${d.steps.toLocaleString()} ${reward.emoji}</div>
        <div class="bar-fill ${isToday ? 'today' : ''}"
             style="height:${h}px;background:${isToday ? '' : reward.color + '55'}"
             title="${d.day}: ${d.steps.toLocaleString()} steps"></div>
      </div>`;
  }).join('');

  daysEl.innerHTML = data.map((d, i) =>
    `<div class="day-label ${i === data.length - 1 ? 'today-label' : ''}">${d.day}</div>`
  ).join('');
}

// ══════════════════════════════════════════════════════
//  ANIMATED NUMBER COUNTER
// ══════════════════════════════════════════════════════

function animateNumber(elId, target, duration = 1200) {
  const el    = document.getElementById(elId);
  const start = Date.now();

  const tick = () => {
    const elapsed  = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease     = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * ease).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════
//  MOCK DATA
// ══════════════════════════════════════════════════════

function generateMockWeeklyData() {
  const days    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const samples = [4200, 7800, 11200, 5600, 9300, 13400, state.steps || 8543];
  return days.map((day, i) => ({ day, steps: samples[i] }));
}

// ══════════════════════════════════════════════════════
//  PARTICLES (Login screen)
// ══════════════════════════════════════════════════════

function initParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      width: ${2 + Math.random() * 3}px;
      height: ${2 + Math.random() * 3}px;
      animation-duration: ${5 + Math.random() * 10}s;
      animation-delay: ${Math.random() * 8}s;
      opacity: ${0.3 + Math.random() * 0.5};
    `;
    container.appendChild(p);
  }
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════

(function init() {
  if (window.location.search.includes('token=')) {
    handleOAuthCallback();
    return;
  }
  if (restoreSession()) return;
  showLogin();
})();
