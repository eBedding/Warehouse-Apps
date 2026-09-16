<?php
// api/send-report.php
// Sends problem reports via Mailgun EU API

// Security headers
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

// CORS. This is NOT access control: it only stops other websites calling this
// endpoint from a visitor's browser. Any script or curl request ignores it
// entirely, so the rate limiting and validation below are the real defences.
$allowedOrigins = [
    'https://tools.e-bedding.co.uk',
    'http://localhost:3000', // for local dev
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: {$origin}");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// -----------------------------------------------------------------------------
// Rate limiting, per IP, over a one hour window.
//
// Two separate ceilings. Successes are what reach the inbox, so they stay
// tightly capped. Attempts are counted as well — and counted BEFORE any
// validation runs — because otherwise a request that fails validation costs
// the sender nothing and can be repeated forever.
//
// NOTE: this keys on REMOTE_ADDR, which is the real client only because nginx
// talks to PHP directly. Behind a proxy or CDN every request would arrive with
// the proxy's address and this would silently become a single global counter.
// -----------------------------------------------------------------------------
$rateLimitFile = sys_get_temp_dir() . '/report_ratelimit_' . md5($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '.json';
$maxSuccesses = 5;    // emails actually sent
$maxAttempts  = 30;   // requests of any kind, valid or not
$rateWindow = 3600;   // 1 hour
$now = time();

$state = [];
if (file_exists($rateLimitFile)) {
    $state = json_decode(file_get_contents($rateLimitFile), true) ?: [];
}
// Files written by the previous version are a flat list of successes
if ($state && array_is_list($state)) {
    $state = ['ok' => $state, 'attempts' => []];
}

$recent = fn($list) => array_values(array_filter(
    is_array($list) ? $list : [],
    fn($ts) => is_numeric($ts) && ($now - $ts) < $rateWindow
));
$successes = $recent($state['ok'] ?? []);
$attempts  = $recent($state['attempts'] ?? []);

$saveState = function () use (&$successes, &$attempts, $rateLimitFile) {
    file_put_contents(
        $rateLimitFile,
        json_encode(['ok' => array_values($successes), 'attempts' => array_values($attempts)]),
        LOCK_EX
    );
};

if (count($attempts) >= $maxAttempts || count($successes) >= $maxSuccesses) {
    // Record the rejection too, so hammering a limited address keeps extending
    // the window rather than being free once the ceiling is reached.
    $attempts[] = $now;
    $saveState();
    http_response_code(429);
    echo json_encode(['error' => 'Too many requests. Please try again later.']);
    exit;
}

// Counted now, before validation, so invalid requests are not free
$attempts[] = $now;
$saveState();

// Load config
$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo json_encode(['error' => 'Server configuration missing']);
    exit;
}
require_once $configFile;

// Get POST data
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

// Validate required fields
$email = filter_var($input['email'] ?? '', FILTER_VALIDATE_EMAIL);
$description = trim($input['description'] ?? '');
$url = $input['url'] ?? '';
$jsonConfig = $input['jsonConfig'] ?? '';
$source = $input['source'] ?? 'pallets'; // 'pallets' or 'containers'

// Honeypot: a field hidden from people but visible to anything that fills in
// every input it finds. A real submission always leaves this empty.
//
// Answer as though it succeeded. Telling a bot it was caught just teaches it
// which field to skip next time, and there is no person here to inform.
$honeypot = trim((string) ($input['website'] ?? ''));
if ($honeypot !== '') {
    error_log('send-report: honeypot triggered from ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    echo json_encode(['success' => true, 'message' => 'Report sent successfully']);
    exit;
}
$challenge = strtoupper(preg_replace('/\s+/', '', $input['challenge'] ?? ''));

// Sanitize description (limit length, strip dangerous content)
$description = substr($description, 0, 2000);
$description = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');

// Sanitize JSON config (limit length)
if ($jsonConfig) {
    $jsonConfig = substr($jsonConfig, 0, 50000); // Allow up to 50KB for JSON config
}

// Validate URL belongs to your domain
if ($url && !preg_match('/^https?:\/\/(tools\.)?e-bedding\.co\.uk/i', $url)) {
    $url = '(invalid URL filtered)';
}

if (!$email) {
    http_response_code(400);
    echo json_encode(['error' => 'Valid email required']);
    exit;
}

// Validate challenge (SK9 1AX)
if ($challenge !== 'SK91AX') {
    http_response_code(400);
    echo json_encode(['error' => 'Security check failed']);
    exit;
}


// Determine tool name based on source
$toolName = ($source === 'containers') ? 'Container Tool' : 'Pallet Tool';

// Build email body
$body = "Problem Report - {$toolName}\n";
$body .= str_repeat("=", 30) . "\n\n";
$body .= "From: {$email}\n\n";

if ($source === 'containers' && $jsonConfig) {
    $body .= "JSON Configuration:\n";
    $body .= "-------------------\n";
    $body .= $jsonConfig . "\n\n";
} else {
    $body .= "URL: " . ($url ?: '(not provided)') . "\n\n";
}

$body .= "Description:\n" . ($description ?: '(No description provided)') . "\n\n";
$body .= "Submitted: " . date('Y-m-d H:i:s T') . "\n";

// Send via Mailgun EU API
$mailgunDomain = MAILGUN_DOMAIN;
$mailgunKey = MAILGUN_API_KEY;
$mailgunEndpoint = "https://api.eu.mailgun.net/v3/{$mailgunDomain}/messages";

$postData = [
    'from' => "{$toolName} <noreply@{$mailgunDomain}>",
    'to' => MAILGUN_TO_EMAIL,
    'reply-to' => $email,
    'subject' => "{$toolName} - Problem Report",
    'text' => $body,
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $mailgunEndpoint,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query($postData),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_USERPWD => "api:{$mailgunKey}",
    CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
    CURLOPT_TIMEOUT => 30,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    error_log("Mailgun curl error: " . $curlError); // Log for debugging, don't expose
    http_response_code(500);
    echo json_encode(['error' => 'Failed to send email. Please try again.']);
    exit;
}

if ($httpCode >= 200 && $httpCode < 300) {
    // Counted only once the mail is actually away. A failed send already cost
    // an attempt, so there is no abuse gap — but a Mailgun outage should not
    // burn someone's quota for a report that never arrived.
    $successes[] = $now;
    $saveState();
    echo json_encode(['success' => true, 'message' => 'Report sent successfully']);
} else {
    error_log("Mailgun HTTP error: " . $httpCode . " - " . $response); // Log for debugging
    http_response_code(500);
    echo json_encode(['error' => 'Failed to send email. Please try again.']);
}
