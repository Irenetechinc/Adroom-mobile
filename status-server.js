const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const PORT = 5000;

const LANDING_DIR = path.join(__dirname, 'landing');
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon',
  '.txt':'text/plain; charset=utf-8'
};
function tryServeLanding(req, res){
  // Serve files under /landing/* and /assets/* (assets resolved against landing/assets)
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  let rel = null;
  if (urlPath === '/landing' || urlPath === '/landing/') rel = 'index.html';
  else if (urlPath.startsWith('/landing/')) rel = urlPath.slice('/landing/'.length);
  else if (urlPath.startsWith('/assets/')) rel = urlPath.slice(1);
  if (!rel) return false;
  const safe = path.normalize(rel).replace(/^([\/\\])+/, '');
  const full = path.join(LANDING_DIR, safe);
  if (!full.startsWith(LANDING_DIR)) { res.writeHead(403); res.end('Forbidden'); return true; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
  return true;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AdRoom Backend</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0B0F19; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #151B2B; border: 1px solid #1E293B; border-radius: 24px; padding: 48px 40px; max-width: 560px; width: 100%; text-align: center; }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 999px; padding: 6px 16px; margin-bottom: 32px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #10B981; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
    .badge-text { color: #34D399; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
    h1 { font-size: 32px; font-weight: 900; margin-bottom: 12px; background: linear-gradient(135deg, #00F0FF, #7000FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .sub { color: #64748B; font-size: 15px; line-height: 1.6; margin-bottom: 36px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 36px; }
    .stat { background: #0B0F19; border: 1px solid #1E293B; border-radius: 14px; padding: 20px; }
    .stat-label { color: #475569; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
    .stat-value { color: #FFFFFF; font-size: 18px; font-weight: 800; }
    .agents { background: rgba(0,240,255,0.04); border: 1px solid rgba(0,240,255,0.1); border-radius: 16px; padding: 20px; text-align: left; }
    .agents-title { color: #64748B; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 14px; }
    .agent-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .agent-dot { width: 6px; height: 6px; border-radius: 50%; background: #00F0FF; }
    .agent-name { color: #E2E8F0; font-size: 13px; font-weight: 600; }
    .agent-desc { color: #475569; font-size: 12px; margin-left: auto; }
    .note { color: #475569; font-size: 12px; margin-top: 24px; line-height: 1.6; }
    a { color: #00F0FF; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <div class="dot"></div>
      <span class="badge-text">BACKEND RUNNING</span>
    </div>
    <h1>AdRoom AI</h1>
    <p class="sub">Autonomous Social Media Marketing Platform<br>Backend API is live and serving requests on port 8000.</p>
    
    <div class="grid">
      <div class="stat">
        <div class="stat-label">API Port</div>
        <div class="stat-value">:8000</div>
      </div>
      <div class="stat">
        <div class="stat-label">App Type</div>
        <div class="stat-value">Mobile</div>
      </div>
      <div class="stat">
        <div class="stat-label">Database</div>
        <div class="stat-value">Supabase</div>
      </div>
      <div class="stat">
        <div class="stat-label">AI Engine</div>
        <div class="stat-value">GPT-4o</div>
      </div>
    </div>

    <div class="agents">
      <div class="agents-title">Autonomous Agents</div>
      <div class="agent-row"><div class="agent-dot"></div><span class="agent-name">SALESMAN</span><span class="agent-desc">Conversion + Lead capture</span></div>
      <div class="agent-row"><div class="agent-dot"></div><span class="agent-name">AWARENESS</span><span class="agent-desc">Reach + Virality</span></div>
      <div class="agent-row"><div class="agent-dot"></div><span class="agent-name">PROMOTION</span><span class="agent-desc">FOMO + Offers</span></div>
      <div class="agent-row"><div class="agent-dot"></div><span class="agent-name">LAUNCH</span><span class="agent-desc">Hype + Announcements</span></div>
    </div>
    
    <p class="note">
      This is a React Native mobile app. Open it in <strong>Expo Go</strong> on your device or run<br>
      <code style="color:#00F0FF">npx expo start</code> locally to connect.<br><br>
      API endpoint: <a href="/api-status" target="_blank">Check API health →</a>
    </p>
  </div>
</body>
</html>`;

// Investor reservations — written to investors.txt at project root.
// File is intentionally NOT inside landing/ so it can never be served publicly.
const INVESTORS_FILE = path.join(__dirname, 'investors.txt');
const RESERVE_LIMIT_PER_HOUR = 5;
const reserveHits = new Map(); // ip -> [timestamps]

function clientIp(req){
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.toString().split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function clean(s, max){
  return String(s == null ? '' : s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, max);
}
function rateLimited(ip){
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const hits = (reserveHits.get(ip) || []).filter(t => t > cutoff);
  hits.push(now);
  reserveHits.set(ip, hits);
  return hits.length > RESERVE_LIMIT_PER_HOUR;
}

function handleReserve(req, res){
  let body = '';
  let total = 0;
  req.on('data', chunk => {
    total += chunk.length;
    if (total > 16 * 1024) { req.destroy(); return; }
    body += chunk;
  });
  req.on('end', () => {
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    let payload;
    try {
      if (ctype.includes('application/x-www-form-urlencoded')) {
        payload = querystring.parse(body || '');
      } else if (ctype.includes('application/json') || (body && body.trim().startsWith('{'))) {
        payload = JSON.parse(body || '{}');
      } else {
        // Best-effort: try urlencoded for any unknown text body.
        payload = querystring.parse(body || '');
      }
    } catch {
      res.writeHead(400, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'Invalid request.'})); return;
    }

    // Honeypot
    if (payload.website && String(payload.website).trim()) {
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); return;
    }

    const ip = clientIp(req);
    if (rateLimited(ip)) {
      res.writeHead(429, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'Too many submissions from this connection. Please try again later or email invest@adroomai.com.'}));
      return;
    }

    const name   = clean(payload.name,   120);
    const amount = clean(payload.amount, 20);
    const email  = clean(payload.email,  160);
    const phone  = clean(payload.phone,  40);
    const notes  = clean(payload.notes,  600);

    if (!name || !amount || !email || !phone) {
      res.writeHead(400, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'All required fields must be provided.'})); return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'Please enter a valid email address.'})); return;
    }

    const ua = clean(req.headers['user-agent'] || '', 200);
    const ts = new Date().toISOString();
    const sep = '─'.repeat(72);
    const entry =
`${sep}
[${ts}]  Early Investor Window — Reservation
  Name        : ${name}
  Amount (₦)  : ${amount}
  Email       : ${email}
  Phone/WA    : ${phone}
  Notes       : ${notes || '(none)'}
  IP          : ${ip}
  User-Agent  : ${ua}
`;
    fs.appendFile(INVESTORS_FILE, entry, { mode: 0o600 }, (err) => {
      if (err) {
        console.error('[Reserve] write failed:', err.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:'Could not save your reservation. Please email invest@adroomai.com.'}));
        return;
      }
      try { fs.chmodSync(INVESTORS_FILE, 0o600); } catch {}
      console.log(`[Reserve] new reservation from ${name} <${email}> for ₦${amount}`);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true}));
    });
  });
  req.on('error', () => {
    try { res.writeHead(400); res.end(); } catch {}
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url === '/api/reserve' || req.url === '/landing/reserve.php' || req.url === '/reserve.php')) {
    handleReserve(req, res); return;
  }
  if (tryServeLanding(req, res)) return;
  if (req.url === '/health' || req.url === '/api-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', backend: 'http://localhost:8000', type: 'mobile-app', agents: ['SALESMAN','AWARENESS','PROMOTION','LAUNCH'] }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[Status] AdRoom status page running on port ' + PORT);
});
