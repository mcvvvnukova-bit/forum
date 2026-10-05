# PROJ-31: восстановление DNS Сбер ID на dev

05.10.2026 API возвращал `provider_unavailable`. Callback и state прошли проверку,
но системный DNS контейнера возвращал `EAI_AGAIN` для `oauth-sb.sber.ru`.
В `/etc/resolv.conf` контейнера было `NO EXTERNAL NAMESERVERS DEFINED`.
Контейнер стартовал 03.10 в 20:40:25 UTC; файл DNS VPS обновился в 20:40:30 UTC.
Это согласуется со стартом API до заполнения DNS хоста. Сам VPS и прямой запрос
из контейнера к его резолверу `172.16.160.1` разрешают имя успешно.

Override применяется только к `forum_api`. Он задаёт DNS-сервер VPS, сохраняет
embedded DNS Docker для внутренних имён, HTTPS hostname и проверку TLS.
Адрес Сбера не фиксируется. Образ, переменные среды, сертификаты, БД, сети,
dev-шлюз и конфигурация Caddy не меняются.

Требуется существующая публикация `/opt/forum-api/releases/20261001-sber-dns`.
Образ `astforum/forum-api:20261001-sber-dns` и runtime/secrets этой публикации
уже находятся на VPS; этот override не собирает и не заменяет backend.

Перед применением сравнить resolved Compose: допустимо только добавление `dns`
к сервису `forum_api`. Сохранить base Compose, image/environment fingerprint,
ID остальных контейнеров и защищённые файлы в `/opt/forum-api/backups/dns-*`.

```sh
sudo docker compose --project-name forum-api \
  --project-directory /opt/forum-api/releases/20261001-sber-dns/deployment/forum-api \
  -f /opt/forum-api/releases/20261001-sber-dns/deployment/forum-api/compose.yaml \
  -f /opt/forum-api/sber-dns.override.yaml \
  up -d --no-build --no-deps --wait --wait-timeout 60 forum_api

sudo docker exec -i forum-api-forum_api-1 node --input-type=module \
  < test-sber-transport.mjs
```

Указанный тест был запущен до исправления и упал с `EAI_AGAIN`. Он проверяет
обычный DNS контейнера и HTTPS GET без OAuth-кода и Client Secret: корректный
ответ 400 на запрос без параметров подтверждает достижимость API и strict mTLS.
Тест не создаёт аккаунт или сессию. Полный вход проверяется отдельно в IAB.

При дальнейших операциях Compose включать этот override. Перезапуск VPS
сохраняет явный DNS в конфигурации контейнера. Если резолвер VPS изменится,
сначала проверить новый адрес и обновить override.

Откат: выполнить ту же команду Compose без `-f /opt/forum-api/sber-dns.override.yaml`.
Это восстановит прежнюю конфигурацию сервиса; overlay и backup можно сохранить.
Другие сервисы и данные не удаляются.
