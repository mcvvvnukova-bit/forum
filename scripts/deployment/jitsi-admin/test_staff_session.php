<?php
declare(strict_types=1);
require '/var/www/html/vendor/autoload.php';
$implementation = '/work/ForumStaffSessionGuard.php';
if (!is_file($implementation)) { fwrite(STDERR, "FAIL: existing staff sessions have no identity revocation guard\n"); exit(1); }
require $implementation;

use App\Entity\User;
use App\Security\KeycloakAuthenticator;
use App\EventSubscriber\ForumStaffSessionGuard;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorage;
use Symfony\Component\Security\Core\Authentication\Token\UsernamePasswordToken;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\Event\LoginSuccessEvent;

function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function fixture(array $responses, bool $staff = true, bool $credential = true): array {
    $user = (new User())->setKeycloakId('qa-user')->setEmail('qa@example.invalid');
    $tokens = new TokenStorage();
    if ($staff) $tokens->setToken(new UsernamePasswordToken($user, 'main', ['ROLE_USER']));
    $routes = new RouteCollection(); $routes->add('login_keycloak', new Route('/admin/login'));
    $router = new UrlGenerator($routes, new RequestContext());
    $http = new MockHttpClient($responses);
    $cache = new ArrayAdapter();
    $guard = new ForumStaffSessionGuard($tokens, $router, $http, $cache);
    $request = Request::create('/admin/room/join/a/1');
    $session = new Session(new MockArraySessionStorage());
    if ($credential) $session->set('forum_oauth_access_token', 'test-only-access-token');
    $request->setSession($session);
    $kernel = new class implements HttpKernelInterface {
        public function handle(Request $request, int $type = self::MAIN_REQUEST, bool $catch = true): Response { return new Response(); }
    };
    $event = new ControllerEvent($kernel, static fn() => new Response('original action'), $request, HttpKernelInterface::MAIN_REQUEST);
    return [$guard, $event, $request, $tokens, $http, $cache];
}
$valid = ['sub' => 'qa-user', 'groups' => ['/vks-organizers']];
$tests = [];
$tests['successful vendor callback retains access token in the server session'] = static function () {
    [$g,$e,$r,$tokens] = fixture([], true, false);
    $authenticator = (new ReflectionClass(KeycloakAuthenticator::class))->newInstanceWithoutConstructor();
    $passport = new SelfValidatingPassport(new UserBadge('issued-opaque-access-token'));
    $event = new LoginSuccessEvent($authenticator, $passport, $tokens->getToken(), $r, null, 'main');
    $g->onLogin($event);
    check($r->getSession()->get('forum_oauth_access_token') === 'issued-opaque-access-token', 'Callback did not retain the access credential');
};
$tests['active staff session can execute its original action'] = static function () use ($valid) {
    [$g,$e] = fixture([new MockResponse(json_encode($valid))]); $g->onController($e);
    check(($e->getController())()->getContent() === 'original action', 'Active staff was blocked');
};
$tests['disabled identity invalidates an existing portal cookie before token issuance'] = static function () {
    [$g,$e,$r,$tokens] = fixture([new MockResponse('', ['http_code' => 401])]); $g->onController($e);
    $response = ($e->getController())();
    check($response->getStatusCode() === 302 && $response->headers->get('Location') === '/admin/login', 'Disabled session reached its original action');
    check($tokens->getToken() === null && !$r->getSession()->has('forum_oauth_access_token'), 'Local authentication survived revocation');
};
$tests['stale legacy portal session requires a new identity login'] = static function () {
    [$g,$e] = fixture([], true, false); $g->onController($e);
    check(($e->getController())()->getStatusCode() === 302, 'Legacy session bypassed revalidation');
};
$tests['an identity from another subject cannot authorize local staff'] = static function () {
    [$g,$e] = fixture([new MockResponse(json_encode(['sub'=>'other-user','groups'=>['/vks-organizers']]))]); $g->onController($e);
    check(($e->getController())()->getStatusCode() === 302, 'Subject mismatch accepted');
};
$tests['removed organizer membership cannot issue meeting tokens'] = static function () {
    [$g,$e] = fixture([new MockResponse(json_encode(['sub'=>'qa-user','groups'=>['/vks-organizers-extra']]))]); $g->onController($e);
    check(($e->getController())()->getStatusCode() === 403, 'Substring group accepted');
};
$tests['identity-provider failure fails closed without logging out an active user'] = static function () {
    [$g,$e,$r,$tokens] = fixture([new MockResponse('', ['http_code'=>503])]); $g->onController($e);
    check(($e->getController())()->getStatusCode() === 503 && $tokens->getToken() !== null, 'Provider outage bypassed guard or destroyed valid session');
};
$tests['anonymous participant invitation flow remains public'] = static function () {
    [$g,$e,$r,$tokens,$http] = fixture([], false, false); $g->onController($e);
    check(($e->getController())()->getContent() === 'original action' && $http->getRequestsCount() === 0, 'Guest flow was forced into staff authentication');
};
$tests['cached identity is revalidated and rejected after cache expiration'] = static function () use ($valid) {
    [$g,$e,$r,$tokens,$http,$cache] = fixture([new MockResponse(json_encode($valid)),new MockResponse('', ['http_code'=>401])]);
    $g->onController($e); $g->onController($e);
    check($http->getRequestsCount() === 1, 'Each action unnecessarily queried Keycloak');
    $cache->clear(); $g->onController($e);
    check($http->getRequestsCount() === 2 && ($e->getController())()->getStatusCode() === 302, 'Cached identity was never revalidated');
};
$failed=0;
foreach($tests as $name=>$test) { try { $test(); echo "PASS: $name\n"; } catch(Throwable $e) { $failed++; fwrite(STDERR,"FAIL: $name: ".$e->getMessage()."\n"); } }
echo count($tests)." tests, $failed failures\n";
exit($failed ? 1 : 0);
