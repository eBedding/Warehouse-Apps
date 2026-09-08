<?php
/**
 * api/export-products.php
 *
 * Pulls carton (outer) dimensions from Plytix and writes data/products.json,
 * which the pallet planner loads client-side. Run from cron, never from the web:
 *
 *   0 6 * * *  /usr/bin/php /var/www/tools/api/export-products.php >> /var/log/plytix-export.log 2>&1
 *
 * Credentials come from the environment, or a .env file (see .env.example).
 * Required: PLYTIX_API_KEY, PLYTIX_API_PASSWORD
 *
 * Exits non-zero on failure and leaves the previous products.json untouched,
 * so a bad run degrades to stale data rather than no data.
 */

// -------------------------------------------------------------------------
// CLI only. This sits in a web-served directory, so refuse HTTP outright.
// -------------------------------------------------------------------------
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Not available over HTTP']);
    exit(1);
}

// -------------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------------
/**
 * Settings come from the environment. A .env file is also read, because cron
 * runs with a near-empty environment and does not inherit a login shell's
 * exports — so relying on real env vars alone would work when run by hand and
 * silently fail at 6am.
 *
 * Precedence: real environment variable, then .env file.
 *
 * The .env is looked for ABOVE the web root first. This directory is served by
 * nginx, so a .env kept alongside index.html is fetchable at /.env unless
 * nginx is configured to deny it — see .env.example.
 */
function loadEnvFile(): ?string {
    $webRoot   = dirname(__DIR__);
    $candidates = array_filter([
        getenv('PLYTIX_ENV_FILE') ?: null,
        dirname($webRoot) . '/.env',   // preferred: outside the web root
        $webRoot . '/.env',            // convenient for local development
    ]);

    foreach ($candidates as $path) {
        if (!is_readable($path)) {
            continue;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key   = trim($key);
            $value = trim($value);
            // Strip one layer of matching quotes
            if (strlen($value) > 1 && $value[0] === $value[-1] && ($value[0] === '"' || $value[0] === "'")) {
                $value = substr($value, 1, -1);
            }
            // A real environment variable always wins
            if ($key !== '' && getenv($key) === false) {
                putenv("{$key}={$value}");
            }
        }
        return $path;
    }
    return null;
}

$envFile = loadEnvFile();

// Optional: reuse the Mailgun settings send-report.php already has on the
// server, so failure alerts need no additional configuration.
$mailConfig = __DIR__ . '/config.php';
if (is_readable($mailConfig)) {
    require_once $mailConfig;
}

function envValue(string $key, ?string $default = null): ?string {
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}

function envRequired(string $key): string {
    $v = envValue($key);
    if ($v === null) {
        // Routed through fail() so a misconfiguration alerts like any other
        // failure — it is the most likely thing to break just after a deploy.
        fail("{$key} is not set (environment or .env file)");
    }
    return $v;
}

define('PLYTIX_API_KEY', envRequired('PLYTIX_API_KEY'));
define('PLYTIX_API_PASSWORD', envRequired('PLYTIX_API_PASSWORD'));

// Endpoints are overridable from config.php so the script can be pointed at a
// mock or sandbox without editing it.
define('AUTH_URL', envValue('PLYTIX_AUTH_URL', 'https://auth.plytix.com/auth/api/get-token'));
define('PIM_BASE_URL', envValue('PLYTIX_PIM_BASE_URL', 'https://pim.plytix.com'));
const SEARCH_PATH  = '/api/v1/products/search';
const PAGE_SIZE    = 100;   // Plytix maximum
const MAX_PAGES    = 500;   // hard stop; 500 x 100 = 50,000 products
const HTTP_TIMEOUT = 30;

// Plytix attribute names → our schema. Mapped by NAME, never by column order:
// the Plytix grid displays H, L, W while the planner takes L, W, H.
const ATTR_SKU     = 'sku';
// The product name attribute. Semantic rather than structural, so it is
// overridable from config.php if Plytix is reorganised.
define('ATTR_NAME', envValue('PLYTIX_NAME_ATTRIBUTE', 'product_title'));
const ATTR_DIM_L   = 'bale_carton_outer_dimension_l';
const ATTR_DIM_W   = 'bale_carton_outer_dimension_w';
const ATTR_DIM_H   = 'bale_carton_outer_dimension_h';
const ATTR_WEIGHT  = 'bale_carton_outer_weight_kg';
const ATTR_QTY     = 'bale_carton_outer_qty';

// Plytix stores dimensions in centimetres; the planner works entirely in mm.
const CM_TO_MM = 10;

// Sanity bounds, in mm, applied after conversion. A unit mix-up is a silent
// 10x error that still renders a plausible-looking pallet, so anything outside
// a believable carton size is excluded and reported rather than trusted.
const MIN_DIM_MM = 50;      // 5 cm
const MAX_DIM_MM = 2000;    // 2 m — longer than any pallet dimension we support
const MAX_WEIGHT_KG = 500;

// Refuse to overwrite a healthy file with a suspiciously small result — an
// API hiccup returning two products should not wipe a catalogue of thousands.
const MIN_SHRINK_RATIO = 0.5;

$outputFile = envValue('PLYTIX_OUTPUT_FILE', dirname(__DIR__) . '/data/products.json');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function logLine(string $msg): void {
    fwrite(STDOUT, '[' . date('Y-m-d H:i:s') . '] ' . $msg . PHP_EOL);
}

function fail(string $msg): void {
    fwrite(STDERR, '[' . date('Y-m-d H:i:s') . '] ERROR: ' . $msg . PHP_EOL);
    alertFailure($msg);
    exit(1);
}

/** Setting from a defined constant (config.php) or the environment. */
function mailSetting(string $key): ?string {
    if (defined($key) && constant($key) !== '') {
        return (string) constant($key);
    }
    $v = getenv($key);
    return ($v === false || $v === '') ? null : $v;
}

/**
 * Email on failure. Without this a broken export is invisible: the site keeps
 * serving the last good catalogue, so nothing looks wrong while the data
 * quietly goes stale. Never throws — an alert that fails must not mask the
 * original error, and must not recurse back into fail().
 */
function alertFailure(string $msg): void {
    static $sent = false;
    if ($sent) {
        return;
    }
    $sent = true;

    if (mailSetting('PLYTIX_ALERTS_DISABLED')) {
        return;
    }

    $domain = mailSetting('MAILGUN_DOMAIN');
    $key    = mailSetting('MAILGUN_API_KEY');
    $to     = mailSetting('PLYTIX_ALERT_EMAIL') ?? mailSetting('MAILGUN_TO_EMAIL');

    if (!$domain || !$key || !$to) {
        fwrite(STDERR, '  (no Mailgun configuration; alert email not sent)' . PHP_EOL);
        return;
    }

    $host = gethostname() ?: 'unknown host';
    $body = "The Plytix product export failed.\n\n"
          . str_repeat('=', 40) . "\n\n"
          . "Error:  {$msg}\n"
          . "Host:   {$host}\n"
          . "Script: " . __FILE__ . "\n"
          . "Time:   " . date('Y-m-d H:i:s T') . "\n\n"
          . "The previous data/products.json has been left untouched, so the\n"
          . "planner is still serving the last good catalogue — it will simply\n"
          . "go stale until this is resolved.\n";

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => (mailSetting('MAILGUN_ENDPOINT') ?? "https://api.eu.mailgun.net/v3/{$domain}") . "/messages",
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'from'    => "Pallet Tool <noreply@{$domain}>",
            'to'      => $to,
            'subject' => 'Plytix product export FAILED',
            'text'    => $body,
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD        => "api:{$key}",
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $res    = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err || $status < 200 || $status >= 300) {
        fwrite(STDERR, '  (alert email failed: ' . ($err ?: "HTTP {$status} " . substr((string) $res, 0, 200)) . ')' . PHP_EOL);
    } else {
        fwrite(STDERR, "  (alert email sent to {$to})" . PHP_EOL);
    }
}

/**
 * POST JSON, retrying on 429 (honouring Retry-After) and on 5xx.
 */
function postJson(string $url, array $body, ?string $token = null, int $attempt = 1, int $throttled = 0): array {
    $headers = ['Content-Type: application/json'];
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => HTTP_TIMEOUT,
        CURLOPT_HEADER         => true,
    ]);

    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        if ($attempt < 3) {
            sleep(5 * $attempt);
            return postJson($url, $body, $token, $attempt + 1);
        }
        fail("Request to {$url} failed: {$err}");
    }

    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $rawHeaders = substr($raw, 0, $headerSize);
    $rawBody    = substr($raw, $headerSize);
    curl_close($ch);

    // Plytix allows 20 requests per window and then returns 429 with a short
    // Retry-After. A full catalogue is ~49 pages, so this is expected rather
    // than exceptional; waiting is not counted as a failed attempt, but is
    // bounded so a persistent throttle cannot loop forever.
    if ($status === 429) {
        if ($throttled >= 50) {
            fail('Still rate limited after 50 waits; giving up');
        }
        $retryAfter = 60;
        if (preg_match('/^Retry-After:\s*(\d+)/mi', $rawHeaders, $m)) {
            $retryAfter = max(1, (int) $m[1]);
        }
        logLine("Rate limited; waiting {$retryAfter}s");
        sleep($retryAfter);
        return postJson($url, $body, $token, $attempt, $throttled + 1);
    }

    if ($status >= 500 && $attempt < 3) {
        logLine("HTTP {$status} from Plytix; retrying");
        sleep(5 * $attempt);
        return postJson($url, $body, $token, $attempt + 1, $throttled);
    }

    if ($status < 200 || $status >= 300) {
        fail("HTTP {$status} from {$url}: " . substr($rawBody, 0, 500));
    }

    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        fail("Malformed JSON from {$url}");
    }
    return $decoded;
}

/**
 * Custom attributes are addressed as "attributes.<label>" in requests, and come
 * back nested under an "attributes" object keyed by the bare label. System
 * fields such as sku stay at the top level.
 */
function attrField(string $label): string {
    return 'attributes.' . $label;
}

function attrValue(array $product, string $key) {
    $bag = $product['attributes'] ?? [];
    // An empty attributes bag is serialised as [] rather than {}
    $v = is_array($bag) && array_key_exists($key, $bag) ? $bag[$key] : null;
    if (is_array($v)) {
        $v = $v[0] ?? null;
    }
    return ($v === '' || $v === null) ? null : $v;
}

function systemValue(array $product, string $key) {
    $v = $product[$key] ?? null;
    if (is_array($v)) {
        $v = $v[0] ?? null;
    }
    return ($v === '' || $v === null) ? null : $v;
}

function toMm($cmValue): ?float {
    if ($cmValue === null || !is_numeric($cmValue)) {
        return null;
    }
    return round(((float) $cmValue) * CM_TO_MM, 1);
}

// -------------------------------------------------------------------------
// 1. Authenticate
// -------------------------------------------------------------------------
logLine('Authenticating with Plytix');
$auth = postJson(AUTH_URL, [
    'api_key'      => PLYTIX_API_KEY,
    'api_password' => PLYTIX_API_PASSWORD,
]);

$token = $auth['data'][0]['access_token'] ?? null;
if (!$token) {
    fail('No access_token in auth response');
}

// -------------------------------------------------------------------------
// 2. Page through products that actually have carton dimensions
//
// The filter is an OR of AND groups. One group requiring all three dimensions
// to exist means Plytix does the filtering, so we fetch only the usable subset
// rather than paging through every product in the catalogue.
// -------------------------------------------------------------------------
$attributes = array_merge(
    [ATTR_SKU],                                   // system field, top level
    array_map('attrField', [ATTR_NAME, ATTR_DIM_L, ATTR_DIM_W, ATTR_DIM_H, ATTR_WEIGHT, ATTR_QTY])
);

$filters = [[
    ['field' => attrField(ATTR_DIM_L), 'operator' => 'exists'],
    ['field' => attrField(ATTR_DIM_W), 'operator' => 'exists'],
    ['field' => attrField(ATTR_DIM_H), 'operator' => 'exists'],
]];

$products   = [];
$skipped    = ['incomplete' => 0, 'out_of_range' => [], 'no_sku' => 0];
$page       = 1;
$fetched    = 0;

while ($page <= MAX_PAGES) {
    $response = postJson(PIM_BASE_URL . SEARCH_PATH, [
        'filters'              => $filters,
        'attributes'           => $attributes,
        'relationship_filters' => [],
        'pagination'           => [
            'order'     => ATTR_SKU,
            'page'      => $page,
            'page_size' => PAGE_SIZE,
        ],
    ], $token);

    $batch = $response['data'] ?? [];
    if (!count($batch)) {
        break;
    }
    $fetched += count($batch);

    foreach ($batch as $row) {
        $sku = systemValue($row, ATTR_SKU);
        if ($sku === null || trim((string) $sku) === '') {
            $skipped['no_sku']++;
            continue;
        }
        $sku = trim((string) $sku);

        $l = toMm(attrValue($row, ATTR_DIM_L));
        $w = toMm(attrValue($row, ATTR_DIM_W));
        $h = toMm(attrValue($row, ATTR_DIM_H));

        // Excluded from the catalogue entirely — a product that cannot be
        // planned is worse than absent, because it looks selectable.
        if ($l === null || $w === null || $h === null) {
            $skipped['incomplete']++;
            continue;
        }

        $outOfRange = false;
        foreach (['L' => $l, 'W' => $w, 'H' => $h] as $axis => $mm) {
            if ($mm < MIN_DIM_MM || $mm > MAX_DIM_MM) {
                $skipped['out_of_range'][] = "{$sku} ({$axis}={$mm}mm)";
                $outOfRange = true;
                break;
            }
        }
        if ($outOfRange) {
            continue;
        }

        $weightRaw = attrValue($row, ATTR_WEIGHT);
        $weight    = is_numeric($weightRaw) ? round((float) $weightRaw, 2) : 0.0;
        if ($weight < 0 || $weight > MAX_WEIGHT_KG) {
            $skipped['out_of_range'][] = "{$sku} (weight={$weight}kg)";
            continue;
        }

        $qtyRaw = attrValue($row, ATTR_QTY);
        $qty    = is_numeric($qtyRaw) ? (int) $qtyRaw : 0;

        $label = attrValue($row, ATTR_NAME);

        $products[] = [
            'sku'    => $sku,
            'name'   => ($label === null || trim((string) $label) === '') ? $sku : trim((string) $label),
            'carton' => [
                'l'      => $l,
                'w'      => $w,
                'h'      => $h,
                'weight' => $weight,
            ],
            'innersPerCarton' => $qty,
        ];
    }

    logLine(sprintf('Page %d: %d rows (%d usable so far)', $page, count($batch), count($products)));

    if (count($batch) < PAGE_SIZE) {
        break;
    }
    $page++;
}

if ($page > MAX_PAGES) {
    logLine('WARNING: hit MAX_PAGES; catalogue may be truncated');
}

// -------------------------------------------------------------------------
// 3. Integrity checks before touching the live file
// -------------------------------------------------------------------------
if (!count($products)) {
    fail('Plytix returned no usable products — leaving existing file untouched');
}

// SKU lookups in the browser are case-insensitive, so entries that differ only
// by case would make one of them unreachable.
$seen = [];
$collisions = [];
foreach ($products as $p) {
    $key = strtolower($p['sku']);
    if (isset($seen[$key])) {
        $collisions[] = $seen[$key] . ' / ' . $p['sku'];
    } else {
        $seen[$key] = $p['sku'];
    }
}
if ($collisions) {
    logLine('WARNING: SKUs colliding case-insensitively: ' . implode(', ', array_slice($collisions, 0, 10)));
}

if (file_exists($outputFile)) {
    $previous = json_decode((string) file_get_contents($outputFile), true);
    $prevCount = is_array($previous['products'] ?? null) ? count($previous['products']) : 0;
    if ($prevCount > 0 && count($products) < $prevCount * MIN_SHRINK_RATIO) {
        fail(sprintf(
            'Refusing to write: %d products is less than %.0f%% of the previous %d. ' .
            'Re-run to confirm, or delete data/products.json to force.',
            count($products), MIN_SHRINK_RATIO * 100, $prevCount
        ));
    }
}

// -------------------------------------------------------------------------
// 4. Write atomically so the web server never serves a half-written file
// -------------------------------------------------------------------------
$payload = [
    'generated' => gmdate('c'),
    'source'    => 'plytix',
    'units'     => 'mm',
    'products'  => $products,
];

$dir = dirname($outputFile);
if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
    fail("Could not create {$dir}");
}

$json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if ($json === false) {
    fail('Could not encode catalogue as JSON');
}

$tmp = $outputFile . '.tmp';
if (file_put_contents($tmp, $json) === false) {
    fail("Could not write {$tmp}");
}
if (!rename($tmp, $outputFile)) {
    @unlink($tmp);
    fail("Could not move {$tmp} into place");
}
@chmod($outputFile, 0644);

// -------------------------------------------------------------------------
// 5. Summary
// -------------------------------------------------------------------------
logLine(sprintf(
    'Wrote %s — %d products (%s) from %d fetched',
    $outputFile, count($products), formatBytes(strlen($json)), $fetched
));
if ($skipped['incomplete']) {
    logLine(sprintf('Skipped %d with incomplete dimensions', $skipped['incomplete']));
}
if ($skipped['no_sku']) {
    logLine(sprintf('Skipped %d with no SKU', $skipped['no_sku']));
}
if ($skipped['out_of_range']) {
    logLine(sprintf(
        'Skipped %d outside plausible range (check units in Plytix): %s',
        count($skipped['out_of_range']),
        implode(', ', array_slice($skipped['out_of_range'], 0, 10))
    ));
}

function formatBytes(int $b): string {
    return $b > 1048576 ? round($b / 1048576, 1) . ' MB' : round($b / 1024, 1) . ' KB';
}

exit(0);
