<?php
/**
 * AdRoom AI — Feature Request Submission Handler
 *
 * Drop-in PHP for cPanel hosting. NO Composer, NO npm, NO installations.
 * Uses cURL (built into PHP) to send mail via Resend's HTTP API.
 *
 * SETUP:
 *   1. Set the environment variables in cPanel (or hard-code the constants):
 *        SetEnv RESEND_API_KEY re_xxxxxxxxxxxxxxxxxxxxxxxx
 *        SetEnv FEATURE_TO_EMAIL product@adroomai.com
 *        SetEnv FEATURE_FROM_EMAIL "AdRoom Features <noreply@adroomai.com>"
 *   2. Submissions are appended to feature-requests.json (auto-created next
 *      to this file). View via cPanel File Manager.
 */

// ============================== CONFIG ==============================
$RESEND_API_KEY = getenv('RESEND_API_KEY')      ?: '';
$TO_EMAIL       = getenv('FEATURE_TO_EMAIL')    ?: 'product@adroomai.com';
$FROM_EMAIL     = getenv('FEATURE_FROM_EMAIL')  ?: 'AdRoom Features <noreply@adroomai.com>';
$LOG_FILE       = __DIR__ . '/feature-requests.json';
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

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) $body = $_POST;

function v($a, $k, $max = 0) {
    $val = isset($a[$k]) ? trim((string)$a[$k]) : '';
    if ($max > 0 && strlen($val) > $max) $val = substr($val, 0, $max);
    return $val;
}

$name        = v($body, 'name', 80);
$email       = v($body, 'email', 120);
$title       = v($body, 'title', 120);
$category    = v($body, 'category', 40);
$priority    = v($body, 'priority', 20);
$description = v($body, 'description', 3000);

if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please provide a valid email address.']);
    exit;
}
if (!$title || !$description) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please fill in the required fields.']);
    exit;
}

// ---- Lightweight rate limit (per IP, max 5 / 10min) ----
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = __DIR__ . '/.rate-feature.json';
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

$reqId = bin2hex(random_bytes(6));
$record = [
    'id'          => $reqId,
    'received'    => gmdate('Y-m-d\TH:i:s\Z'),
    'name'        => $name,
    'email'       => $email,
    'title'       => $title,
    'category'    => $category,
    'priority'    => $priority,
    'description' => $description,
    'ip'          => $ip,
    'ua'          => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300),
];

// ---- Append to JSON log file ----
$existing = [];
if (file_exists($LOG_FILE)) {
    $existing = json_decode((string)file_get_contents($LOG_FILE), true) ?: [];
}
$existing[] = $record;
@file_put_contents($LOG_FILE, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
@chmod($LOG_FILE, 0644);

// ---- Send email via Resend (best effort) ----
$emailSent = false;
$emailError = null;
if ($RESEND_API_KEY && function_exists('curl_init')) {
    $priColor = ['nice' => '#94A3B8', 'useful' => '#00F0FF', 'critical' => '#A78BFA'][$priority] ?? '#94A3B8';
    $priLabel = ['nice' => 'NICE TO HAVE', 'useful' => 'WOULD BE USEFUL', 'critical' => 'CRITICAL FOR ME'][$priority] ?? strtoupper($priority);

    $html = '
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0B0F19;color:#E2E8F0;padding:24px;border-radius:14px;max-width:680px">
  <div style="background:'.$priColor.';color:#0B0F19;display:inline-block;padding:5px 12px;border-radius:20px;font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px">'.htmlspecialchars($priLabel).'</div>
  <h2 style="color:#FFF;margin:0 0 8px 0;font-size:22px">'.htmlspecialchars($title).'</h2>
  <p style="color:#94A3B8;margin:0 0 20px 0;font-size:13px">From <strong style="color:#A78BFA">'.htmlspecialchars($name ?: '(anonymous)').'</strong> &lt;'.htmlspecialchars($email).'&gt;</p>
  <table style="width:100%;border-collapse:collapse;background:#151B2B;border:1px solid #1E293B;border-radius:10px;overflow:hidden;margin-bottom:18px;font-size:13px">
    <tr><td style="padding:10px 14px;color:#64748B;width:120px;border-bottom:1px solid #1E293B">Category</td><td style="padding:10px 14px;color:#E2E8F0;border-bottom:1px solid #1E293B">'.htmlspecialchars($category).'</td></tr>
    <tr><td style="padding:10px 14px;color:#64748B">Request ID</td><td style="padding:10px 14px;color:#E2E8F0"><code>'.$reqId.'</code></td></tr>
  </table>
  <h3 style="color:#A78BFA;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:20px 0 8px 0">Description</h3>
  <pre style="white-space:pre-wrap;background:#151B2B;border:1px solid #1E293B;color:#E2E8F0;padding:14px;border-radius:10px;font-size:13px;margin:0">'.htmlspecialchars($description).'</pre>
</div>';

    $payload = [
        'from'     => $FROM_EMAIL,
        'to'       => [$TO_EMAIL],
        'reply_to' => $email,
        'subject'  => '[Feature Request] ' . $title,
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
    'id'        => $reqId,
    'emailSent' => $emailSent,
    'emailError'=> $emailError,
    'message'   => 'Thanks — your idea has been submitted. The product team reads every request.',
]);
