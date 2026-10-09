# PROJ-155: единый вход через Сбер ID

Требования: https://docs.astforum.ru/doc/iam0101-registraciya-polzovatelya-cherez-sber-id-NhU2UVa44I
Задача: https://roadmap.astforum.ru/work_packages/PROJ-155/activity
Родитель: OP#PROJ-35. Решение пользователя утверждено в запросе.

## Решение

После подтверждённой идентификации оба intent выполняют поиск по Sber sub и проверенным алиасам. Новый пользователь, личный участник, IAM-роль individual и внешняя идентичность создаются атомарно; существующий активный пользователь сохраняет userId. Блокировка запрещает выдачу сессии и закрывает старую сессию браузера. Успех ведёт на /cabinet/, отказ блокировки открывает Primer Dialog с техподдержкой. participant.role=provider остаётся бизнес-характеристикой, IAM-role=individual становится базовой ролью. Миграция ограничена legacy Sandbox iam; public installation запрещена существующим защитным контрактом.

## Выполнение и проверки

- [x] Проверить Кузьмина в обоих API, создать PROJ-155 и сохранить требования с сохранением таблицы scope и изображения.
- [x] Проверить текущий GitNexus commit/runner/content, query/context/trace и impact/API consumers; динамический вызов callback→authenticate дополнительно проверить исходниками.
- [x] В apps/api/test/auth.test.ts сначала показать отказ старого кода: новый login должен создать одного пользователя с individual, успех должен открыть /cabinet/, блокировка должна отозвать старую сессию; concurrent login/register не дублируют роль.
- [x] Добавить migrations/004_individual_role.sql и последовательное применение в src/migrate.ts; расширить CHECK и идемпотентно преобразовать только старую личную IAM-роль provider в individual, без изменения бизнес-участника.
- [x] В src/iam/auth-store.ts убрать registration_required, выдавать individual; session возвращает роли только своего участника. В auth.controller.ts изменить redirect и завершение старой сессии при account_deactivated.
- [x] В apps/web/src/auth/PublicAuth.test.tsx и тестах кабинета проверить фактическую сессию, явную блокировку, недоступность обхода и состояния загрузки/ошибок; затем изменить PublicAuth.tsx и добавить рабочий кабинет в существующую композицию Primer.
- [x] npm ci; API tests с отдельным forum_auth_test PostgreSQL; web tests/typecheck/lint/build, composition и Primer validation. Записать реально выполненные проверки.
- [ ] GitNexus detect_changes после staging, commit/push, PR с OP#PROJ-155 и OP#PROJ-35, attach_artifact и GitHub tab OpenProject.
- [ ] Exact PR CI artifact → существующий web_release publisher с CAS/backup/rollback; API image из exact commit, Sandbox target/grants/migration, rollback image/config. Не менять production UI или общую БД forum.public.
- [ ] Сравнить artifact/deployed/served hashes; iab реальный Sandbox вход 79010000001/00000, повторный userId, individual и /cabinet/. Проверить desktop/mobile модальное окно и записать release evidence.

Ветка основана на текущей чистой композиции PROJ-31 (PR23); PR будет содержать только изменения PROJ-155 относительно этой ветки. Production публикация UI не входит в задачу.

## Verified locally

API: 55 passed; web: 77 passed; composition: 41 passed. Workspace typecheck, web lint, root build, layout and repository Primer policy passed. The direct external Primer scanner reports existing approved Sber-token/semantic-prop findings; the pinned repository policy accounts for those exact-file exceptions. No visual tokens were added.

The existing gateway SPA fallback serves /cabinet/; no older cabinet file exists on the VPS. CI covers its direct URL and reload. API-owned browser acceptance now uses the actual apps/web instead of legacy-landing.

GitNexus cannot resolve the dynamic callback-to-store call; source and mTLS/PostgreSQL tests supplement that boundary. Final indexing retains PDG. Review fixes cover blocking priority during session failure and safe unknown callback codes.
