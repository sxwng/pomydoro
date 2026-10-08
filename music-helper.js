// local helper that serves the page and lets it see and control the macOS Music app.
// run with: node music-helper.js, then open https://sxwng.github.io/pomydoro
// (or https://127.0.0.1:47823 to use the local copy; both are secure contexts, which notifications require)
// serves https when .certs/cert.pem and .certs/key.pem exist (see README), since safari blocks
// an https page from calling plain http, even on 127.0.0.1. without them it falls back to http.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 47823;

// only the pomydoro page (hosted, opened as a file, or served from localhost) may use the helper
const HOSTED_ORIGIN = 'https://sxwng.github.io';

function allowedOrigin(origin) {
  if (!origin || origin === 'null' || origin === HOSTED_ORIGIN) return true;
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

async function handle(req, res) {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return send(res, 403, { error: 'forbidden' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  // preflight, including chrome's check before a public site may reach 127.0.0.1
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.writeHead(204);
    return res.end();
  }

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
}

let tls = null;
try {
  tls = {
    cert: fs.readFileSync(path.join(ROOT, '.certs', 'cert.pem')),
    key: fs.readFileSync(path.join(ROOT, '.certs', 'key.pem')),
  };
} catch (e) {
  console.warn('no certificate in .certs/, serving http (the hosted page won\'t reach it in safari)');
}

const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`pomydoro running at ${tls ? 'https' : 'http'}://127.0.0.1:${PORT}`);
});
