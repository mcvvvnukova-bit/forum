# Операторские команды ОКПД2

Требования и состояние выпуска: [Outline](https://docs.astforum.ru/doc/adm020201-integraciya-s-sistemoj-istochnikom-nJBdiTMnBK), [PROJ-178](https://roadmap.astforum.ru/work_packages/PROJ-178).

Сборка: `bash scripts/deployment/build-okpd2-local.sh`. CLI внутри образа:

```sh
node dist/okpd2-cli.js preview
node dist/okpd2-cli.js migrate
node dist/okpd2-cli.js sync
node dist/okpd2-cli.js list
node dist/okpd2-cli.js show 7
node dist/okpd2-cli.js approve 7 EXPECTED_SHA256 admin:8 'Сверено с официальным источником'
node dist/okpd2-cli.js reject 7 EXPECTED_SHA256 admin:8 'Причина отказа'
```

`preview` не требует БД. Остальные команды читают `DATABASE_URL_FILE` (предпочтительно) или `DATABASE_URL`. Не выводите DSN в журналы. `migrate` выполняет только владелец схемы после основных миграций API; команда устанавливает отдельную миграцию ОКПД2 и namespace очереди `forum_okpd2_jobs`. Worker запускает `node dist/okpd2-worker.js` с `migrate:false,reindex:false`.

После миграции создайте отдельную роль `forum_okpd2_worker` без SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Примените `grant-worker.sql` через psql с `worker_role=forum_okpd2_worker`. Роль владеет только namespace своей очереди и получает ограниченные права на таблицы ОКПД2. У нее нет доступа к пользователям, IAM и данным ОКВЭД2. Для API примените `deployment/forum-api/grant-runtime.sql` и к логину, и к наследуемой группе (`forum_app`, `forum_app_role` на dev). API читает только код/название/активность и метаданные опубликованной версии.

Локально создайте закрытый пустой файл для рабочего DSN и укажите его в `OKPD2_WORKER_DSN_FILE`. Сначала поднимите только postgres из `deployment/local/okpd2.compose.yml`, выполните основные миграции и миграцию ОКПД2 соединением владельца, затем примените права. `OKPD2_WORKER_DSN_FILE` указывает на отдельный закрытый файл с ограниченным DSN, читаемый UID 1000. После этого запускайте worker. Для dev нужны сеть БД и отдельная сеть с исходящим доступом HTTPS; внутренняя Docker-сеть БД сама по себе не дает доступа к Росстату.

Распаковщик принимает только две DOCX-части официального архива. Ограничения размера, времени и фиксированные URL находятся в `apps/api/resources/rosstat_okpd2.py`. Корневой сертификат получен с `https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer`; промежуточный — из AIA официального сертификата Росстата: `http://nuc-cdp.digital.gov.ru/cdp/subca_ssl_rsa2024.crt`. Подпись промежуточного проверена корневым; TLS и hostname проверяются. Дополнительная цепочка действует только в процессе адаптера. Ее байты закреплены в ownership receipt; при замене требуется проверка цепочки и новый коммит. Системное хранилище доверия не меняется.

Перед выпуском сохраните БД, ACL, образы API и worker, gateway и веб-артефакт. Откат приложения возвращает прежний API/gateway/web, останавливает только worker ОКПД2; новые таблицы можно сохранить для расследования. SQL `001_okpd2_rosstat.down.sql` — отдельный явный откат владельцем схемы после резервного копирования и остановки очереди; он удаляет только объекты ОКПД2. Namespace очереди удаляется отдельно. Таблицы IAM и ОКВЭД2 откат не затрагивает.
