# Проверка страниц — 02.10.2026

Outline auth.info подтверждён: Кузьмина, 667e07ed-3c9f-4c1b-ad8e-5755f022a668. OpenProject users/me: 8, Ассистент Кузьмина. API work packages: 183/184/185 displayId PROJ-145/146/147; родитель 66 / PROJ-29.

Forum / Light прочитан live read-only use_figma: collection VariableCollectionId:107:73, Light 107:0. Семантические primary роли/aliases совпадают с принятой главной. Rest #FF551A, hover #FF7140, pressed #E64A12, disabled #FFD4B2, label #040404. Белый текст не принят; тёмная подпись даёт 6.41:1. Остальные роли и типографика остаются Primer Light. Библиотека проекта Primer Web (Community) найдена через design-system search; официальные React пакеты проверены по imports/dependencies.

Проверки UI через Codex iab: 12 комбинаций трёх маршрутов и ширин 1440/768/390/320. document.scrollWidth не превышает innerWidth; основные блоки/кнопки сохранены. Логотип имеет прозрачный запас, отрицательный translateX взят из принятой главной и визуально не обрезает знак. На телефоне колонки становятся вертикальными. Якорь шагов: stepTop 229px, sticky headerBottom 205px при 390px — заголовок не перекрыт.

Выбор вакансий скрывает пример заказа, оставляет выбор обоих форматов и сохраняется после reload. Рабочая кнопка вакансий отсутствует по правилу выпуска. FAQ доступен без входа.

Тесты: 18 Vitest assertions на сценарии/намерения/context/callback, 3 Python проверки scope/повторной публикации/rollback. Typecheck и lint проходят. Build проходит с предупреждениями Vite о chunk >500kB и директиве react-compiler-runtime. Primer validator: 0 ошибок; PDS007 warnings относятся к разрешённым props size/variant и существующим layout/padding в Details; просмотрены вручную.

Не проверено: полноценный VoiceOver и реальное завершение новой Sber регистрации в этом чате; операция создаёт пользователя и не требуется для проверки лендингов. Зависимые Диадок/профили/рабочие списки/найм на сервере отсутствуют и не объявляются готовыми.

Независимое ревью: устранены потеря обычного входа при сохранённом намерении компании и ссылка на несуществующий якорь handoff-страницы. Оба воспроизведены тестами RED → GREEN. Клавиатура: Enter открывает CTA и FAQ, Escape закрывает Dialog, фокус возвращается на trigger с :focus-visible/solid outline. Демо iframe содержит audience=Компания-исполнитель.

## Публикация и проверка сервера

Опубликованы https://dev.astforum.ru/customers/, https://dev.astforum.ru/suppliers/, https://dev.astforum.ru/work/ и экран следующего шага `/participate/`. Код: https://github.com/mcvvvnukova-bit/forum/pull/11, ветка `codex/PROJ-145-audience-pages`, base `main`. PR прикреплён к чату Codex. Через iab под Кузьмина проверено появление PR #11 во вкладке GitHub задач PROJ-145, PROJ-146, PROJ-147 и родителя PROJ-29; `openproject-links.json`.

Все 26 опубликованных HTML/ресурсов сверены SHA-256 с пакетом; HTTP 200, `served-build.json`. Без dev cookie сервер показывает прежний вход и noindex/nofollow/noarchive. Существующая главная отличается только marker script возврата из Сбер ID; `homepage_only_resume_changed=true` в `deployment.json`. Публичная astforum.ru не изменилась: SHA-256 `afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a` до и после. Backup: `/opt/outline/backups/audience-pages-20261001T223939951849Z` (UTC).

В iab на сервере просмотрены три страницы. Проверены направление «Поставка товаров» в CTA компании и сохранение «Выбрать вакансии» после reload. При существующем личном сеансе CTA подработки показывает подготовку профиля, а CTA компании требует подходящего контекста и сообщает о будущем запуске Диадок. Ошибок console на странице работы нет. Снимки `published-customers.png`, `published-suppliers.png`, `published-work.png` сохранены локально (не входят в Git). Верхний логотип и hero загружены; нижний логотип использует lazy loading вне viewport. Полноценные рабочие формы и новые регистрации не имитировались.
