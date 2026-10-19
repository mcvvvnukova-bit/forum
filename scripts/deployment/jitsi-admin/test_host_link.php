<?php
declare(strict_types=1);

require '/var/www/html/vendor/autoload.php';
$implementation = $argv[1] ?? '/work/ForumHostLink.php';
if (!is_file($implementation)) {
    fwrite(STDERR, "FAIL: authenticated existing-room host launcher is not implemented\n");
    exit(1);
}
require $implementation;

use App\Service\ForumHostLink;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

function check(bool $ok, string $message): void {
    if (!$ok) { throw new RuntimeException($message); }
}
function rejected(callable $operation, string $type = DomainException::class): void {
    try { $operation(); }
    catch (Throwable $error) {
        check($error instanceof $type, 'Unexpected rejection type: ' . get_class($error));
        return;
    }
    throw new RuntimeException('Unauthorized input was accepted');
}
function b64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }

$now = time();
$identity = ['sub' => 'qa-staff-id', 'name' => 'QA staff', 'email' => 'qa@example.invalid', 'groups' => ['/vks-organizers']];
$room = '0b23ab34-4d56-4f78-9123-456789abcdef';
$key = str_repeat('s', 48);
$private = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($private, $pem);
$rsa = openssl_pkey_get_details($private)['rsa'];
$jwks = ['keys' => [['kty' => 'RSA', 'alg' => 'RS256', 'use' => 'sig', 'kid' => 'qa-key', 'n' => b64($rsa['n']), 'e' => b64($rsa['e'])]]];
$idClaims = $identity + ['iss' => 'https://vks.mvpspace.ru/admin/auth/realms/vks', 'aud' => 'jitsi-admin', 'azp' => 'jitsi-admin', 'iat' => $now, 'exp' => $now + 300];
$idToken = JWT::encode($idClaims, $pem, 'RS256', 'qa-key');

$tests = [];
$tests['room-scoped moderator link preserves a Cal UUID'] = static function () use ($identity, $room, $key, $now) {
    $url = ForumHostLink::create($identity, strtoupper($room), 'vks-test', $key, $now);
    $parsed = parse_url($url);
    check($parsed['scheme'] === 'https' && $parsed['host'] === 'vks.mvpspace.ru', 'Unexpected redirect destination');
    check($parsed['path'] === '/' . $room, 'Existing room name changed');
    parse_str($parsed['query'], $query);
    $claims = JWT::decode($query['jwt'], new Key($key, 'HS256'));
    check($claims->room === $room && $claims->room !== '*', 'Token is not room-scoped');
    check($claims->iss === 'vks-test' && $claims->aud === 'jitsi_admin', 'Wrong issuer/audience');
    check($claims->context->user->moderator === true, 'Host is not moderator');
    check($claims->context->user->id === 'qa-staff-id', 'Wrong identity in meeting');
    check($claims->exp > $now && $claims->exp <= $now + 120, 'Host token lifetime exceeds two minutes');
};
$tests['ordinary account cannot mint a moderator link'] = static function () use ($identity, $room, $key, $now) {
    $identity['groups'] = ['/another-group'];
    rejected(static fn() => ForumHostLink::create($identity, $room, 'vks-test', $key, $now));
};
$tests['substring of an organizer group grants no authority'] = static function () use ($identity, $room, $key, $now) {
    $identity['groups'] = ['/vks-organizers-extra'];
    rejected(static fn() => ForumHostLink::create($identity, $room, 'vks-test', $key, $now));
};
$tests['missing staff subject is denied'] = static function () use ($identity, $room, $key, $now) {
    unset($identity['sub']);
    rejected(static fn() => ForumHostLink::create($identity, $room, 'vks-test', $key, $now));
};
foreach (['', '*', 'admin', 'http-bind', 'xmpp-websocket', '//evil.invalid', '../room', 'a/b', 'x?jwt=forged', "x\nheader", str_repeat('a', 129)] as $badRoom) {
    $tests['invalid room rejected: ' . json_encode($badRoom)] = static fn() => rejected(static fn() => ForumHostLink::create($identity, $badRoom, 'vks-test', $key, $now), InvalidArgumentException::class);
}
$tests['weak signing secret is refused'] = static fn() => rejected(static fn() => ForumHostLink::create($identity, $room, 'vks-test', 'weak', $now), UnexpectedValueException::class);
$tests['portal room can refresh through the same authenticated host path'] = static function () use ($identity, $key, $now) {
    $url = ForumHostLink::create($identity, '__jitsi_admin__proj213-992', 'vks-test', $key, $now);
    check(parse_url($url, PHP_URL_PATH) === '/__jitsi_admin__proj213-992', 'Portal room was changed');
};
$tests['valid signed identity is accepted'] = static function () use ($idToken, $jwks, $now) {
    $claims = ForumHostLink::validateIdentity($idToken, $jwks, 'qa-staff-id', $now);
    check($claims['sub'] === 'qa-staff-id', 'Identity was replaced');
};
foreach (['iss' => 'https://evil.invalid/realms/vks', 'aud' => 'another-client', 'azp' => 'another-client', 'sub' => 'another-user', 'exp' => $now - 10] as $claim => $value) {
    $tests['wrong identity claim rejected: ' . $claim] = static function () use ($idClaims, $claim, $value, $pem, $jwks, $now) {
        $claims = $idClaims;
        $claims[$claim] = $value;
        $token = JWT::encode($claims, $pem, 'RS256', 'qa-key');
        rejected(static fn() => ForumHostLink::validateIdentity($token, $jwks, 'qa-staff-id', $now), UnexpectedValueException::class);
    };
}
$tests['forged organizer claims fail signature validation'] = static function () use ($idToken, $jwks, $now) {
    $parts = explode('.', $idToken);
    $parts[1] = b64(json_encode(['sub' => 'qa-staff-id', 'groups' => ['/vks-organizers'], 'exp' => $now + 300]));
    rejected(static fn() => ForumHostLink::validateIdentity(implode('.', $parts), $jwks, 'qa-staff-id', $now), UnexpectedValueException::class);
};

$failed = 0;
foreach ($tests as $name => $test) {
    try { $test(); echo "PASS: $name\n"; }
    catch (Throwable $error) { $failed++; fwrite(STDERR, "FAIL: $name: " . $error->getMessage() . "\n"); }
}
echo count($tests) . ' tests, ' . $failed . " failures\n";
exit($failed === 0 ? 0 : 1);
