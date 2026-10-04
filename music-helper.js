// local helper that serves the page and lets it see and control the macOS Music app.
// run with: node music-helper.js, then open http://127.0.0.1:47823
// (serving from localhost makes the page a secure context, which notifications require)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 47823;

// only the pomydoro page (opened as a file or served from localhost) may use the helper
function allowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (e) {
    return false;
  }
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

// checks "is running" first so polling never launches Music
const STATUS_SCRIPT = `
if application "Music" is not running then return "stopped"
tell application "Music"
  set s to player state as string
  if s is not "playing" and s is not "paused" then return "stopped"
  try
    return s & linefeed & (name of current track) & linefeed & (artist of current track)
  on error
    return s
  end try
end tell`;

const COMMANDS = {
  play: 'play',
  pause: 'pause',
  next: 'next track',
  previous: 'previous track',
};

async function getStatus() {
  const [state, track = '', artist = ''] = (await osascript(STATUS_SCRIPT)).split('\n');
  return { state, track, artist };
}

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

// serves the page's own files; anything outside the project or hidden (e.g. .git) is a 404
function serveStatic(pathname, res) {
  const file = path.join(ROOT, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
  const type = TYPES[path.extname(file)];
  const hidden = path.relative(ROOT, file).split(path.sep).some(part => part.startsWith('.'));
  if (!file.startsWith(ROOT + path.sep) || hidden || !type) return send(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return send(res, 403, { error: 'forbidden' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/status') {
      return send(res, 200, await getStatus());
    }
    const command = COMMANDS[url.pathname.slice(1)];
    if (req.method === 'POST' && command) {
      await osascript(`if application "Music" is running then tell application "Music" to ${command}`);
      return send(res, 200, await getStatus());
    }
    if (req.method === 'GET') return serveStatic(url.pathname, res);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`pomydoro running at http://127.0.0.1:${PORT}`);
});
