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

Публикация завершена: `/customers/`, `/suppliers/`, `/work/`, `/participate/`; 26 served файлов совпали SHA-256 с package. Anonymous gate/noindex сохранены, публичная astforum.ru имеет прежний hash. Backup `/opt/outline/backups/audience-pages-20261002T120033586609Z`. Главная изменилась только marker возврата Сбер ID, `homepage_only_resume_changed=true`. JSON доказательства: customer-comments-deployment.json и customer-comments-served.json.

В iab опубликованные правки видны после reload. Shared header и legal 12px проверены также на suppliers/work; customer-comments-shared-layout.json. Текущий сеанс физлица анонимный: authenticated flow в этом проходе не завершался; постоянная подпись header не зависит от useSession по реализации и независимому ревью. Published снимки customer-comments-published-hero.png и customer-comments-published-final.png сохранены локально.

Независимое ревью delta 2d089eb..da3621b: Critical 0, Important 0, Minor 0. Внешние Sber/Диадок/заказы и фактическое бронирование не проверялись, backend не менялся; проверен существующий endpoint URL, intent и Dialog. Цена ошибочного предположения — ранее существовавшая неисправность зависимого сервиса. Публикация/remote/OP отложены reviewer до Task 2 и проверены отдельно.

Под Кузьмина API users/me и browser account совпали с user 8; PR #11 виден во вкладке GitHub PROJ-145, PROJ-146, PROJ-147 и PROJ-29. customer-comments-openproject.json содержит проверенные href. PR прикреплён к текущему чату.
