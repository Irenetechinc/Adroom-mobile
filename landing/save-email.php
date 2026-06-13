<?php
/**
 * AdRoom AI - Waitlist Email Collector
 * Appends submitted emails to whitelistusers.txt
 * View the file via cPanel File Manager → public_html/whitelistusers.txt
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$email = '';
if (!empty($_POST['email'])) {
    $email = trim($_POST['email']);
} else {
    $raw = file_get_contents('php://input');
    if ($raw) {
        $data = json_decode($raw, true);
        if (is_array($data) && !empty($data['email'])) {
            $email = trim($data['email']);
        }
    }
}

if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid email address']);
    exit;
}

$file = __DIR__ . '/whitelistusers.txt';
$timestamp = date('Y-m-d H:i:s');
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$line = $email . " | " . $timestamp . " | IP: " . $ip . PHP_EOL;

$existing = file_exists($file) ? file_get_contents($file) : '';
if (stripos($existing, $email) !== false) {
    echo json_encode(['ok' => true, 'duplicate' => true, 'message' => 'You are already on the waitlist.']);
    exit;
}

if (file_put_contents($file, $line, FILE_APPEND | LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not save email. Please try again.']);
    exit;
}

@chmod($file, 0644);

echo json_encode(['ok' => true, 'message' => 'You have been added to the waitlist.']);
