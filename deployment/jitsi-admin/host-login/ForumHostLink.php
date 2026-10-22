<?php
declare(strict_types=1);

namespace App\Service;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;

/** Room-scoped host tokens for unchanged Cal.diy meeting URLs. */
final class ForumHostLink
{
    public static function validateIdentity(string $idToken, array $jwks, string $expectedSub, int $now): array
    {
        $previousTimestamp = JWT::$timestamp;
        try {
            JWT::$timestamp = $now;
            $claims = (array) JWT::decode($idToken, JWK::parseKeySet($jwks, 'RS256'));
            $audiences = (array) ($claims['aud'] ?? []);
            if ($expectedSub === '' || ($claims['sub'] ?? null) !== $expectedSub
                || ($claims['iss'] ?? null) !== 'https://vks.mvpspace.ru/admin/auth/realms/vks'
                || !in_array('jitsi-admin', $audiences, true)
                || (isset($claims['azp']) && $claims['azp'] !== 'jitsi-admin')
                || !isset($claims['exp']) || $claims['exp'] <= $now) {
                throw new \UnexpectedValueException('Identity claims do not match this application');
            }
            return $claims;
        } catch (\Throwable $error) {
            throw new \UnexpectedValueException('A fresh verified identity is required', 0, $error);
        } finally {
            JWT::$timestamp = $previousTimestamp;
        }
    }

    public static function create(array $identity, string $room, string $appId, string $key, int $now): string
    {
        if (!is_string($identity['sub'] ?? null) || $identity['sub'] === ''
            || !in_array('/vks-organizers', (array) ($identity['groups'] ?? []), true)) {
            throw new \DomainException('Organizer membership is required');
        }
        $room = strtolower($room);
        if (strlen($room) > 128 || !preg_match('/\A(?:[a-z0-9]|__jitsi_admin__[a-z0-9])[a-z0-9_-]*\z/D', $room)
            || in_array($room, ['admin', 'build', 'libs', 'css', 'images', 'http-bind', 'xmpp-websocket'], true)) {
            throw new \InvalidArgumentException('Invalid meeting name');
        }
        if ($appId === '' || strlen($key) < 32) {
            throw new \UnexpectedValueException('Missing strong meeting signing credentials');
        }
        $token = JWT::encode([
            'aud' => 'jitsi_admin', 'iss' => $appId, 'sub' => 'vks.mvpspace.ru',
            'room' => $room, 'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 120,
            'context' => ['user' => [
                'id' => $identity['sub'], 'name' => (string) ($identity['name'] ?? 'Organizer'),
                'email' => (string) ($identity['email'] ?? ''), 'moderator' => true,
            ]],
        ], $key, 'HS256');
        return 'https://vks.mvpspace.ru/' . $room . '?jwt=' . rawurlencode($token);
    }
}
