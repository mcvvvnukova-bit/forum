# PROJ-168: постоянный CI на текущем Mac

Владелец выбрал постоянный сервер CI на текущей машине. GitHub продолжает управлять заданиями, логами, статусами и артефактами; Docker-зависимые задания выполняются локально в Linux.

Два Linux ARM64 исполнителя работают в Docker Desktop. Отдельный вложенный Docker daemon хранит образы в постоянном именованном томе. Исполнители и daemon видят один том рабочих каталогов по одинаковому пути и общий сетевой namespace, поэтому текущие bind mounts и обращения к localhost работают. Сокет Docker Desktop и личные каталоги Mac в окружение заданий не передаются. Привилегии нужны только контейнеру вложенного daemon.

На локальные исполнители направляются api, database, operational и web-release из main и веток этого же репозитория. Внешние fork PR используют GitHub-hosted Ubuntu. Репозиторная переменная позволяет включить локальную маршрутизацию и вернуть GitHub-hosted режим без изменения кода. Все проверки и итоговый quality gate сохраняются.

Исходные образы закреплены существующими digest. При первоначальном наполнении можно импортировать уже имеющиеся образы из Docker Desktop. Дальнейшие задания используют локальные слои; явный PostgreSQL pull заменяется проверкой наличия нужного образа и платформы. Образы сохраняются при остановке и перезапуске сервиса. Автоматической очистки образов и пользовательских контейнеров нет.

Исполнители устанавливаются в Library/Application Support/AST Forum CI, с двумя отдельными томами состояния runner и общими томами Docker и рабочих файлов. Регистрационный токен GitHub используется только при регистрации и не сохраняется в репозитории, Compose environment или логах. Административный GitHub token не передаётся в Linux. На Mac создаётся LaunchAgent для запуска Docker Desktop и CI после входа пользователя. Сон и выключение Mac делают исполнители недоступными.

Приёмка: два исполнителя online; реальные четыре задания выполняются на них; итоговый quality проходит; нужные образы доступны без pull после перезапуска; фиксируются время подготовки и работы задания; новая задача и родитель PROJ-164 показывают PR. Запуск ограничен ресурсами Docker Desktop, без изменения других сервисов или публикации сайта.


## Уточнения исполнения, утверждённые в Task 1

Pre-job hook включён через ACTIONS_RUNNER_HOOK_JOB_STARTED и baked вне writable runner home. До шагов задания он fail-closed проверяет fixed mcvvvnukova-bit/forum и payload: push/workflow_dispatch из своего repository, pull_request только со своими head и base repository. Fork, другие события, отсутствующий или malformed payload отклоняются независимо от routing YAML. Manager копирует hook и validator в private runtime; GitHub administrative credentials остаются на Mac.

Два runner используют общий network namespace daemon. Для одновременных web-release jobs FORUM_WEB_E2E_PORT равен 5297 у первого и 5298 у второго; public-site config и сервер валидируют один целочисленный порт 1024..65535. Hosted default остаётся 5297. Docker Compose v5.6.0 linux-aarch64 устанавливается из official release с SHA256 733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2. Limits заданы явно только CI сервисам.

Новая Python suite scripts/verification/test_local_ci.py выполняется в существующем layout шаге Verification and CI regressions после прежних Node suites; все прежние проверки и artifacts сохраняются.
