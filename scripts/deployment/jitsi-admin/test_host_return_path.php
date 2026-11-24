<?php
declare(strict_types=1);

require '/var/www/html/vendor/autoload.php';
require $argv[1] ?? '/var/www/html/src/Controller/ForumHostController.php';
require $argv[2] ?? '/var/www/html/src/Service/ForumHostLink.php';

use App\Controller\ForumHostController;
use App\Entity\User;
use Doctrine\ORM\EntityManager;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorage;
use Symfony\Component\Security\Core\Authentication\Token\UsernamePasswordToken;

Request::setTrustedProxies(['127.0.0.1'], Request::HEADER_X_FORWARDED_PREFIX);
$room = '0b23ab34-4d56-4f78-9123-456789abcdef';
$routes = new RouteCollection();
$routes->add('forum_host', new Route('/host'));
$routes->add('login_keycloak', new Route('/login/keycloak_login'));
$em = (new ReflectionClass(EntityManager::class))->newInstanceWithoutConstructor();
$user = (new User())->setKeycloakId('qa-organizer');
$failures = [];

foreach (['fresh session' => null, 'invalid identity token' => $user] as $scenario => $signedInUser) {
    $request = Request::create('/host?room=' . $room, 'GET', server: [
        'REMOTE_ADDR' => '127.0.0.1',
        'HTTP_X_FORWARDED_PREFIX' => '/admin',
    ]);
    $session = new Session(new MockArraySessionStorage());
    $request->setSession($session);
    $tokens = new TokenStorage();
    if ($signedInUser !== null) {
        $tokens->setToken(new UsernamePasswordToken($signedInUser, 'main'));
        $session->set('id_token', 'invalid-token');
    }

    $container = new Container();
    $container->set('router', new UrlGenerator($routes, (new RequestContext())->fromRequest($request)));
    $container->set('security.token_storage', $tokens);
    $controller = new ForumHostController();
    $controller->setContainer($container);

    $http = new MockHttpClient(new MockResponse('{"keys":[]}'));
    $response = $controller->launch($request, $em, $http);
    $target = $session->get('_security.main.target_path');
    if ($target !== '/admin/host?room=' . $room) {
        $failures[] = "$scenario returned to $target";
    }
    if ($response->getStatusCode() !== 302 || $response->headers->get('Location') !== '/admin/login/keycloak_login') {
        $failures[] = "$scenario did not redirect to Keycloak login";
    }
}

if ($failures !== []) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo "PASS: first login and identity renewal retain the public host route and room\n";
