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
- [ ] Получить успешный exact-head CI artifact; проверить manifest и полный inventory, опубликовать через web_release.py с backup и CAS, сравнить origin/public HTTPS hashes и проверить страницу после reload.

CI layout uses a 40-minute budget after both exact-head runs reached the former 20-minute limit during repository regressions. All commands and success gates stay intact; only the current workflow digest is refreshed in the governance receipt.
