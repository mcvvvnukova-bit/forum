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

## Проверенная публикация 05.10.2026

Применён override из коммита `8026178601a36f4385314b853aa3b13a5764aa67`:
`/opt/forum-api/sber-dns.override.yaml`, SHA256
`c554835f1a99b6e76dd7ce4752db3c1bc1e0720d98419c4a857a96aafffa4ee5`.
Backup: `/opt/forum-api/backups/dns-20261005T173858Z`.
Пересоздан только `forum-api-forum_api-1`, health — healthy.
Resolved Compose до и после отличается только `forum_api.dns`.
Образ остался `astforum/forum-api:20261001-sber-dns` с прежним image ID.
Значения переменных среды совпали с объединением defaults этого образа и
неизменённого base Compose. Сравнение выполняется по ключам и значениям:
порядок массива `Config.Env` при пересоздании изменился и не является
доказательством изменения переменных. 19 остальных контейнеров сохранили ID,
31 защищённый production / auth / gateway / Caddy / Compose файл — SHA256.

Тот же транспортный тест после исправления прошёл: DNS разрешается,
ответ API 400 на диагностический запрос, сертификат проверен, TLS 1.3.
В IAB выполнен настоящий вход через существующую сессию Сбер ID.
На `/login` после reload видно «Вы уже вошли в аккаунт», alert отсутствует.
БД `forum_sber_sandbox` содержит прежнего одного пользователя и одну внешнюю
идентичность; событие `UserAuthenticated` записано 05.10 в 17:42:36.716 UTC.
Это подтверждает повторный вход в существующий аккаунт.

Безопасные доказательства: `../public-auth/evidence/sber-dns/` —
RED/GREEN транспортного теста, server-verification.json, browser-proof.json,
auth-audit.json и login-success.jpg. OAuth-коды, cookie, токены и персональные
данные в эти файлы не сохраняются.
