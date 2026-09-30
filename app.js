// pattern: minutes separated by "-", alternating study/break, starting with study.
function parsePattern(text) {
  const parts = text.trim().toLowerCase().split('-').map(s => s.trim());
  if (parts[parts.length - 1] === 'f') parts.pop();
  if (parts.length === 0 || parts[0] === '') throw new Error('Pattern is empty.');

  return parts.map((p, i) => {
    if (!/^\d+(\.\d+)?$/.test(p)) throw new Error(`"${p}" is not a number of minutes.`);
    const minutes = Number(p);
    if (minutes <= 0) throw new Error('Durations must be greater than 0.');
    return { type: i % 2 === 0 ? 'study' : 'break', seconds: Math.round(minutes * 60) };
  });
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// wall-clock time (user's local time zone) as HH:MM:SS
function formatClock(ms) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

// short beep sequence indicating the end of a segment
let audioCtx = null;
function playAlarm() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = now + i * 0.4;
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

const el = {
  body: document.body,
  mode: document.getElementById('mode'),
  timer: document.getElementById('timer'),
  endTime: document.getElementById('end-time'),
  progress: document.getElementById('progress'),
  start: document.getElementById('start'),
  pause: document.getElementById('pause'),
  reset: document.getElementById('reset'),
  config: document.getElementById('config'),
  pattern: document.getElementById('pattern'),
  error: document.getElementById('error'),
  settings: document.getElementById('settings'),
  settingsOpen: document.getElementById('settings-open'),
  settingsCancel: document.getElementById('settings-cancel'),
  patternLocked: document.getElementById('pattern-locked'),
};

// Last saved pattern; the input is reverted to this when the dialog is cancelled.
let savedPattern = el.pattern.value;

const state = {
  segments: [],
  index: 0,
  remainingMs: 0,
  endTime: 0,     // wall-clock ms when the current segment ends (while running)
  running: false,
  tickId: null,
};

function render() {
  const seg = state.segments[state.index];
  el.timer.textContent = formatTime(Math.ceil(state.remainingMs / 1000));
  // While paused, the end time keeps sliding forward, so project it from now.
  const endMs = state.running ? state.endTime : Date.now() + state.remainingMs;
  el.endTime.textContent = `Next segment at ${seg ? formatClock(endMs) : '--:--:--'}`;

  if (!seg) {
    el.body.className = 'idle';
    el.mode.textContent = state.segments.length ? 'Finished!' : 'Ready';
    el.progress.textContent = '';
  } else {
    el.body.className = seg.type;
    el.mode.textContent = seg.type === 'study' ? 'Study mode' : 'Break mode';
    el.progress.textContent = `Segment ${state.index + 1} of ${state.segments.length}`;
  }

  el.pause.disabled = !seg;
  el.pause.textContent = state.running ? 'Pause' : 'Resume';
  el.start.disabled = !!seg;
  el.pattern.disabled = !!seg;
  el.patternLocked.hidden = !seg;
}

function tick() {
  state.remainingMs = state.endTime - Date.now();
  if (state.remainingMs <= 0) {
    playAlarm();
    state.index++;
    const next = state.segments[state.index];
    if (next) {
      // Carry over any overshoot so long runs don't drift.
      state.remainingMs = next.seconds * 1000 + state.remainingMs;
      state.endTime = Date.now() + state.remainingMs;
    } else {
      stopTicking();
      state.remainingMs = 0;
    }
  }
  render();
}

function startTicking() {
  state.endTime = Date.now() + state.remainingMs;
  state.running = true;
  state.tickId = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(state.tickId);
  state.tickId = null;
  state.running = false;
}

function start() {
  try {
    state.segments = parsePattern(savedPattern);
  } catch (e) {
    openSettings();
    el.error.textContent = e.message;
    return;
  }

  // Audio must be unlocked by a user gesture; the Start click counts.
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();

  state.index = 0;
  state.remainingMs = state.segments[0].seconds * 1000;
  startTicking();
  render();
}

function togglePause() {
  if (!state.segments[state.index]) return;
  if (state.running) {
    state.remainingMs = state.endTime - Date.now();
    stopTicking();
  } else {
    startTicking();
  }
  render();
}

function reset() {
  stopTicking();
  state.segments = [];
  state.index = 0;
  state.remainingMs = 0;
  render();
}

el.start.addEventListener('click', start);
el.pause.addEventListener('click', togglePause);
el.reset.addEventListener('click', reset);
function openSettings() {
  el.pattern.value = savedPattern;
  el.error.textContent = '';
  el.settings.showModal();
}

function saveSettings(e) {
  if (!el.pattern.disabled) {
    try {
      parsePattern(el.pattern.value);
    } catch (err) {
      e.preventDefault();  // keep the dialog open
      el.error.textContent = err.message;
      return;
    }
    savedPattern = el.pattern.value;
  }
}

el.settingsOpen.addEventListener('click', openSettings);
el.settingsCancel.addEventListener('click', () => el.settings.close());
el.config.addEventListener('submit', saveSettings);

render();
