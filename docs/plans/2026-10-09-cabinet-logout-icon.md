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

Main advanced to `ad71174b6b677dd910d19db6f250c006723230c4` while the initial PROJ-160 integration candidate passed all 12 CI jobs (run 37979215004). It now includes PROJ-161/163, the requested header logout and the separate authenticated settings page. Preserve these application files exactly from current main, including the existing PROJ-163 provenance join and its cache invalidation between verification calls. The temporary PROJ-160 join for the previous main is superseded and removed from the final tree; its commit remains in history.

Keep the already verified 40-minute layout budget and update only its current digest in the PROJ-164 receipt. All predecessor hashes, current main's other receipts, CI commands and success gates remain unchanged. Rerun the full verification and frontend/composition tests on this merge, then require successful exact-head CI before merging PR #31 into main with ancestry intact.

Verify remote main contains both PROJ-160 heads, then set PROJ-160 to Closed under user 8 (kuzmina), reread its status/100% and GitHub links. This integration does not publish another server release.
