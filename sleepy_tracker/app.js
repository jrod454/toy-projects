// Configuration - Update these values
const CONFIG = {
  SUPABASE_URL: "https://mexlmceneuhczeehewzn.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leGxtY2VuZXVoY3plZWhld3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE0NzA2MDUsImV4cCI6MjA1NzA0NjYwNX0.G--J-ZN7hqKTrQ8r2YfcWn3__o4r8tTj4JI0PZow6e4",
  STREAMER_NAME: "1sleepyhomie",
  POLL_INTERVAL: 60000, // Check for updates every 60 seconds
};

// State
let currentStatus = null;
let liveStartTime = null;
let updateInterval = null;
let calendarDate = new Date();
let monthlyData = {};
let goalMetCelebrated = false;
let fireworksActive = false;

// Initialize Supabase client
const supabaseUrl = CONFIG.SUPABASE_URL;
const supabaseKey = CONFIG.SUPABASE_ANON_KEY;

async function supabaseQuery(endpoint, options = {}) {
  const url = `${supabaseUrl}/rest/v1/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return response.json();
}

async function callRpc(functionName, params) {
  const url = `${supabaseUrl}/rest/v1/rpc/${functionName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  return response.json();
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `${hours}h ${mins}m`;
}

function formatSessionDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateProgressDisplay(completedMinutes, liveMinutes, goalMinutes) {
  const totalMinutes = completedMinutes + liveMinutes;
  const percent = Math.min(100, (totalMinutes / goalMinutes) * 100);

  document.getElementById("time-streamed").textContent = formatDuration(totalMinutes);
  document.getElementById("goal-time").textContent = `/ ${formatDuration(goalMinutes)}`;
  document.getElementById("progress-percent").textContent = `${Math.round(percent)}%`;

  const progressFill = document.getElementById("progress-fill");
  progressFill.style.width = `${percent}%`;

  // Add live animation when streaming
  if (liveMinutes > 0) {
    progressFill.classList.add("live");
  } else {
    progressFill.classList.remove("live");
  }

  if (percent >= 100) {
    progressFill.classList.add("complete");
    document.getElementById("progress-percent").classList.add("complete");
    // Trigger fireworks celebration!
    triggerGoalCelebration();
  } else {
    progressFill.classList.remove("complete");
    document.getElementById("progress-percent").classList.remove("complete");
    goalMetCelebrated = false;
    document.body.classList.remove('goal-met-celebration');
  }
}

function updateLiveTimer() {
  if (!liveStartTime) return;

  const elapsed = Date.now() - liveStartTime.getTime();
  document.getElementById("session-duration").textContent = formatSessionDuration(elapsed);

  // Update progress with live time
  if (currentStatus) {
    const liveMinutes = elapsed / 60000;
    updateProgressDisplay(
      currentStatus.today_completed_minutes || 0,
      liveMinutes,
      currentStatus.goal_minutes || 240
    );
  }
}

async function fetchStatus() {
  try {
    const status = await callRpc("sleepy_tracker_get_stream_status", {
      p_streamer_name: CONFIG.STREAMER_NAME,
    });

    currentStatus = status;
    const statusIndicator = document.getElementById("status-indicator");
    const statusText = document.getElementById("status-text");
    const currentSession = document.getElementById("current-session");

    let liveMinutes = 0;

    if (status.is_live) {
      statusIndicator.className = "status-indicator live";
      statusText.textContent = "LIVE";
      currentSession.style.display = "block";
      liveStartTime = new Date(status.started_at);
      liveMinutes = (Date.now() - liveStartTime.getTime()) / 60000;
    } else {
      statusIndicator.className = "status-indicator offline";
      statusText.textContent = "Offline";
      currentSession.style.display = "none";
      liveStartTime = null;
    }

    updateProgressDisplay(
      status.today_completed_minutes || 0,
      liveMinutes,
      status.goal_minutes || 240
    );
  } catch (error) {
    console.error("Error fetching status:", error);
  }
}

async function fetchRecentSessions() {
  try {
    const sessions = await supabaseQuery(
      `sleepy_tracker_stream_sessions?streamer_name=eq.${CONFIG.STREAMER_NAME}&ended_at=not.is.null&order=started_at.desc&limit=5`
    );

    const sessionList = document.getElementById("session-list");

    if (sessions.length === 0) {
      sessionList.innerHTML = "<li>No sessions yet</li>";
      return;
    }

    sessionList.innerHTML = sessions
      .map(
        (session) => `
        <li>
          <span class="session-date">${formatDate(session.started_at)}</span>
          <span class="session-duration">${formatDuration(session.duration_minutes)}</span>
        </li>
      `
      )
      .join("");
  } catch (error) {
    console.error("Error fetching sessions:", error);
  }
}

// Calendar functions
async function fetchMonthlyData(year, month) {
  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

  try {
    const sessions = await supabaseQuery(
      `sleepy_tracker_stream_sessions?streamer_name=eq.${CONFIG.STREAMER_NAME}&started_at=gte.${startDate}&started_at=lte.${endDate}T23:59:59&order=started_at.asc`
    );

    // Group sessions by date and sum durations
    const dailyTotals = {};
    sessions.forEach((session) => {
      const date = session.started_at.split("T")[0];
      if (!dailyTotals[date]) {
        dailyTotals[date] = 0;
      }
      if (session.duration_minutes) {
        dailyTotals[date] += session.duration_minutes;
      }
    });

    return dailyTotals;
  } catch (error) {
    console.error("Error fetching monthly data:", error);
    return {};
  }
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  // Update header
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  document.getElementById("calendar-month").textContent = `${monthNames[month]} ${year}`;

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Get today's date for highlighting
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // Build calendar days
  const calendarDays = document.getElementById("calendar-days");
  calendarDays.innerHTML = "";

  // Add empty cells for days before the first day of month
  for (let i = 0; i < firstDay; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "calendar-day";
    calendarDays.appendChild(emptyDay);
  }

  // Add days of the month
  const goalMinutes = 240; // 4 hours default
  for (let day = 1; day <= totalDays; day++) {
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day current-month";

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const minutes = monthlyData[dateStr] || 0;

    if (minutes >= goalMinutes) {
      dayEl.classList.add("goal-met");
    } else if (minutes > 0) {
      dayEl.classList.add("partial");
    } else {
      dayEl.classList.add("none");
    }

    if (isCurrentMonth && day === today.getDate()) {
      dayEl.classList.add("today");
    }

    dayEl.textContent = day;

    // Add tooltip with duration
    if (minutes > 0) {
      dayEl.title = formatDuration(minutes);
    }

    calendarDays.appendChild(dayEl);
  }
}

async function updateCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  monthlyData = await fetchMonthlyData(year, month);
  renderCalendar();
}

function setupCalendarNavigation() {
  document.getElementById("prev-month").addEventListener("click", async () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    await updateCalendar();
  });

  document.getElementById("next-month").addEventListener("click", async () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    await updateCalendar();
  });
}

async function init() {
  document.getElementById("streamer-name").textContent = CONFIG.STREAMER_NAME;

  // Initial fetch
  await fetchStatus();
  await fetchRecentSessions();

  // Initialize calendar
  setupCalendarNavigation();
  await updateCalendar();

  // Start continuous fireworks in background
  fireworksDisplay = new FireworksDisplay();
  fireworksDisplay.start();

  // Update live timer every second
  setInterval(updateLiveTimer, 1000);

  // Poll for status updates
  setInterval(async () => {
    await fetchStatus();
    await fetchRecentSessions();
    await updateCalendar();
  }, CONFIG.POLL_INTERVAL);
}

// Fireworks system
class Firework {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.x = Math.random() * canvas.width;
    this.y = canvas.height;
    this.targetY = Math.random() * canvas.height * 0.5;
    this.speed = 3 + Math.random() * 3;
    this.angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.trail = [];
    this.exploded = false;
    this.particles = [];
    this.hue = Math.random() * 360;
  }

  update() {
    if (!this.exploded) {
      this.trail.push({ x: this.x, y: this.y, alpha: 1 });
      if (this.trail.length > 10) this.trail.shift();

      this.x += this.vx;
      this.y += this.vy;
      this.vy += 0.05;

      if (this.vy >= 0 || this.y <= this.targetY) {
        this.explode();
      }
    } else {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.alpha -= 0.015;
        p.size *= 0.98;
        if (p.alpha <= 0) this.particles.splice(i, 1);
      }
    }
  }

  explode() {
    this.exploded = true;
    const particleCount = 30 + Math.floor(Math.random() * 20);
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        size: 2 + Math.random() * 2,
        hue: this.hue + Math.random() * 30 - 15
      });
    }
  }

  draw() {
    if (!this.exploded) {
      // Draw trail
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        this.ctx.beginPath();
        this.ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
        this.ctx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${i / this.trail.length * 0.5})`;
        this.ctx.fill();
      }
      // Draw head
      this.ctx.beginPath();
      this.ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = `hsl(${this.hue}, 100%, 70%)`;
      this.ctx.fill();
    } else {
      // Draw particles
      for (const p of this.particles) {
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${p.alpha})`;
        this.ctx.fill();
      }
    }
  }

  isDead() {
    return this.exploded && this.particles.length === 0;
  }
}

class FireworksDisplay {
  constructor() {
    this.canvas = document.getElementById('fireworks-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fireworks = [];
    this.animationId = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  start() {
    if (fireworksActive) return;
    fireworksActive = true;

    // Continuously launch fireworks
    this.launchInterval = setInterval(() => {
      if (this.fireworks.length < 5) {
        this.fireworks.push(new Firework(this.canvas, this.ctx));
      }
    }, 800);

    this.animate();
  }

  stop() {
    if (this.launchInterval) {
      clearInterval(this.launchInterval);
    }
    fireworksActive = false;
  }

  animate() {
    // Clear canvas completely each frame (transparent background)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.fireworks.length - 1; i >= 0; i--) {
      this.fireworks[i].update();
      this.fireworks[i].draw();
      if (this.fireworks[i].isDead()) {
        this.fireworks.splice(i, 1);
      }
    }

    // Always keep animating
    this.animationId = requestAnimationFrame(() => this.animate());
  }
}

let fireworksDisplay = null;

function triggerGoalCelebration() {
  if (goalMetCelebrated) return;
  goalMetCelebrated = true;
  document.body.classList.add('goal-met-celebration');
}

// Start the app
init();
