# Главная АСТ Форум на стандартном Primer — только локально

Источник: [PUB.01.01.01](https://docs.astforum.ru/doc/pub010101-stranica-o-platforme-glavnaya-8RLs4d4lgh), текущая редакция прочитана 01.10.2026. [PROJ-144](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-144/activity) проверен в OpenProject.

```sh
npm install
npm run dev
```

Адрес: http://127.0.0.1:5188/. Сервер привязан к loopback. Доступ из сети не предоставляется.

Оформление: Primer React / Primitives Light / Octicons. Нет Forum CSS, Forum Variables, Golos, Unbounded, переопределений темы и сторонних компонентов. Card — официальный компонент из `@primer/react/experimental` версии 38.37.0. Логотип АСТ Форум и 13 исходных изображений партнёров сохранены без перекраски.

Секции и тексты взяты из текущего Outline; тексты демо из связанного PUB.02.01.01. «Начать работу» ведёт к авторизации, «Как это работает» — к правилам. Обе кнопки демо открывают один Dialog Primer с внешним iframe Cal.diy. Внутренний интерфейс iframe принадлежит сервису Cal.diy и не переоформляется. Главная не публикуется на сервере Cal.diy или любом другом сервере.

## Границы локальной версии

Три аудитории ведут на локальные экраны переходов. Полные аудиториальные лендинги, реальная авторизация/регистрация, кабинет и юридические документы не реализуются этим запросом. Экраны явно сообщают о локальном просмотре; не выдаются за действующие сервисы или документы. При наличии проверенных адресов замените цели в `.env.local`:

```dotenv
VITE_CUSTOMERS_URL=/customers/
VITE_SUPPLIERS_URL=/suppliers/
VITE_WORK_URL=/work/
VITE_LOGIN_URL=/authorization/
VITE_CABINET_URL=/cabinet/
VITE_PRIVACY_URL=/privacy/
VITE_COOKIES_URL=/cookies/
```

Для просмотра подписи авторизованного состояния: `http://127.0.0.1:5188/?previewSession=authorized`. Этот параметр меняет только подпись кнопки и не создаёт сессию, аккаунт или права доступа.

Числа 28 / 679 млн / 130 — заданные требованиями значения, не полученные из live API. Материалы партнёров скопированы из `deployment/dev-landing/src/landing/assets/logo-color-*`, описанных в `PARTNER_LOGOS.md` и связанном документе Outline «Логотипы компаний-партнёров».

Проверки: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` и обязательный валидатор Primer. Результаты браузерных проверок — `evidence/verification.md`.

Отдельный локальный репозиторий и ветка `codex/PROJ-144-primer-home`. Remote не настроен. Никаких push, PR, изменений OpenProject, Outline, VPS или удалённых сервисов.
