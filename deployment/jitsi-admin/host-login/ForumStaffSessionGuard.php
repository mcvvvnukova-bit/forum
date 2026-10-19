<?php
declare(strict_types=1);

namespace App\EventSubscriber;

use App\Entity\User;
use App\Security\KeycloakAuthenticator;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Event\LoginSuccessEvent;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\Exception\HttpExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

#[AsEventListener(event: LoginSuccessEvent::class, method: 'onLogin')]
#[AsEventListener(event: KernelEvents::CONTROLLER, method: 'onController')]
final class ForumStaffSessionGuard
{
    public function __construct(
        private TokenStorageInterface $tokens,
        private UrlGeneratorInterface $router,
        private HttpClientInterface $http,
        private CacheInterface $cache,
    ) {}

    public function onLogin(LoginSuccessEvent $event): void
    {
        if (!$event->getAuthenticator() instanceof KeycloakAuthenticator) return;
        // Pinned vendor authenticator uses the access token as its UserBadge ID.
        $badge = $event->getPassport()->getBadge(UserBadge::class);
        if ($badge instanceof UserBadge) {
            $event->getRequest()->getSession()->set('forum_oauth_access_token', $badge->getUserIdentifier());
        }
    }

    public function onController(ControllerEvent $event): void
    {
        if (!$event->isMainRequest()) return;
        $user = $this->tokens->getToken()?->getUser();
        if (!$user instanceof User) return; // Public participant invitation flows.
        $request = $event->getRequest();
        $route = (string) $request->attributes->get('_route');
        foreach (['logout_keycloak', 'login_keycloak', 'connect_keycloak_check'] as $exempt) {
            if (str_ends_with($route, $exempt)) return;
        }
        $session = $request->getSession();
        $credential = $session->get('forum_oauth_access_token');
        $identity = null;
        if (is_string($credential) && $credential !== '') {
            try {
                $identity = $this->cache->get('forum_staff_' . hash('sha256', $credential), function (ItemInterface $item) use ($credential): array {
                    $item->expiresAfter(30);
                    return $this->http->request('GET', 'https://vks.mvpspace.ru/admin/auth/realms/vks/protocol/openid-connect/userinfo', [
                        'auth_bearer' => $credential, 'timeout' => 5,
                    ])->toArray();
                });
            } catch (HttpExceptionInterface $error) {
                if (!in_array($error->getResponse()->getStatusCode(), [401, 403], true)) {
                    $event->setController(static fn() => new Response('Identity provider temporarily unavailable', 503, ['Cache-Control'=>'no-store']));
                    return;
                }
            } catch (\Throwable $error) {
                $event->setController(static fn() => new Response('Identity provider temporarily unavailable', 503, ['Cache-Control'=>'no-store']));
                return;
            }
        }
        if (!is_array($identity) || ($identity['sub'] ?? null) !== $user->getKeycloakId()) {
            $this->tokens->setToken(null);
            $session->invalidate();
            $session->set('_security.main.target_path', $request->getRequestUri());
            $url = $this->router->generate('login_keycloak');
            $event->setController(static fn() => new RedirectResponse($url, 302, ['Cache-Control'=>'no-store']));
            return;
        }
        if (!in_array('/vks-organizers', (array) ($identity['groups'] ?? []), true)) {
            $event->setController(static fn() => new Response('Organizer membership is required', 403, ['Cache-Control'=>'no-store']));
        }
    }
}
