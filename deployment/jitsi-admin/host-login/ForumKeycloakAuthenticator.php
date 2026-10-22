<?php
declare(strict_types=1);

namespace App\Security;

use KnpU\OAuth2ClientBundle\Client\OAuth2ClientInterface;
use League\OAuth2\Client\Token\AccessTokenInterface;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;

// Preserve the pinned vendor callback, including its OAuth state and user-mapping checks.
#[AsDecorator(decorates: KeycloakAuthenticator::class)]
final class ForumKeycloakAuthenticator extends KeycloakAuthenticator
{
    private ?AccessTokenInterface $issued = null;

    protected function fetchAccessToken(OAuth2ClientInterface $client, array $options = [])
    {
        return $this->issued = parent::fetchAccessToken($client, $options);
    }

    public function authenticate(Request $request): Passport
    {
        $this->issued = null;
        try {
            $passport = parent::authenticate($request);
            $passport->setAttribute('forum_refresh_token', $this->issued?->getRefreshToken());
            return $passport;
        } finally {
            $this->issued = null;
        }
    }
}
