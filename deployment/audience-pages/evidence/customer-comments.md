# Проверка десяти комментариев — 02.10.2026

Эталон проверен live через Codex iab: dev.astforum.ru. Общая шапка: три страницы аудиторий, `/#rules`, «Войти» -> `/auth/sber-id/start?intent=login`. Rules: «Верифицированные участники», «Проверенные заказы», «Отчетность и аналитика» и существующие Octicons. Demo: «Посмотрите, как работает АСТ Форум», два абзаца и «Выбрать время».

Локальная проверка iab:

- Комментарии 1/2: постоянная кнопка «Войти» с URL главной; при 1679px `h1.innerText` содержит перенос перед «для»; на 768/390/320px br скрыт, перенос естественный.
- Комментарии 3–6: четыре точные пользовательские формулировки видны в DOM. Добавлено «в профиле подрядчика».
- Комментарий 7: вынесен неизменённый стандартный RulesSection, используемый локальной главной и заказчиками; тексты live-эталона совпадают.
- Комментарий 8: финальная Primer Card с muted semantic фоном, копия слева, две кнопки справа; Stack column на телефоне. Текущие действия сохранены.
- Комментарий 9: следующий sibling после comparison — `#demo`. Enter на «Выбрать время» открывает Dialog; iframe содержит `audience=Заказчик`. Escape закрывает Dialog и возвращает focus-visible на trigger. Запись не создавалась.
- Комментарий 10: computed font-size обеих служебных ссылок и copyright = 12px, через Primer Text size small.
- Viewport 1679/768/390/320: document.scrollWidth <= innerWidth; кнопки помещаются. На 768 final Stack row, на телефоне column. Header sticky и tab semantics сохранены.

Typecheck, ESLint, 18 существующих Vitest tests и production build проходят. Primer validator: 0 ошибок; PDS007 предупреждения на существующие/допустимые props и layout literals проверены. Новые literal/layout mirror tests не добавлялись по developer instruction. Семантические aliases Forum / Light не менялись; используются подтверждённые ранее значения. Новых brand mappings и fallback цветов нет. Полный VoiceOver не проверен.

Публикация, remote SHA и четыре ссылки OpenProject фиксируются после выкладки.
