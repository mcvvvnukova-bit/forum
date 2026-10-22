<?php
declare(strict_types=1);

namespace App\Controller;

use App\Entity\Server;
use App\Entity\User;
use App\Service\ForumHostLink;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class ForumHostController extends AbstractController
{
    #[Route(path: '/host', name: 'forum_host', methods: ['GET'])]
    public function launch(Request $request, EntityManagerInterface $em, HttpClientInterface $http): Response
    {
        $headers = ['Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer'];
        $user = $this->getUser();
        $session = $request->getSession();
        if (!$user instanceof User || !$session->get('id_token')) {
            $session->set('_security.main.target_path', $request->getRequestUri());
            $response = $this->redirectToRoute('login_keycloak');
            $response->headers->add($headers);
            return $response;
        }
        try {
            $jwks = $http->request('GET', 'https://vks.mvpspace.ru/admin/auth/realms/vks/protocol/openid-connect/certs', ['timeout' => 5])->toArray();
            $identity = ForumHostLink::validateIdentity($session->get('id_token'), $jwks, (string) $user->getKeycloakId(), time());
        } catch (\UnexpectedValueException $error) {
            $session->set('_security.main.target_path', $request->getRequestUri());
            $response = $this->redirectToRoute('login_keycloak');
            $response->headers->add($headers);
            return $response;
        } catch (\Throwable $error) {
            return new Response('Identity provider temporarily unavailable', 503, $headers);
        }
        $server = $em->getRepository(Server::class)->findOneBy(['url' => 'vks.mvpspace.ru']);
        if (!$server) {
            return new Response('Meeting server is not configured', 503, $headers);
        }
        try {
            $url = ForumHostLink::create($identity, $request->query->getString('room'), (string) $server->getAppId(), (string) $server->getAppSecret(), time());
            return new \Symfony\Component\HttpFoundation\RedirectResponse($url, 302, $headers);
        } catch (\DomainException $error) {
            return new Response('Organizer membership is required', 403, $headers);
        } catch (\InvalidArgumentException $error) {
            return new Response('Invalid meeting name', 400, $headers);
        } catch (\UnexpectedValueException $error) {
            return new Response('Meeting server is not configured', 503, $headers);
        }
    }
}
