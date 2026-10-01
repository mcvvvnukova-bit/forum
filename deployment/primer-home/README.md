# Главная АСТ Форум на стандартном Primer

Источник: [PUB.01.01.01](https://docs.astforum.ru/doc/pub010101-stranica-o-platforme-glavnaya-8RLs4d4lgh), текущая редакция прочитана 01.10.2026. [PROJ-144](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-144/activity) проверен в OpenProject. По прямому поручению пользователя от 02.10.2026 страница публикуется в GitHub и заменяет главную на dev.astforum.ru; заглушка astforum.ru сохраняется. Прежние локальные ограничения далее относятся только к режиму локального просмотра.

```sh
npm install
npm run dev
```

Адрес: http://127.0.0.1:5188/. Сервер привязан к loopback. Доступ из сети не предоставляется.

Оформление: Primer React / Primitives Light / Octicons. По уточнению пользователя от 01.10.2026 только цвета основных кнопок привязаны к проверенным токенам Figma `Forum / Light` через `src/forum-tokens.css`: оранжевый фон, тёмный текст, состояния hover/pressed/disabled. Остальные токены и типографика — стандартные Primer; Golos, Unbounded и сторонние компоненты не подключены. Card — официальный компонент из `@primer/react/experimental` версии 38.37.0. Логотип АСТ Форум и 13 исходных изображений партнёров сохранены без перекраски.

Секции и исходные тексты взяты из текущего Outline; тексты демо из связанного PUB.02.01.01. По уточнениям пользователя второе предложение Hero перенесено на новую строку, кнопка физлица подписана «Я ищу работу», три сценария сокращены и перенесены внутрь карточек нумерованными списками. «Начать работу» ведёт к авторизации, «Как это работает» — к правилам. Обе кнопки демо открывают один Dialog Primer с внешним iframe Cal.diy. Внутренний интерфейс iframe принадлежит сервису Cal.diy и не переоформляется. На сервере Cal.diy главная не размещается.

## Границы локальной версии

Три аудитории ведут на локальные экраны переходов. Полные аудиториальные лендинги, реальная авторизация/регистрация, кабинет и юридические документы не реализуются этим запросом. Экраны явно сообщают о локальном просмотре; не выдаются за действующие сервисы или документы. При наличии проверенных адресов замените цели в `.env.local`:

```dotenv
VITE_CUSTOMERS_URL=/customers/
VITE_SUPPLIERS_URL=/suppliers/
VITE_WORK_URL=/work/
VITE_LOGIN_URL=/authorization/
VITE_START_URL=/authorization/
VITE_CABINET_URL=/cabinet/
VITE_PRIVACY_URL=/privacy/
VITE_COOKIES_URL=/cookies/
```

Для просмотра подписи авторизованного состояния: `http://127.0.0.1:5188/?previewSession=authorized`. Этот параметр меняет только подпись кнопки и не создаёт сессию, аккаунт или права доступа.

Числа 28 / 679 млн / 130 — заданные требованиями значения, не полученные из live API. Материалы партнёров скопированы из `deployment/dev-landing/src/landing/assets/logo-color-*`, описанных в `PARTNER_LOGOS.md` и связанном документе Outline «Логотипы компаний-партнёров».

Проверки: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` и обязательный валидатор Primer. Результаты браузерных проверок — `evidence/verification.md`.

История из 13 коммитов отдельного локального репозитория перенесена под `deployment/primer-home` в ветку `codex/PROJ-144-primer-home` репозитория `mcvvvnukova-bit/forum`. Сообщения и состав правок сохранены; SHA меняются из-за новых путей и родителя. Требования в Outline не изменяются.

## Dev-сборка и публикация

```sh
npm ci
npm run build:dev
npm run lint
npm test
python3 -m unittest discover -s scripts -p 'test_*.py'
```

В dev-сборке «Войти» ведёт на `/auth/sber-id/start?intent=login`, «Начать работу» — на `/auth/sber-id/start?intent=register&subject=individual`. `/authorization` — адрес возврата OAuth, не начала входа. Реальная сессия берётся из `/api/auth/session`; параметр previewSession в dev-сборке не выдаётся за авторизацию. Ошибки существующего API показываются через Primer Banner; незарегистрированному пользователю предлагается действующая регистрация.

Шлюз общего пароля, существующий Sber API, `/customers/` и календарь сохраняются. Другие полноценные аудиторные страницы, кабинет и юридические документы этим пакетом не реализуются; они остаются информационными экранами переходов.

После проверенной сборки из каталога пакета:

```sh
release_commit=$(git rev-parse HEAD)
release_dir="/home/testing-user/primer-home-${release_commit}"
ssh forum-prod "mkdir -p '$release_dir'"
COPYFILE_DISABLE=1 tar --no-xattrs -cf - dist scripts/deploy-dev-home.py \
  | ssh forum-prod "tar -C '$release_dir' -xf -"
ssh forum-prod "sudo -n python3 '$release_dir/scripts/deploy-dev-home.py' '$release_dir/dist' --commit '$release_commit'"
```

Сценарий меняет только `/opt/outline/dev-astforum/landing/index.html` и ресурсы `landing/assets`. Старые landing-assets и hashed-ресурсы открытых страниц сохраняются. До замены создаётся резервная копия index/assets в `/opt/outline/backups/primer-home-*`; индекс меняется атомарно после копирования ресурсов. Перезапуск Caddy и шлюза не нужен.

HTML и SHA-256 каждого ресурса проверяются через origin и публичный HTTPS вместе с dev-входом, health, robots, session API и страницей заказчика. Контрольные суммы production-заглушки, auth-файлов, страницы заказчика, gateway, Caddyfile и Compose должны остаться прежними. При ошибке index/assets автоматически восстанавливаются. JSON с коммитом и результатами сохраняется в резервном каталоге, секреты в него не записываются.

Ручной откат: скопировать index.html из резервной копии во временный файл внутри landing и атомарно переименовать в landing/index.html. При необходимости assets восстанавливаются из той же копии; оставшиеся дополнительные hashed-файлы сами по себе не меняют главную.
