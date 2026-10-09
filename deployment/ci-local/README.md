# Постоянные локальные исполнители CI — PROJ-168

GitHub управляет заданиями и артефактами. Docker Desktop выполняет два Linux ARM64 runner: `astforum-mac-ci-01` и `astforum-mac-ci-02` с labels `self-hosted,Linux,ARM64,astforum-local-ci`. Установка относится только к `mcvvvnukova-bit/forum` и OpenProject OP#PROJ-168 / OP#PROJ-164.

Из корня checkout выполните `python3 scripts/deployment/ci-local/manage.py install`. Нужны работающий Docker Desktop, Python 3 и авторизованный на Mac `gh` с разрешением управления repository runners. Manager копирует Dockerfile, Compose, entrypoint, pre-job hook и собственный код в `~/Library/Application Support/AST Forum CI/runtime` с закрытыми правами. Дальнейший запуск не зависит от сохранности worktree. `install` собирает образ, запускает fixed Compose project `astforum-ci-local`, наполняет и проверяет pinned images до регистрации, затем регистрирует только отсутствующих runner. Несоответствие локальной и GitHub регистрации требует ручной проверки; существующие регистрации не заменяются. Регистрационный token поступает из host `gh api` через stdin, вывод конфигурации перехватывается, административный token в Linux не попадает.

После установки используйте `python3 "$HOME/Library/Application Support/AST Forum CI/runtime/manage.py" COMMAND`:

- `start`: запустить сохранённый сервис, без регистрации;
- `stop`: остановить только эти контейнеры, сохранив тома, образы и регистрации;
- `status`: вывести только имена, состояния, health и busy;
- `warm`: импортировать четыре закреплённых digest и `caddy:2.10-alpine` из Docker Desktop по verified tag/RepoDigest, проверить запрошенный reference и platform во вложенном daemon через inspect и network-isolated pull=never container; если save/load не сохранил RepoDigest, получить точный reference через pull;
- `autostart`: установить user LaunchAgent `ru.astforum.ci-local`, который после login запускает Docker Desktop CLI и сохранённый сервис, без регистрации или credentials.

Все команды принимают `--state-dir PATH`. Compose project и имена runners фиксированы: это один сервис, а не параллельные установки. Autostart требует входа пользователя. Во время сна или выключения Mac runner недоступны. LaunchAgent не содержит секретов; его logs содержат только sanitized сообщения manager. Изменение deployment требует повторного `install`, которое обновляет скопированные runtime файлы.

Только daemon privileged. Host Docker socket, личные каталоги Mac и TCP Docker API в jobs не передаются; ports не публикуются. Daemon и оба runner разделяют network namespace и `/ci`, сохраняя localhost и bind mounts. Runner имеют отдельные homes, `/ci/01` и `/ci/02`, включая TMPDIR для Bash/Python/Node и RUNNER_TEMP под work path, writable persistent tool/browser/npm caches. Nested images/socket/workspace — постоянные named volumes. Начальный общий лимит — 4 CPU и 3072 MiB: daemon 0.5 CPU/512 MiB, каждый runner 1.75 CPU/1280 MiB. Менять можно только эти CI limits по измеренной потребности. Другие сервисы Docker Desktop не затрагиваются. Docker Compose v5.6.0 загружается из официального release с SHA256 проверкой; runner application auto updates включены.

Для включения маршрутизации задайте repository variable `ASTFORUM_CI_DOCKER_RUNNERS` равной `["self-hosted","Linux","ARM64","astforum-local-ci"]`. Только `api`, `database`, `operational`, `web-release` используют её. Пустая переменная или внешний fork PR возвращают `["ubuntu-24.04"]`. Удаление переменной отключает новые локальные задания; уже назначенные jobs следует завершить перед stop.

Дополнительно baked pre-job hook вне writable runner home проверяет fixed repository и payload события до шагов job. Допускаются `push`, `workflow_dispatch` с собственным repository и `pull_request` с собственными head/base repository. Fork, отсутствующий/malformed payload и другие события отклоняются с sanitized ошибкой, даже если PR изменяет routing YAML. Настройки fork approvals остаются прежними. Раздельные `FORUM_WEB_E2E_PORT=5297/5298` предотвращают конфликт public-site browser сервера в общем namespace; hosted default — 5297.

Приёмка оператора: оба runners online, четыре реальные jobs и quality успешны, pinned images доступны после stop/start, сохранены времена job setup/runtime, PR связан с двумя задачами OpenProject. Команды не публикуют сайт и не очищают чужие контейнеры или образы.
