# Jitsi Admin на vks.mvpspace.ru

Задача: [PROJ-213](https://roadmap.astforum.ru/work_packages/213). Установка выполнена на существующем VPS `31.128.45.109`, отдельно от остальных Compose-проектов.

## Вход и работа

- Панель встреч: **https://vks.mvpspace.ru/admin**.
- Пользователи: **https://vks.mvpspace.ru/admin/auth/admin/vks/console/#/vks/users**.
- Основной логин: `organizer`. Сохранён прежний пароль организатора Jitsi. Он не хранится в Git.
- Локальная защищённая копия доступа: `~/.config/astforum/jitsi-admin-20261019/user-access.private.json`, права `0600`.

Чтобы создать встречу, войдите в панель, нажмите **Запланировать**, задайте название, дату/время либо постоянную комнату и сохраните. Кнопка **Запустить** открывает встречу с правами организатора. Часовой пояс — `Europe/Moscow`. Перевод upstream неполный; отмеченные владельцем строки дополнены локальным каталогом.

Каталоги `translations/messages+intl-icu.ru.xlf` и `translations/form.ru.yml` подключены read-only к приложению и worker через штатный каталог `translations/custom`. Они дополняют надписи кабинета, заголовки формы создания/редактирования конференции, её поля, варианты продолжительности и все подсказки, включая E2EE и дополнительные параметры. Значения статусов, параметры встреч и действия кнопок не меняются. После правки выполните `php bin/console lint:xliff translations/custom/messages+intl-icu.ru.xlf` и `php bin/console lint:yaml translations/custom/form.ru.yml`, затем `php bin/console cache:clear --env=prod --no-debug` в app и worker и перезапустите app/worker. При первом добавлении bind mount выполните `docker compose up -d --no-deps --wait app worker`, чтобы пересоздать эти контейнеры.

Чтобы добавить сотрудника, откройте **Пользователи → Добавить пользователя** в Keycloak, заполните уникальные имя пользователя, email, имя и фамилию. Новые пользователи получают группу `/vks-organizers` по умолчанию; дополнительно выдавать права администратора им не нужно. После создания задайте временный пароль во вкладке **Учётные данные / Credentials**; при первом входе пользователь меняет его сам. Саморегистрация закрыта. Группу `/vks-administrators` и роли `realm-management` выдавайте только администраторам.

Для отключения сотрудника выключите **Enabled** и завершите его сессии в Keycloak. Активная личность проверяется через userinfo с кэшем максимум 30 секунд: после его истечения новые действия уже открытого кабинета блокируются. Проверяются subject и точная группа организаторов; недоступность IdP даёт 503. Это не отключает уже идущий звонок и не отзывает ранее выданные JWT мгновенно: токен панели действует один час. При экстренном отзыве всех таких ссылок требуется согласованная смена ключа в Jitsi и базе панели.

Ссылки Cal.diy вида `https://vks.mvpspace.ru/<uuid>` сохраняются. Гость открывает прежнюю ссылку; организатор использует предложенный Jitsi вход ведущего либо `https://vks.mvpspace.ru/admin/host?room=<uuid>`. Эта точка проверяет подписанную личность Keycloak и точную группу организаторов, затем выдаёт JWT на одну комнату на 120 секунд.

## Состав и ограничения

Пять сервисов в `/opt/jitsi-admin`: приложение, один CLI worker, WebSocket, MariaDB и Keycloak. Итого ограничения памяти — 1504 MiB. Наружу опубликован только существующий nginx/TLS; новые порты `18080`, `18090`, `18091` слушают `127.0.0.1`.

Версии и неизменяемые digest находятся в `compose.yaml`: Jitsi Admin core/websocket **1.5.20**, Keycloak **26.8.1**, MariaDB **11.4**. Образы получены из официальных реестров; сборка на VPS не нужна.

Приглашения по email **не отправляются**: `MAILER_DSN=null://null`, `DISALLOW_ALL_EMAILS=1`. Получение писем и реальная передача звука/видео не проверялись. Можно создавать встречи и передавать участникам ссылки вручную. Конфигурация не является оценкой допустимого числа участников на VPS с 4 GiB RAM.

## Адаптеры установленной версии

- `/admin` и `/admin/` ведут в кабинет. Keycloak занимает `/admin/auth/`.
- Upstream зашивает `/build/` и `/ws/` в собранные ресурсы. Для них выделены узкие маршруты nginx; Jitsi использует другие пространства `/libs`, `/css`, `/xmpp-websocket`. `/build/` допускает только чтение.
- Symfony доверяет только локальному reverse proxy, проверяет hostname и использует cookie `VKSADMINSESSID` с путём `/admin`, Secure, HttpOnly, SameSite=Lax.
- Используется штатный **confidential-client authorization-code flow со state**. Встроенный клиент этой версии не реализует PKCE; собственный callback не добавлен. `/host` проверяет RS256 ID token по JWKS, issuer, audience, subject и expiry; просроченная личность требует повторного входа. Клиент `vks-host` не нужен и удалён.
- `ForumStaffSessionGuard` сохраняет access token после штатного callback только в серверной сессии и проверяет userinfo перед действиями сотрудников. Отозванная личность очищает локальный сеанс; публичные приглашения участников остаются доступны.
- `ForumRoomService` декорирует upstream-сервис: токены панели получают `iat`, `nbf`, `exp` с TTL 3600 секунд, вместо бессрочных токенов vendor.
- `prepare_prosody.py` принимает только исходники двух модулей с проверенными SHA256. Патч ограничивает ведущих проверенными moderator-claims, предотвращает обход ожидания через affiliation и убирает JWT/секреты из сообщений модуля проверки. `forum_persistent_lobby` загружает зависимость только на основном virtual host.
- Основной XMPP realm требует JWT (`JWT_ALLOW_EMPTY=0`), гостевой остаётся анонимным. Автоматическая выдача owner выключена. Внешний hostname отличается от внутреннего `meet.jitsi`, поэтому проверка JWT sub относительно внутреннего домена выключена; issuer, audience, подпись и точная комната проверяются.
- Незапрошенная vendor-телеметрия `stats.jitsi-admin.de` направлена в loopback приложения/worker. При обновлении нужно проверить адреса телеметрии и адаптеры заново.
- Access log внешнего vks nginx пишет `$uri` без query/referrer; access log внутреннего nginx панели выключен. Не включайте отладочное логирование токенов.

## Файлы и обслуживание

На VPS `/opt/jitsi-admin/secrets` имеет права `0700`. Там находятся `app.env`, `database.env`, `keycloak.env`, `websocket.env`, `vks-realm.json`, `10-apps.sql`, `bootstrap-app.json` и `access.private.json`. Это секретные операционные файлы, в Git они исключены. JSON realm импортируется только при первой инициализации базы; последующие изменения применяются через Admin API. `realm.example.json` показывает политику без пользователей и реального client secret.

В `app.env` согласованы URL базы, OIDC realm/client/secret, базовый URL панели и генерируемые секреты приложения/очереди/WebSocket. Обе базы используют отдельные DB accounts. Общий секрет Jitsi должен совпадать в `.env` Jitsi и записи сервера панели. Не запускайте публичный пример `jitsi.env.example` как готовый env: секрет подставляет `connect_jitsi.py` из защищённого файла.

После копирования изменённых конфигураций:

```sh
cd /opt/jitsi-admin
docker compose config --quiet
nginx -t
systemctl reload nginx
docker compose up -d --wait --wait-timeout 150 app worker
```

После изменения PHP-адаптеров требуется `docker compose restart app worker`: production OPcache не проверяет изменение файлов. Один `cache:clear` не обновляет уже запущенный PHP-FPM.

`bootstrap-app.php` идемпотентно создаёт владельца, сервер и соответствие группы. Для повторного запуска скопируйте PHP и приватный JSON в `/tmp` контейнера, выполните PHP, затем удалите обе временные копии через `docker compose exec -T --user 0 app rm -f ...` (файлы `docker cp` принадлежат root).

`configure_identity.py` повторно применяет точные локализованные callbacks, закрытую регистрацию и русский язык, используя защищённые реквизиты. Не удаляет пользователей. `connect_jitsi.py` проверяет отсутствие конференций, создаёт новый архив, готовит модули и применяет настройки только к Prosody/Jicofo/web. JVB не пересоздаётся. При ошибке остановитесь и проверьте состояние; не запускайте откат во время чужого звонка.

Проверки:

```sh
# Локально из репозитория:
python3 scripts/deployment/jitsi-admin/check_http.py
# На VPS (одноразовые комнаты/сессии закрываются автоматически):
python3 /opt/jitsi-admin/verify_signaling.py
cd /opt/jitsi-admin
docker compose ps
```

Чистые unit-тесты `test_host_link.php` запускаются в pinned core image с vendor autoload, без сети и с read-only mounts теста и `ForumHostLink.php` в `/work/`. Передавайте `php /work/test_host_link.php` как command, сохраняя entrypoint образа: он подставляет PHP ini; `--entrypoint php` оставляет ini-шаблоны необработанными.

## Резервная копия и откат

Первоначальный каталог: `/root/jitsi-admin-backups/20261019T144058Z`, права `0700`, архивы `0600`.

- `before.tar.gz`: исходные `/opt/jitsi-meet` и vks nginx site.
- `prosody-state.tar.gz`: реальные bind mounts конфигурации и storage Prosody.
- `cutover-20261019T152912Z.tar.gz`: снимок перед последним применением JWT, включая web-конфигурацию.
- `portal-before-key-rotation.sql.gz`: приватный дамп баз панели и Keycloak перед отзывом тестового ключа.

Для возврата к исходной native authentication сначала убедитесь, что активных звонков нет, остановите **только** `jitsi-admin` (`docker compose stop` без удаления volumes), извлеките `before.tar.gz` в `/`, удалите добавленные этой задачей `mod_muc_wait_for_host.lua`, `mod_token_verification.lua`, `mod_forum_persistent_lobby.lua` из `prosody-plugins-custom` и блок `// PROJ-213 host login` из web `custom-config.js`. Исходный nginx site исключит `/admin`. Выполните `nginx -t`, затем reload nginx и `docker compose up -d --no-deps prosody jicofo web` из `/opt/jitsi-meet`. Проверьте прежний organizer login, гостя до/после ведущего и JVB health. Старые Prosody accounts сохранены; восстанавливать data archive поверх актуальных данных без необходимости не следует.

Базы нового проекта и его секреты сохраняйте до подтверждения отката. Для дальнейших backups выгружайте **обе** MariaDB базы в защищённый каталог, сохраняйте uploads/theme volumes и private env/realm. Не используйте `docker compose down -v` для отката.

Источники: [Jitsi Admin 1.5.20](https://github.com/H2-invent/jitsi-admin/releases/tag/1.5.20), [docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet), [Keycloak containers](https://www.keycloak.org/server/containers).

## План и результаты проверки

[Технический план](../../docs/plans/2026-10-19-jitsi-admin.md), [проектирование установки](../../docs/plans/2026-10-19-jitsi-admin-design.md), [отчёт установки в Outline](https://docs.astforum.ru/doc/jitsi-admin-ustanovka-i-proverka-dostupa-2026-10-19-4KQW2uHg5s). Оригинал отчёта сохранён вложением и проверен повторным скачиванием по SHA-256; подтверждение — `artifacts/repository-audits/jitsi-document-migration.json`.

[Проверка русского интерфейса в Outline](https://docs.astforum.ru/doc/jitsi-admin-russkij-interfejs-i-proverka-perevoda-2026-10-22-6il9O3oG8q); оригинал также сохранён вложением с подтверждённым SHA-256.
