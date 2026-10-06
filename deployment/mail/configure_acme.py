"""Historical native ACME experiment; not used by the deployed certificate lifecycle.

The deployment uses Certbot and deploy-certificate.py. Do not run this script
against the live deployment: the HTTP-01 route belongs to Certbot's webroot.
"""
import sys
from stalwart_api import call, save_private


def main(environment):
    directories = {
        'staging': 'https://acme-staging-v02.api.letsencrypt.org/directory',
        'production': 'https://acme-v02.api.letsencrypt.org/directory',
    }
    directory = directories[environment]
    domains = call('x:Domain/get', {'ids': ['b']})['list']
    assert len(domains) == 1 and domains[0]['name'] == 'astforum.ru'
    save_private('certificate-management-before-' + environment + '.private.json',
                 domains[0]['certificateManagement'])
    providers = call('x:AcmeProvider/get', {
        'properties': ['id', 'directory', 'challengeType'],
    })['list']
    matching = [p for p in providers if p['directory'] == directory
                and p['challengeType'] == 'Http01']
    if matching:
        provider_id = matching[0]['id']
    else:
        result = call('x:AcmeProvider/set', {'create': {'mail': {
            'directory': directory, 'challengeType': 'Http01',
            'contact': {'postmaster@astforum.ru': True}, 'maxRetries': 3,
        }}})
        save_private('acme-provider-' + environment + '.private.json', result)
        provider_id = result['created']['mail']['id']
    call('x:Domain/set', {'update': {'b': {'certificateManagement': {
        '@type': 'Automatic', 'acmeProviderId': provider_id,
        'subjectAlternativeNames': {'mail': True},
    }}}})
    print(f'Native ACME {environment} configured for mail.astforum.ru (provider {provider_id})')


if __name__ == '__main__':
    raise SystemExit('Native ACME experiment retired. Use Certbot and deploy-certificate.py.')
