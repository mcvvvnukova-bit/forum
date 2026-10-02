# PROJ-31: проверка формы, 02.10.2026

Требования прочитаны из текущего Outline API под Кузьмина, id 667e07ed-3c9f-4c1b-ad8e-5755f022a668, updatedAt 2026-10-02T14:29:50.285Z. Задача PROJ-31 проверена через /api/v3/work_packages/PROJ-31 под пользователем 8: фактический API id 68. В OpenProject старое название PUB.01.03; принадлежность подтверждена ссылкой на тот же Outline документ.

- TypeScript, ESLint, build: passed.
- Vitest: 17/17. Session 401/valid 200/malformed/403/500/timeout; modal/direct page; safe query removal; login/register switching; request contract and one-click guard; session retry and provider retry; callback cancellation; blocked accounts; unavailable provider; page fragments remain anchors.
- Python deploy: 5/5. Every public HTML receives shared script/styles; /login and /register use same built page; existing content/other files preserved; repeated inclusion idempotent; failure restores own changes; malformed HTML refused; concurrent publisher preserved.
- Primer validator with **/sber-tokens.css approved vendor source: 0 errors, 4 PDS007 warnings for Primer gap props and CSS line-height alias. No other UI dependency; ThemeProvider/BaseStyles/Primitives Light. Forum mappings not introduced; neutral roles remain Primer Light.
- Official Sber sign and rest/hover colors checked from current developers.sber.ru guide. White over #21A038 contrast 3.4146:1; font 20px, weight 700 meets large-text threshold. Exact requested registration copy retained despite different recommended preposition in vendor guide.
- In-app browser: local fixture: modal login/register over the page; Tab stays inside, Escape restores /evidence/preview.html and focus to «Войти»; #demo stays a fragment; local /login and /register; switching and refresh; 360px regression reproduced (overflow), fixed using own Button content composition, no Primer internal selector overrides. After fix document scrollWidth == innerWidth == 360 and the full provider label is visible.

Fresh read-only review found three Important issues; all fixed with RED-to-GREEN regressions: fragment URL interpretation, preservation of concurrent publication on rollback, and explicit IAM retry. No Critical or Minor findings.

Publication attempt: SSH forum-prod (84.47.165.130:15833) worked during initial server inspection, then timed out before publication. Source/dist and a reversible publication script are prepared; no live HTML was changed by this attempt. Origin/HTTPS hash verification and deployed all-page modal checks remain unverified until SSH is restored. Existing dev password, production and IAM were not changed.

Live provider account creation and full VoiceOver not tested; IAM backend remains the existing dependency. Local fixture evidence/preview.html is explicitly a test page and is not included in the Vite release build.

PR #13 создан в правильном репозитории mcvvvnukova-bit/forum, base main, ветка codex/PROJ-31-public-auth-form; commits и состав файлов проверены через gh. PR прикреплён к чату; после reload во вкладке GitHub PROJ-31 показан mcvvvnukova-bit/forum#13.

Снимки: login-desktop.jpg, register-tablet.jpg, register-mobile.jpg. На 768 px panel x104..664, width560, scrollWidth768; на 360 px scrollWidth360. Клавиатура: Tab с крестика на provider внутри dialog; Escape закрывает и возвращает focus «Войти». VoiceOver не запускался.

Уточнение владельца: кнопка стала компактнее и центрируется, ссылка «Вернуться на сайт» удалена. В IAB на 1280 px кнопка входа 233.38 px, регистрации 354 px; на мобильном 360 px кнопка регистрации 282 px, scrollWidth360, полный текст виден. Обновлены снимки; 17 frontend + 5 deployment tests, lint, typecheck/build прошли повторно. Повторное подключение SSH также завершилось timeout до каких-либо изменений на сервере.
