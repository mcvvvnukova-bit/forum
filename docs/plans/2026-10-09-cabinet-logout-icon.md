# Cabinet Logout Icon Implementation Plan

> **For agentic workers:** Execute inline with gitnexus-work direct mode; this is a single bounded presentation change.

**Goal:** Перенести выход в шапку рабочего кабинета и удалить нижнюю строку по запросу владельца.

**Architecture:** ProfilePage продолжает получать существующий account.onLogout. Primer IconButton в шапке вызывает тот же обработчик; footer отображается только без account.

**Tech Stack:** React 19, Primer React 38.37.0, Octicons, Vitest, существующий web release publisher.

## Global Constraints

- Задача OP#PROJ-160; отдельная ветка и PR поверх текущего опубликованного PR #30.
- Не менять API, OAuth, сессии, БД, production или независимые страницы preview.
- Использовать Primer Light и существующие семантические токены; aria-label «Выйти», disabled и aria-busy при выходе.

## Task 1: Header logout and dev publication

**Files:** `apps/profile-preview/src/ProfilePage.tsx`, `apps/web/src/home/cabinet.css`, существующая проверка в `apps/web/src/home/home.test.tsx`.

**Interfaces:** Существующий `ProfilePageProps.account` и `account.onLogout: () => void`; сигнатуры не меняются.

- [x] Добавить `SignOutIcon` и `IconButton` после ссылки имени в горизонтальный Primer Stack; удалить footer для account.
- [x] Обеспечить перенос имени и уменьшение логотипа на ширине до 360px.
- [x] Обновить существующее ожидание футера: кнопка в banner, пустой textContent, svg присутствует, contentinfo/«Физлицо»/«На главную» отсутствуют.
- [x] Выполнить web/profile typecheck, lint и тесты, Primer validator; проверить desktop/tablet/320px в Codex iab.
- [x] Проверить diff и GitNexus detect_changes, commit/push, создать PR с OP#PROJ-160 и OP#PROJ-5, прикрепить его и проверить OpenProject linkage.
- [x] Получить успешный exact-head CI artifact; проверить manifest и полный inventory, опубликовать через web_release.py с backup и CAS, сравнить origin/public HTTPS hashes и проверить страницу после reload.

CI layout uses a 40-minute budget after both exact-head runs reached the former 20-minute limit during repository regressions. All commands and success gates stay intact; only the current workflow digest is refreshed in the governance receipt.

## Integration into main

The requested merge joins published PROJ-160 head `761407cb926937ad3431304ddf6ba884518c2eca` with main `07600076bac07037a5ec22f9405b89d2fbbf7c09`, which contains PROJ-164 CI selection and invocation-scoped receipt caching. Preserve the application source from the published branch and the CI selection/gate from main, with the verified 40-minute layout budget.

Resolve the parallel provenance owners through a new exact-path PROJ-160 integration receipt. Pin both parent versions, validate the merged bytes and modes, and keep each inherited receipt at its already accepted version without rewriting predecessor hashes. Cache all receipt readers only within one verification call, so a changed root, receipt, or source is rechecked. Regressions reject altered parents, predecessor hashes, current bytes, scope, modes and duplicates; existing CI and profile ownership rejection tests remain active.

Run the complete repository verification and frontend/composition tests before committing the integration. Retarget PR #31 to main, require successful full candidate CI, merge with ancestry intact, and verify remote main contains both PROJ-160 heads. Then set PROJ-160 to Closed/100% under user 8 (kuzmina), reread it and verify its GitHub links. This integration does not publish another server release.
