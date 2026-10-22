<?php
/** Idempotently seed only this installation's owner, Jitsi server and staff group. */
declare(strict_types=1);

use App\Entity\KeycloakGroupsToServers;
use App\Entity\Server;
use App\Entity\User;
use App\Kernel;

require '/var/www/html/vendor/autoload.php';

$configPath = $argv[1] ?? '/tmp/bootstrap-app.json';
$data = json_decode(file_get_contents($configPath), true, 512, JSON_THROW_ON_ERROR);
$kernel = new Kernel('prod', false);
$kernel->boot();
$em = $kernel->getContainer()->get('doctrine')->getManager();

$user = $em->getRepository(User::class)->findOneBy(['keycloakId' => $data['keycloak_id']]);
if (!$user) {
    $user = $em->getRepository(User::class)->findOneBy(['email' => $data['email']]);
}
if (!$user) {
    $user = (new User())
        ->setCreatedAt(new DateTime())
        ->setPassword(password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT))
        ->setUid(bin2hex(random_bytes(16)));
}
$user->setKeycloakId($data['keycloak_id'])
    ->setUsername($data['username'])
    ->setEmail($data['email'])
    ->setFirstName('Organizer')
    ->setLastName('VKS')
    ->setGroups(['/vks-organizers', '/vks-administrators'])
    ->setTimeZone('Europe/Moscow')
    ->setIndexer(strtolower($data['email'] . ' ' . $data['username']));
if (method_exists($user, 'setRoles')) {
    $user->setRoles(['ROLE_ADMIN']);
}
$em->persist($user);
$em->flush();

$server = $em->getRepository(Server::class)->findOneBy(['url' => 'vks.mvpspace.ru']);
if (!$server) {
    $server = new Server();
}
$server->setServerName('VKS Forum')
    ->setUrl('vks.mvpspace.ru')
    ->setSlug('vks-mvpspace-ru')
    ->setAppId($data['jwt_app_id'])
    ->setAppSecret($data['jwt_secret'])
    ->setLiveKitServer(false)
    ->setJwtModeratorPosition(1)
    ->setAdministrator($user)
    ->addUser($user);
$em->persist($server);
$em->flush();

$group = $em->getRepository(KeycloakGroupsToServers::class)->findOneBy([
    'keycloakGroup' => '/vks-organizers', 'server' => $server,
]);
if (!$group) {
    $group = (new KeycloakGroupsToServers())
        ->setKeycloakGroup('/vks-organizers')
        ->setServer($server);
    $em->persist($group);
    $em->flush();
}

echo json_encode([
    'owner_id' => $user->getId(),
    'server_id' => $server->getId(),
    'staff_group_mapping_id' => $group->getId(),
    'livekit' => $server->isLiveKitServer(),
    'moderator_claim_position' => $server->getJwtModeratorPosition(),
], JSON_THROW_ON_ERROR) . PHP_EOL;
