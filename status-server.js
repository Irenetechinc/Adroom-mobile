const http = require('http');
const fs = require('fs');
const path = require('path');
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

const server = http.createServer((req, res) => {
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
