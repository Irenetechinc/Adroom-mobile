<?php
/**
 * AdRoom AI — Bug Report Submission Handler
 *
 * Drop-in PHP for cPanel hosting. NO Composer, NO npm, NO installations.
 * Uses cURL (built into PHP) to send mail via Resend's HTTP API.
 *
 * SETUP:
 *   1. Set the environment variables in cPanel (Software → MultiPHP INI Editor
 *      → "Editor Mode" → switch to PHP Variables OR add a .htaccess line:
 *        SetEnv RESEND_API_KEY re_xxxxxxxxxxxxxxxxxxxxxxxx
 *        SetEnv BUG_TO_EMAIL bugs@adroomai.com
 *        SetEnv BUG_FROM_EMAIL "AdRoom Bugs <noreply@adroomai.com>"
 *      ALTERNATIVELY hard-code them in the constants below.
 *   2. Submissions are appended to bug-reports.json (auto-created next to this
 *      file). View via cPanel File Manager.
 *   3. The user gets a JSON response { ok: true, id: "..." } and the form
 *      shows a success message. Email is sent in the background; if Resend
 *      fails the submission is still saved to disk.
 */

// ============================== CONFIG ==============================
// Prefer environment variables; fall back to in-file constants if you can't
// set env vars on your hosting plan.
$RESEND_API_KEY = getenv('RESEND_API_KEY') ?: '';        // re_xxxxxxxx
$TO_EMAIL       = getenv('BUG_TO_EMAIL')   ?: 'bugs@adroomai.com';
$FROM_EMAIL     = getenv('BUG_FROM_EMAIL') ?: 'AdRoom Bugs <noreply@adroomai.com>';
$LOG_FILE       = __DIR__ . '/bug-reports.json';
// ====================================================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// ---- Parse JSON body (the form posts JSON) ----
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) $body = $_POST;

function v($a, $k, $max = 0) {
    $val = isset($a[$k]) ? trim((string)$a[$k]) : '';
    if ($max > 0 && strlen($val) > $max) $val = substr($val, 0, $max);
    return $val;
}

$name      = v($body, 'name', 80);
$email     = v($body, 'email', 120);
$title     = v($body, 'title', 140);
$area      = v($body, 'area', 40);
$device    = v($body, 'device', 120);
$severity  = v($body, 'severity', 20);
$steps     = v($body, 'steps', 2000);
$expected  = v($body, 'expected', 1000);
$actual    = v($body, 'actual', 1500);

// ---- Validate ----
if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please provide a valid email address.']);
    exit;
}
if (!$title || !$steps || !$actual) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please fill in the required fields.']);
    exit;
}

// ---- Lightweight rate limit (per IP, max 5 / 10min) ----
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = __DIR__ . '/.rate-bug.json';
$now = time();
$rates = [];
if (file_exists($rateFile)) {
    $rates = json_decode((string)file_get_contents($rateFile), true) ?: [];
}
$rates[$ip] = array_values(array_filter($rates[$ip] ?? [], fn($t) => $t > $now - 600));
if (count($rates[$ip]) >= 5) {
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'Too many submissions — please wait a few minutes and try again.']);
    exit;
}
$rates[$ip][] = $now;
@file_put_contents($rateFile, json_encode($rates), LOCK_EX);
@chmod($rateFile, 0644);

// ---- Build report ----
$reportId = bin2hex(random_bytes(6));
$report = [
    'id'        => $reportId,
    'received'  => gmdate('Y-m-d\TH:i:s\Z'),
    'name'      => $name,
    'email'     => $email,
    'title'     => $title,
    'area'      => $area,
    'device'    => $device,
    'severity'  => $severity,
    'steps'     => $steps,
    'expected'  => $expected,
    'actual'    => $actual,
    'ip'        => $ip,
    'ua'        => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300),
];

// ---- Append to JSON log file (so nothing is ever lost) ----
$existing = [];
if (file_exists($LOG_FILE)) {
    $existing = json_decode((string)file_get_contents($LOG_FILE), true) ?: [];
}
$existing[] = $report;
@file_put_contents($LOG_FILE, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
@chmod($LOG_FILE, 0644);

// ---- Send email via Resend (best effort) ----
$emailSent = false;
$emailError = null;
if ($RESEND_API_KEY && function_exists('curl_init')) {
    $sevColor = ['low' => '#10B981', 'medium' => '#F59E0B', 'high' => '#FB923C', 'critical' => '#EF4444'][$severity] ?? '#94A3B8';
    $html = '
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0B0F19;color:#E2E8F0;padding:24px;border-radius:14px;max-width:680px">
  <div style="background:'.$sevColor.';color:#0B0F19;display:inline-block;padding:5px 12px;border-radius:20px;font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px">'.htmlspecialchars(strtoupper($severity)).' SEVERITY</div>
  <h2 style="color:#FFF;margin:0 0 8px 0;font-size:22px">'.htmlspecialchars($title).'</h2>
  <p style="color:#94A3B8;margin:0 0 20px 0;font-size:13px">From <strong style="color:#00F0FF">'.htmlspecialchars($name ?: '(anonymous)').'</strong> &lt;'.htmlspecialchars($email).'&gt;</p>
  <table style="width:100%;border-collapse:collapse;background:#151B2B;border:1px solid #1E293B;border-radius:10px;overflow:hidden;margin-bottom:18px;font-size:13px">
    <tr><td style="padding:10px 14px;color:#64748B;width:120px;border-bottom:1px solid #1E293B">Area</td><td style="padding:10px 14px;color:#E2E8F0;border-bottom:1px solid #1E293B">'.htmlspecialchars($area).'</td></tr>
    <tr><td style="padding:10px 14px;color:#64748B;border-bottom:1px solid #1E293B">Device</td><td style="padding:10px 14px;color:#E2E8F0;border-bottom:1px solid #1E293B">'.htmlspecialchars($device).'</td></tr>
    <tr><td style="padding:10px 14px;color:#64748B">Report ID</td><td style="padding:10px 14px;color:#E2E8F0"><code>'.$reportId.'</code></td></tr>
  </table>
  <h3 style="color:#00F0FF;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:20px 0 8px 0">Steps to reproduce</h3>
  <pre style="white-space:pre-wrap;background:#151B2B;border:1px solid #1E293B;color:#E2E8F0;padding:14px;border-radius:10px;font-size:13px;margin:0 0 16px 0">'.htmlspecialchars($steps).'</pre>
  '.($expected ? '<h3 style="color:#00F0FF;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:20px 0 8px 0">Expected</h3><pre style="white-space:pre-wrap;background:#151B2B;border:1px solid #1E293B;color:#E2E8F0;padding:14px;border-radius:10px;font-size:13px;margin:0 0 16px 0">'.htmlspecialchars($expected).'</pre>' : '').'
  <h3 style="color:#EF4444;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:20px 0 8px 0">Actual</h3>
  <pre style="white-space:pre-wrap;background:#151B2B;border:1px solid #EF4444;color:#FCA5A5;padding:14px;border-radius:10px;font-size:13px;margin:0">'.htmlspecialchars($actual).'</pre>
</div>';

    $payload = [
        'from'     => $FROM_EMAIL,
        'to'       => [$TO_EMAIL],
        'reply_to' => $email,
        'subject'  => '[Bug · '.strtoupper($severity).'] '.$title,
        'html'     => $html,
    ];

    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $RESEND_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload),
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code >= 200 && $code < 300) {
        $emailSent = true;
    } else {
        $emailError = "Resend HTTP $code";
    }
}

echo json_encode([
    'ok'        => true,
    'id'        => $reportId,
    'emailSent' => $emailSent,
    'emailError'=> $emailError,
    'message'   => 'Thanks — your bug report has been received. We typically respond within 24 hours.',
]);
