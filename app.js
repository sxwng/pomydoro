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

// short beep sequence indicating the end of a segment; returns its length in ms
let audioCtx = null;
function playAlarm() {
  if (!audioCtx) return 0;
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
  return (2 * 0.4 + 0.3) * 1000;
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
  themeToggle: document.getElementById('theme-toggle'),
  clockTicks: document.querySelector('.clock-ticks'),
  handHour: document.getElementById('hand-hour'),
  handMinute: document.getElementById('hand-minute'),
  handSecond: document.getElementById('hand-second'),
  clockDigital: document.getElementById('clock-digital'),
  timeStudying: document.getElementById('time-studying'),
  musicWidget: document.getElementById('music-widget'),
  musicTrack: document.getElementById('music-track'),
  musicArtist: document.getElementById('music-artist'),
  musicPrevious: document.getElementById('music-previous'),
  musicToggle: document.getElementById('music-toggle'),
  musicNext: document.getElementById('music-next'),
};

// last saved pattern; the input is reverted to this when the dialog is cancelled.
let savedPattern = el.pattern.value;

const state = {
  segments: [],
  index: 0,
  remainingMs: 0,
  endTime: 0,     // wall-clock ms when the current segment ends (while running)
  running: false,
  tickId: null,
};

// rebuild when img changes
function setModeImage(src, alt) {
  const img = el.mode.querySelector('.mode-img');
  if (img && img.getAttribute('src') === src) return;
  el.mode.innerHTML = `<img class="mode-img" src="${src}" alt="${alt}">`;
}

// total session time so far (study + break, excluding pauses)
function elapsedMs() {
  let ms = 0;
  for (let i = 0; i < state.index && i < state.segments.length; i++) {
    ms += state.segments[i].seconds * 1000;
  }
  const seg = state.segments[state.index];
  if (seg) ms += seg.seconds * 1000 - state.remainingMs;
  return Math.max(0, ms);
}

function render() {
  const seg = state.segments[state.index];
  el.timer.textContent = formatTime(Math.ceil(state.remainingMs / 1000));
  // While paused, the end time keeps sliding forward, so project it from now.
  const endMs = state.running ? state.endTime : Date.now() + state.remainingMs;
  el.endTime.textContent = `Next segment at ${seg ? formatClock(endMs) : '--:--:--'}`;
  el.timeStudying.textContent = `Time studying: ${formatTime(Math.floor(elapsedMs() / 1000))}`;

  if (!seg) {
    el.body.className = 'idle';
    if (state.segments.length) {
      el.mode.textContent = 'Finished!';
    } else {
      setModeImage('images/ready.png', 'Ready');
    }
    el.progress.textContent = '';
  } else {
    el.body.className = seg.type;
    if (seg.type === 'study') {
      setModeImage('images/study.png', 'Study mode');
    } else {
      setModeImage('images/break.png', 'Break mode');
    }
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
    alarmWithMusicPaused();
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

// theme: an explicit choice is stored; otherwise follow the OS setting.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
}

// the button shows the current theme: sun for light, moon for dark
function renderThemeToggle() {
  const dark = currentTheme() === 'dark';
  el.themeToggle.textContent = dark ? '\u{1F319}' : '\u2600\uFE0F';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  el.themeToggle.setAttribute('aria-label', label);
  el.themeToggle.title = label;
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
  renderThemeToggle();
}

el.themeToggle.addEventListener('click', toggleTheme);
darkQuery.addEventListener('change', renderThemeToggle);
renderThemeToggle();

el.settingsOpen.addEventListener('click', openSettings);
el.settingsCancel.addEventListener('click', () => el.settings.close());
el.config.addEventListener('submit', saveSettings);

render();

// clock widget: 12 hour ticks, hands rotated around the center of a 100x100 face
for (let i = 0; i < 12; i++) {
  const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  tick.setAttribute('x1', 50);
  tick.setAttribute('y1', 8);
  tick.setAttribute('x2', 50);
  tick.setAttribute('y2', 14);
  tick.setAttribute('transform', `rotate(${i * 30} 50 50)`);
  el.clockTicks.appendChild(tick);
}

function renderClock() {
  const now = new Date();
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  el.handHour.setAttribute('transform', `rotate(${h * 30} 50 50)`);
  el.handMinute.setAttribute('transform', `rotate(${m * 6} 50 50)`);
  el.handSecond.setAttribute('transform', `rotate(${s * 6} 50 50)`);
  el.clockDigital.textContent = formatClock(now.getTime());
}

// align updates to the start of each second so the clock ticks on the second
function scheduleClock() {
  renderClock();
  setTimeout(scheduleClock, 1000 - (Date.now() % 1000));
}
scheduleClock();

// music widget: talks to music-helper.js, which controls the macOS Music app.
// hidden when the helper isn't running or nothing is playing/paused.
const MUSIC_HELPER = 'http://127.0.0.1:47823';
let musicState = 'stopped';

function renderMusic(status) {
  musicState = status ? status.state : 'stopped';
  const active = musicState === 'playing' || musicState === 'paused';
  el.musicWidget.hidden = !active;
  if (!active) return;

  el.musicTrack.textContent = status.track;
  el.musicTrack.title = status.track;
  el.musicArtist.textContent = status.artist;
  el.musicArtist.title = status.artist;
  const playing = musicState === 'playing';
  el.musicToggle.classList.toggle('playing', playing);
  el.musicToggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.musicToggle.title = playing ? 'Pause' : 'Play';
}

async function musicRequest(path, method = 'GET') {
  try {
    const res = await fetch(MUSIC_HELPER + path, { method });
    renderMusic(res.ok ? await res.json() : null);
  } catch (e) {
    renderMusic(null);  // helper not running
  }
}

// pause Music (if it's playing) so the beep is audible, then resume it after
async function alarmWithMusicPaused() {
  const wasPlaying = musicState === 'playing';
  if (wasPlaying) await musicRequest('/pause', 'POST');
  const ms = playAlarm();
  if (wasPlaying) setTimeout(() => musicRequest('/play', 'POST'), ms);
}

el.musicPrevious.addEventListener('click', () => musicRequest('/previous', 'POST'));
el.musicNext.addEventListener('click', () => musicRequest('/next', 'POST'));
el.musicToggle.addEventListener('click', () =>
  musicRequest(musicState === 'playing' ? '/pause' : '/play', 'POST'));

musicRequest('/status');
setInterval(() => musicRequest('/status'), 2000);
