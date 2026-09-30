// local helper that lets the page see and control the macOS Music app.
// run with: node music-helper.js
const http = require('http');
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
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`music helper listening on http://127.0.0.1:${PORT}`);
});
