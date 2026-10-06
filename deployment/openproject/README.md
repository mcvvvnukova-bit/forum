# OpenProject АСТ Форум

Адрес установки: https://roadmap.astforum.ru

OpenProject Community 17.8.0 размещён на VPS `forum-prod` в `/opt/openproject`.
Это отдельная установка; данные локального OpenProject с Mac не переносились.

## Публикация

На 18 сентября 2026 года OpenProject установлен и работает на сервере. Проверены русская форма входа, пароль администратора, статические файлы и WebSocket.
Запись `A roadmap → 84.47.165.130` добавлена в REG.RU 18 сентября 2026 года. Её публикация подтверждена на ns1.reg.ru, ns2.reg.ru, Cloudflare DNS и Google DNS.
21 сентября 2026 года подтверждён доступ через публичный HTTPS: сертификат проходит проверку, `/login` отвечает HTTP 200.

| Параметр | Значение |
|---|---|
| DNS | `A roadmap.astforum.ru → 84.47.165.130` |
| HTTPS-шлюз | Отдельный от VM; выпуск сертификата для `roadmap.astforum.ru` |
| Адрес origin | `http://172.16.160.16:80` |
| Host для origin | `roadmap.astforum.ru` |
| WebSocket | Поддержать `/hocuspocus` и HTTP Upgrade |
| HTTP | Перенаправлять на HTTPS |

Новые публичные порты на VM не открываются. Origin Caddy использует существующий порт 80.
Маршрут ограничен маркерами `astforum-openproject:start/end` в `/opt/outline/Caddyfile`.
Готовый пример для внешнего шлюза Caddy находится в `edge-Caddyfile.example`.

## Вход

Логин администратора: `admin`. Начальный пароль случайный, при первом входе требуется его смена.

Пароль хранится на VPS в `/opt/openproject/admin-access.private.txt` с доступом только для root.
Копия для владельца сохранена на Mac в `/Users/vvv/Downloads/OpenProject-roadmap-access.txt` с правами `0600`.

Для просмотра в собственном терминале:

```sh
ssh forum-prod 'sudo cat /opt/openproject/admin-access.private.txt'
```

Язык по умолчанию — русский. Просмотр требует входа. Самостоятельная регистрация отключена; пользователей добавляет администратор.

## Исходящая почта

С 21 сентября 2026 года OpenProject подключён к существующему серверу Stalwart АСТ Форум.

| Параметр | Значение |
|---|---|
| SMTP | `mail.astforum.ru:465` |
| Шифрование | TLS с проверкой сертификата и имени сервера |
| Авторизация | `login`, пользователь `notifications@astforum.ru` |
| Отправитель | `notifications@astforum.ru` |
| Домен SMTP-клиента | `roadmap.astforum.ru` |

Контейнеры `web` и `worker` подключены к сети `astforum-mail_mail`. Имя `mail.astforum.ru` внутри неё указывает непосредственно на Stalwart.
Это позволяет сохранить проверку TLS и обойти недоступное из контейнеров соединение через публичный IP сервера.

Настройки заданы переменными окружения в `compose.yaml` и имеют приоритет над административным интерфейсом OpenProject.
Пароль находится только на VPS: `OPENPROJECT_SMTP__PASSWORD` в `/opt/openproject/.env` с правами `0600`.
Он скопирован из `/opt/astforum-mail/secrets/notifications_password` и входит в стандартную резервную копию OpenProject.
При смене пароля общего ящика обновляйте обе копии и настройки остальных приложений, использующих этот ящик.

После обновления `.env` примените настройки:

```sh
ssh forum-prod
sudo -i
cd /opt/openproject
docker compose config --quiet
docker compose up -d --no-deps web worker
```

Не публикуйте вывод `docker compose config` без `--quiet`: он содержит пароли.
Основа настройки: [исходящая почта OpenProject](https://www.openproject.org/docs/installation-and-operations/configuration/outbound-emails/).

Проверено 21 сентября 2026 года: приложение использует SMTP/TLS 465, проверка сертификата и авторизация проходят успешно.
В 18:21 МСК первое ранее неотправленное письмо автоматически обработано повторно и доставлено в локальный ящик Stalwart.
Доставка подтверждена журналом `delivery.completed`; новые тестовые письма для этой проверки не создавались.
Настройки до изменения сохранены в `/opt/openproject/backups/smtp-20260921T151501Z/`.

## Управление

```sh
ssh forum-prod
sudo -i
cd /opt/openproject
docker compose ps -a
docker compose logs --tail=100 web worker
docker compose stop web worker collaboration
docker compose start web worker collaboration
```

`seeder` завершает работу после подготовки базы; код выхода `0` является нормальным состоянием.
Остальные сервисы автоматически запускаются при старте Docker, если их не останавливали вручную.

## Данные и секреты

- База: том `astforum-openproject_pgdata`.
- Вложения: том `astforum-openproject_assets`.
- Настройки: `/opt/openproject/compose.yaml` и `/opt/openproject/.env`.
- Внешняя Docker-сеть для Caddy: `outline_frontend`.
- Внешняя Docker-сеть для SMTP: `astforum-mail_mail`.
- База и Memcached находятся в отдельной внутренней сети без опубликованных портов.

Файл `.env` содержит постоянный ключ приложения и пароли. Храните его вместе с резервной копией.
Не удаляйте тома и не выполняйте `docker compose down -v` для обычной остановки.

## Резервная копия

```sh
ssh forum-prod 'sudo /opt/openproject/backup.sh'
```

Скрипт временно останавливает только OpenProject, создаёт согласованную копию базы и вложений, затем запускает приложение.
Копия хранится в `/var/backups/openproject/` в каталоге с датой UTC. Архивы и контрольные суммы проверяются при создании.
Копии содержат секреты и доступны только root. Автоматическое расписание и удалённое хранение не настроены.
Первая проверенная копия: `/var/backups/openproject/20260918T124145Z`.

## Восстановление

Следующие команды заменяют текущие данные данными выбранной копии. Сначала создайте копию текущего состояния.
Выполняйте восстановление от root на VPS, используя ту же версию OpenProject и совместимую версию PostgreSQL.

```sh
cd /opt/openproject
read -r -p 'Полный путь к резервной копии: ' snapshot
test -d "$snapshot"
(cd "$snapshot" && sha256sum -c SHA256SUMS)
docker compose stop web worker collaboration
cp -a "$snapshot/.env" .env
docker compose exec -T db pg_restore -U openproject -d openproject \
  --clean --if-exists --exit-on-error < "$snapshot/database.dump"
assets_path=$(docker volume inspect astforum-openproject_assets --format '{{.Mountpoint}}')
test -n "$assets_path"
find "$assets_path" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -C "$assets_path" -xzf "$snapshot/assets.tar.gz"
docker compose up -d --pull never web worker collaboration
docker compose ps -a
```

Общую конфигурацию Caddy из копии не восстанавливайте целиком без проверки: она содержит маршруты других сервисов.

## Проверки

```sh
dig +short roadmap.astforum.ru @ns1.reg.ru
curl -I https://roadmap.astforum.ru/login
ssh forum-prod 'sudo docker compose -f /opt/openproject/compose.yaml ps -a'
```

Успешная публикация: DNS возвращает `84.47.165.130`, TLS проходит проверку, `/login` отвечает HTTP 200, контейнер `web` имеет статус `healthy`.

Основа конфигурации: [официальная установка Docker Compose](https://www.openproject.org/docs/installation-and-operations/installation/docker-compose/).
