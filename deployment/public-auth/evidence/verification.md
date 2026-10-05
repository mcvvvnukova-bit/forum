# PROJ-31: проверка формы и публикации

## Восстановление входа 05.10.2026 после публикации формы

Ошибка первоначального IAM-перехода, зафиксированная ниже в `live-iam-error.jpg`,
устранена. Backend возвращал `provider_unavailable`: обычный DNS контейнера
падал с `EAI_AGAIN` для `oauth-sb.sber.ru`; его resolv.conf содержал
`NO EXTERNAL NAMESERVERS DEFINED`. Рабочий DNS VPS явно задан только сервису
`forum_api` через `deployment/forum-api/sber-dns.override.yaml`, коммит
`8026178601a36f4385314b853aa3b13a5764aa67`. Backup:
`/opt/forum-api/backups/dns-20261005T173858Z`.

- Реальный транспортный тест до исправления: 0/1, `EAI_AGAIN`; после: 1/1,
  TLS 1.3 с проверенным сертификатом, ответ API 400 на GET без параметров.
- Настоящий вход через Сбер ID завершился успешно. `/login` после reload
  показывает «Вы уже вошли в аккаунт» без alert. БД подтверждает новое событие
  `UserAuthenticated` и повторное использование прежнего аккаунта: users=1,
  sber_identities=1. Создание нового аккаунта этой проверкой не заявляется.
- Пересоздан только API; прежний образ, значения environment и все прочие
  resolved Compose настройки сохранены. 19 остальных контейнеров и 31
  защищённый файл совпали с baseline. Данные сессии — в прежней изолированной
  БД `forum_sber_sandbox`; strict TLS и callback сохранены.
- Доказательства и снимок: `sber-dns/`. Старые `live-iam-*` остаются исторической
  фиксацией ошибки до исправления, а не текущим состоянием сервиса.

## Проверенная публикация 05.10.2026

Опубликованный коммит: `38420491fafcfe85f5931f7964400120b190e143`; target `/opt/outline/dev-astforum/landing`. Backup: `/opt/outline/backups/public-auth-20261005T170414402072Z`. SSH: `forum-prod`, per-process `-o BindInterface=en0`. Production и сетевые настройки не менялись; перезапуск не требовался.

Перед публикацией выявлены два дефекта интеграции. Служебный `._index.html` macOS вызывал UnicodeDecodeError: регрессия RED→GREEN, исключаются AppleDouble и __MACOSX. На /participate независимо собранное React-приложение имело тот же useId, что tooltip крестика: регрессия RED→GREEN, public-auth root теперь имеет identifierPrefix. Оба исправления отправлены в PR13 до финальной публикации.

Финальная проверка: 18 Vitest + 6 Python, ESLint, TypeScript/build прошли. Primer validator: 0 ошибок, 5 ранее описанных предупреждений. Vite предупреждает о module-level `use no memo` в react-compiler-runtime; сборка завершилась успешно.

- Все 11 HTML/JS/CSS/WOFF2 файлов дали 200 и совпадающий SHA256 через origin http://127.0.0.1 (Host dev.astforum.ru) и https://dev.astforum.ru. Отчёты: live-deployment.json и live-verification.json.
- Анонимная сессия 401, парольный dev-шлюз защищает страницу, вход шлюза 303, health ok, robots Disallow: /. Секреты и cookie в доказательства не записывались.
- 31 production / auth / gateway / Caddy / Compose файл совпал по SHA256 с protected-before.json.
- IAB: /, /customers/, /suppliers/, /work/, /participate/ открывают общий Dialog; Tab переходит на provider, Escape закрывает и возвращает фокус «Войти». Back после переключения, крестик и фон закрывают окно и возвращают исходный URL. Прямые /login и /register проверены с reload.
- Финальная сборка: по четыре modal/standalone проверки при 320/360/768/1280 px, 19px/700, одна строка, текст внутри кнопки, кнопка внутри viewport, scrollWidth == viewport. «Вернуться на сайт» отсутствует. Точные измерения в live-button-layout.json. На 360 и 768 px Tab остаётся внутри диалога.
- Проверочный переход кнопки входа достиг authorize страницы Сбер ID; затем браузер вернулся на dev /login с alert «Не удалось завершить вход. Попробуйте ещё раз». Полная авторизация и создание аккаунта не подтверждены; существующий IAM и его callback https://astforum.ru/authorization не менялись. live-iam-start.json содержит только адреса без OAuth state/nonce/code.
- Подтверждена учётная запись «Ассистент Кузьмина» и ссылка mcvvvnukova-bit/forum#13 во вкладке GitHub PROJ-31: live-openproject.txt.

Снимки текущей публикации: live-register-modal-desktop.jpg, live-register-320.jpg. live-iam-error.jpg фиксирует реальный незавершённый переход IAM. Полный VoiceOver не проверялся.

## Локальная проверка и попытки публикации 02.10.2026

Требования прочитаны из текущего Outline API под Кузьмина, id 667e07ed-3c9f-4c1b-ad8e-5755f022a668, updatedAt 2026-10-02T14:29:50.285Z. Задача PROJ-31 проверена через /api/v3/work_packages/PROJ-31 под пользователем 8: фактический API id 68. В OpenProject старое название PUB.01.03; принадлежность подтверждена ссылкой на тот же Outline документ.

- TypeScript, ESLint, build: passed.
- Vitest: 17/17. Session 401/valid 200/malformed/403/500/timeout; modal/direct page; safe query removal; login/register switching; request contract and one-click guard; session retry and provider retry; callback cancellation; blocked accounts; unavailable provider; page fragments remain anchors.
- Python deploy: 5/5. Every public HTML receives shared script/styles; /login and /register use same built page; existing content/other files preserved; repeated inclusion idempotent; failure restores own changes; malformed HTML refused; concurrent publisher preserved.
- Primer validator with **/sber-tokens.css approved vendor source: 0 errors, 5 PDS007 warnings for Primer gap props and CSS line-height alias. No other UI dependency; ThemeProvider/BaseStyles/Primitives Light. Forum mappings not introduced; neutral roles remain Primer Light.
- Official Sber sign and rest/hover colors checked from current developers.sber.ru guide. White over #21A038 contrast 3.4146:1; font 20px, weight 700 meets large-text threshold. Exact requested registration copy retained despite different recommended preposition in vendor guide.
- In-app browser: local fixture: modal login/register over the page; Tab stays inside, Escape restores /evidence/preview.html and focus to «Войти»; #demo stays a fragment; local /login and /register; switching and refresh; 360px regression reproduced (overflow), fixed using own Button content composition, no Primer internal selector overrides. After fix document scrollWidth == innerWidth == 360 and the full provider label is visible.

Fresh read-only review found three Important issues; all fixed with RED-to-GREEN regressions: fragment URL interpretation, preservation of concurrent publication on rollback, and explicit IAM retry. No Critical or Minor findings.

Publication attempt: SSH forum-prod (84.47.165.130:15833) worked during initial server inspection, then timed out before publication. Source/dist and a reversible publication script are prepared; no live HTML was changed by this attempt. Origin/HTTPS hash verification and deployed all-page modal checks remain unverified until SSH is restored. Existing dev password, production and IAM were not changed.

Live provider account creation and full VoiceOver not tested; IAM backend remains the existing dependency. Local fixture evidence/preview.html is explicitly a test page and is not included in the Vite release build.

PR #13 создан в правильном репозитории mcvvvnukova-bit/forum, base main, ветка codex/PROJ-31-public-auth-form; commits и состав файлов проверены через gh. PR прикреплён к чату; после reload во вкладке GitHub PROJ-31 показан mcvvvnukova-bit/forum#13.

Снимки: login-desktop.jpg, register-tablet.jpg, register-mobile.jpg. На 768 px panel x104..664, width560, scrollWidth768; на 360 px scrollWidth360. Клавиатура: Tab с крестика на provider внутри dialog; Escape закрывает и возвращает focus «Войти». VoiceOver не запускался.

Уточнение владельца: кнопка стала компактнее и центрируется, ссылка «Вернуться на сайт» удалена. В IAB на 1280 px кнопка входа 233.38 px, регистрации 354 px; на мобильном 360 px кнопка регистрации 282 px, scrollWidth360, полный текст виден. Обновлены снимки; 17 frontend + 5 deployment tests, lint, typecheck/build прошли повторно. Повторное подключение SSH также завершилось timeout до каких-либо изменений на сервере.

Последнее уточнение владельца: шрифт 19px/700, текст «Зарегистрироваться по Сбер ID» одной строкой. Самостоятельная страница и модальное окно проверены при 320/360/768/1280 px после document.fonts.ready: lineCount1, labelInsideButton true, buttonInsideViewport true, scrollWidth == viewport. Точные измерения в button-layout.json. Кнопка 301.08 px при 320, 305.08 px при остальных ширинах; полный текст 239.08 px. Компактный Noto Sans из fallback-стека Primer загружается локально (Cyrillic+Latin, 21.2kB), источник и SHA256 в src/fonts/SOURCE.md, OFL сохранён. Оформление адаптировано через публичные Stack padding / Dialog renderBody / style API; собственные классы, без селекторов внутренней разметки Primer. Escape возвращает фокус на исходную ссылку. Повторно прошли 17 frontend + 5 deployment tests, lint, typecheck/build. Primer: 0 errors, 5 предупреждений для component gap/line-height и layout breakpoints. SSH повторно timeout, публикация не состоялась.
