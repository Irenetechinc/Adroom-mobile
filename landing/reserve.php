<?php
/**
 * AdRoom AI — Investor reservation handler
 * --------------------------------------------------------------
 * Drop this file into the same directory as investors.html on
 * any PHP-enabled host (Afeeshost, InfinityFree, AwardSpace,
 * cPanel, etc.). No dependencies. No build step.
 *
 * - Accepts POST application/x-www-form-urlencoded or multipart
 * - Validates + sanitises every field
 * - Honeypot ("website") silently drops bots
 * - Per-IP rate-limit: 5 submissions / hour
 * - Appends to investors.txt in this folder, mode 0600
 * - .htaccess (shipped alongside) blocks public access to
 *   investors.txt and the rate-limit file
 * --------------------------------------------------------------
 */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function out(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    out(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

$dataDir   = __DIR__;
$dataFile  = $dataDir . DIRECTORY_SEPARATOR . 'investors.txt';
$rateFile  = $dataDir . DIRECTORY_SEPARATOR . '.reserve_rate.json';

$ip = $_SERVER['HTTP_CF_CONNECTING_IP']
    ?? $_SERVER['HTTP_X_FORWARDED_FOR']
    ?? $_SERVER['REMOTE_ADDR']
    ?? 'unknown';
if (is_string($ip) && strpos($ip, ',') !== false) {
    $ip = trim(explode(',', $ip)[0]);
}

/* ---------- rate limit: 5 / hour / ip ---------- */
$now = time();
$window = 3600;
$max = 5;
$rates = [];
if (is_file($rateFile)) {
    $raw = @file_get_contents($rateFile);
    if ($raw) {
        $tmp = json_decode($raw, true);
        if (is_array($tmp)) $rates = $tmp;
    }
}
foreach ($rates as $k => $arr) {
    $rates[$k] = array_values(array_filter($arr, fn($t) => is_int($t) && ($now - $t) < $window));
    if (empty($rates[$k])) unset($rates[$k]);
}
$ipKey = (string)$ip;
$count = isset($rates[$ipKey]) ? count($rates[$ipKey]) : 0;
if ($count >= $max) {
    out(429, ['ok' => false, 'error' => 'Too many submissions. Please try again later or email invest@adroomai.com.']);
}

/* ---------- gather + sanitise ---------- */
function clean(string $v, int $max = 600): string {
    $v = trim($v);
    // strip control chars except tab/newline
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
    if (mb_strlen($v) > $max) $v = mb_substr($v, 0, $max);
    return $v;
}

$name    = clean((string)($_POST['name']    ?? ''), 120);
$amount  = clean((string)($_POST['amount']  ?? ''), 60);
$email   = clean((string)($_POST['email']   ?? ''), 160);
$phone   = clean((string)($_POST['phone']   ?? ''), 60);
$notes   = clean((string)($_POST['notes']   ?? ''), 600);
$honey   = clean((string)($_POST['website'] ?? ''), 200);

// Honeypot — silently accept and drop bots.
if ($honey !== '') {
    out(200, ['ok' => true]);
}

if ($name === '' || $amount === '' || $email === '' || $phone === '') {
    out(400, ['ok' => false, 'error' => 'Please fill in all required fields.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    out(400, ['ok' => false, 'error' => 'Please enter a valid email address.']);
}

/* ---------- write entry ---------- */
$ua    = clean((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 240);
$stamp = gmdate('Y-m-d\TH:i:s\Z');
$line  = sprintf(
    "[%s] ip=%s name=%s amount=%s email=%s phone=%s notes=%s ua=%s\n",
    $stamp,
    $ip,
    str_replace(["\r","\n","\t"], ' ', $name),
    str_replace(["\r","\n","\t"], ' ', $amount),
    str_replace(["\r","\n","\t"], ' ', $email),
    str_replace(["\r","\n","\t"], ' ', $phone),
    str_replace(["\r","\n","\t"], ' ', $notes),
    str_replace(["\r","\n","\t"], ' ', $ua)
);

$fp = @fopen($dataFile, 'ab');
if (!$fp) {
    out(500, ['ok' => false, 'error' => 'Could not save your reservation. Please email invest@adroomai.com directly.']);
}
if (flock($fp, LOCK_EX)) {
    fwrite($fp, $line);
    fflush($fp);
    flock($fp, LOCK_UN);
}
fclose($fp);
@chmod($dataFile, 0600);

/* ---------- record rate-limit hit ---------- */
$rates[$ipKey] = $rates[$ipKey] ?? [];
$rates[$ipKey][] = $now;
@file_put_contents($rateFile, json_encode($rates), LOCK_EX);
@chmod($rateFile, 0600);

out(200, ['ok' => true]);
