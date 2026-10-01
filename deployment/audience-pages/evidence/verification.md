# Проверка страниц — 02.10.2026

Outline auth.info подтверждён: Кузьмина, 667e07ed-3c9f-4c1b-ad8e-5755f022a668. OpenProject users/me: 8, Ассистент Кузьмина. API work packages: 183/184/185 displayId PROJ-145/146/147; родитель 66 / PROJ-29.

Forum / Light прочитан live read-only use_figma: collection VariableCollectionId:107:73, Light 107:0. Семантические primary роли/aliases совпадают с принятой главной. Rest #FF551A, hover #FF7140, pressed #E64A12, disabled #FFD4B2, label #040404. Белый текст не принят; тёмная подпись даёт 6.41:1. Остальные роли и типографика остаются Primer Light. Библиотека проекта Primer Web (Community) найдена через design-system search; официальные React пакеты проверены по imports/dependencies.

Проверки UI через Codex iab: 12 комбинаций трёх маршрутов и ширин 1440/768/390/320. document.scrollWidth не превышает innerWidth; основные блоки/кнопки сохранены. Логотип имеет прозрачный запас, отрицательный translateX взят из принятой главной и визуально не обрезает знак. На телефоне колонки становятся вертикальными. Якорь шагов: stepTop 229px, sticky headerBottom 205px при 390px — заголовок не перекрыт.

Выбор вакансий скрывает пример заказа, оставляет выбор обоих форматов и сохраняется после reload. Рабочая кнопка вакансий отсутствует по правилу выпуска. FAQ доступен без входа.

Тесты: 16 Vitest assertions на сценарии/намерения/context/callback, 3 Python проверки scope/повторной публикации/rollback. Typecheck и lint проходят. Build проходит с предупреждениями Vite о chunk >500kB и директиве react-compiler-runtime. Primer validator: 0 ошибок; PDS007 warnings относятся к разрешённым props size/variant и существующим layout/padding в Details; просмотрены вручную.

Не проверено: полноценный VoiceOver и реальное завершение новой Sber регистрации в этом чате; операция создаёт пользователя и не требуется для проверки лендингов. Зависимые Диадок/профили/рабочие списки/найм на сервере отсутствуют и не объявляются готовыми.
