<?php
declare(strict_types=1);

namespace App\Service;

use App\Entity\Rooms;
use App\Entity\Server;
use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;

/** The pinned upstream release otherwise issues meeting tokens without expiry. */
#[AsDecorator(decorates: RoomService::class)]
final class ForumRoomService extends RoomService
{
    public function genereateJwtPayload($userName, Rooms $room, Server $server, $moderator, ?User $user = null, $avatar = null, $noModerator = false, $skipLobby = false, $enableMic = null, $enableCamera = null, $lobbyModerator = false): ?array
    {
        $payload = parent::genereateJwtPayload($userName, $room, $server, $moderator, $user, $avatar, $noModerator, $skipLobby, $enableMic, $enableCamera, $lobbyModerator);
        if ($payload !== null) {
            $now = time();
            $payload['iat'] = $now;
            $payload['nbf'] = $now - 5;
            $payload['exp'] = $now + 3600;
        }
        return $payload;
    }
}
