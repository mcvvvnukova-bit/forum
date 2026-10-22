<?php
declare(strict_types=1);
require '/var/www/html/vendor/autoload.php';
$implementation = '/work/ForumStaffSessionGuard.php';
if (!is_file($implementation)) { fwrite(STDERR, "FAIL: existing staff sessions have no identity revocation guard\n"); exit(1); }
require $implementation;
if (is_file('/work/ForumKeycloakAuthenticator.php')) require '/work/ForumKeycloakAuthenticator.php';

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
function oauthFixture(array $responses, ?Request $request = null): array {
    $stack = new \Symfony\Component\HttpFoundation\RequestStack();
    if ($request) $stack->push($request);
    $provider = new \League\OAuth2\Client\Provider\GenericProvider([
        'clientId'=>'fixture-client', 'clientSecret'=>'fixture-secret',
        'urlAuthorize'=>'https://idp.example/authorize', 'urlAccessToken'=>'https://idp.example/token',
        'urlResourceOwnerDetails'=>'https://idp.example/userinfo',
    ], ['httpClient'=>new \GuzzleHttp\Client(['handler'=>new \GuzzleHttp\Handler\MockHandler($responses)])]);
    $client = new \KnpU\OAuth2ClientBundle\Client\OAuth2Client($provider, $stack);
    $container = new \Symfony\Component\DependencyInjection\Container();
    $container->set('fixture-client', $client);
    return [new \KnpU\OAuth2ClientBundle\Client\ClientRegistry($container, ['keycloak_main'=>'fixture-client']), $client, $stack];
}
function fixture(array $responses, bool $staff = true, bool $credential = true, array $refreshResponses = []): array {
    $user = (new User())->setKeycloakId('qa-user')->setEmail('qa@example.invalid');
    $tokens = new TokenStorage();
    if ($staff) $tokens->setToken(new UsernamePasswordToken($user, 'main', ['ROLE_USER']));
    $routes = new RouteCollection(); $routes->add('login_keycloak', new Route('/admin/login'));
    $router = new UrlGenerator($routes, new RequestContext());
    $http = new MockHttpClient($responses);
    $cache = new ArrayAdapter();
    $guard = new ForumStaffSessionGuard($tokens, $router, $http, $cache, oauthFixture($refreshResponses)[0]);
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
$tests['expired access token is refreshed without losing a conference POST'] = static function () use ($valid) {
    [$g,$e,$r,$tokens] = fixture([
        new MockResponse('', ['http_code'=>401]),
        new MockResponse(json_encode($valid)),
    ], true, true, [new \GuzzleHttp\Psr7\Response(200, ['Content-Type'=>'application/json'], json_encode(['access_token'=>'new-access', 'refresh_token'=>'rotated-refresh', 'expires_in'=>300, 'id_token'=>'new-id-token']))]);
    $r->setMethod('POST');
    $r->request->set('conference_name', 'Unsaved draft');
    $r->getSession()->set('forum_oauth_refresh_token', 'valid-refresh-token');
    $g->onController($e);
    check(($e->getController())()->getContent() === 'original action', 'Access expiry discarded the original POST');
    check($r->request->get('conference_name') === 'Unsaved draft', 'Conference form values were lost');
    check($r->getSession()->get('forum_oauth_access_token') === 'new-access', 'New access token was not retained');
    check($r->getSession()->get('forum_oauth_refresh_token') === 'rotated-refresh', 'Rotated refresh token was lost');
    check($r->getSession()->get('id_token') === 'new-id-token', 'Host bridge retained the expired ID token');
};
foreach (['revoked'=>400, 'provider-outage'=>503] as $case=>$status) {
    $tests['refresh '.$case.' fails closed'] = static function () use ($case,$status) {
        [$g,$e,$r,$tokens] = fixture([new MockResponse('', ['http_code'=>401])], true, true, [
            new \GuzzleHttp\Psr7\Response($status, ['Content-Type'=>'application/json'], json_encode(['error'=>$case==='revoked'?'invalid_grant':'temporarily_unavailable']))
        ]);
        $r->getSession()->set('forum_oauth_refresh_token','old-refresh');
        $g->onController($e);
        check(($e->getController())()->getStatusCode() === ($case==='revoked'?302:503), 'Refresh failure classification is wrong');
        check(($tokens->getToken() === null) === ($case==='revoked'), 'Provider outage was treated as account revocation');
    };
}
$tests['refreshed credentials still require the original subject and organizer group'] = static function () {
    foreach ([['sub'=>'other','groups'=>['/vks-organizers']], ['sub'=>'qa-user','groups'=>[]]] as $identity) {
        [$g,$e,$r] = fixture([new MockResponse('', ['http_code'=>401]), new MockResponse(json_encode($identity))], true, true, [
            new \GuzzleHttp\Psr7\Response(200, [], json_encode(['access_token'=>'new-access','refresh_token'=>'new-refresh','expires_in'=>300]))
        ]);
        $r->getSession()->set('forum_oauth_refresh_token','old-refresh');
        $g->onController($e);
        check(in_array(($e->getController())()->getStatusCode(), [302,403], true), 'Refresh bypassed staff authorization');
    }
};
$tests['real vendor callback carries the refresh token into the server session'] = static function () {
    [$g,$e,$r,$tokens] = fixture([], true, false);
    $r->query->set('code', 'fixture-code');
    [$registry,$client,$stack] = oauthFixture([new \GuzzleHttp\Psr7\Response(200, [], json_encode([
        'access_token'=>'callback-access', 'refresh_token'=>'callback-refresh', 'id_token'=>'callback-id', 'expires_in'=>300
    ]))], $r);
    $r->query->set('state', 'fixture-state');
    $client->redirect(['openid'], ['state'=>'fixture-state']);
    $auth = (new ReflectionClass(\App\Security\ForumKeycloakAuthenticator::class))->newInstanceWithoutConstructor();
    $routes = new RouteCollection(); $routes->add('connect_keycloak_check',new Route('/admin/login/check'));
    $router = new UrlGenerator($routes,new RequestContext());
    $https = new \App\Service\CreateHttpsUrl(new \Psr\Log\NullLogger(),$stack,new \Symfony\Component\DependencyInjection\ParameterBag\ParameterBag(['laF_baseUrl'=>'https://vks.mvpspace.ru']));
    foreach (['clientRegistry'=>$registry,'urlGenerator'=>$router,'createHttpsUrl'=>$https] as $key=>$value) {
        (new ReflectionProperty(KeycloakAuthenticator::class,$key))->setValue($auth,$value);
    }
    $passport = $auth->authenticate($r);
    $g->onLogin(new LoginSuccessEvent($auth,$passport,$tokens->getToken(),$r,null,'main'));
    check($r->getSession()->get('forum_oauth_refresh_token') === 'callback-refresh', 'Vendor callback dropped the refresh credential');
    check($r->getSession()->get('forum_oauth_access_token') === 'callback-access', 'Vendor access credential was replaced');
};
$tests['rotated refresh token survives a later userinfo outage'] = static function () use ($valid) {
    [$g,$e,$r,$tokens] = fixture([new MockResponse('', ['http_code'=>401]),new MockResponse('', ['http_code'=>503]),new MockResponse(json_encode($valid))], true, true, [
        new \GuzzleHttp\Psr7\Response(200, [], json_encode(['access_token'=>'new-access','refresh_token'=>'new-refresh','expires_in'=>300]))
    ]);
    $r->getSession()->set('forum_oauth_refresh_token','old-refresh');$g->onController($e);
    check(($e->getController())()->getStatusCode()===503 && $tokens->getToken()!==null, 'Userinfo outage destroyed the session');
    check($r->getSession()->get('forum_oauth_refresh_token')==='new-refresh','Rotation was lost after userinfo outage');
};
$failed=0;
foreach($tests as $name=>$test) { try { $test(); echo "PASS: $name\n"; } catch(Throwable $e) { $failed++; fwrite(STDERR,"FAIL: $name: ".$e->getMessage()."\n"); } }
echo count($tests)." tests, $failed failures\n";
exit($failed ? 1 : 0);
