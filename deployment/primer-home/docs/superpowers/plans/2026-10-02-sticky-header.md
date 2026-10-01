# Фиксация шапки при прокрутке — Implementation Plan

> **For agentic workers:** implement inline using superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** шапка остаётся сверху при прокрутке, переходы по меню показывают заголовок раздела ниже шапки.

**Architecture:** существующий SiteHeader получает position: sticky и top: 0. Его настоящая высота отслеживается ResizeObserver и задаёт scroll-padding-top страницы. Это сохраняет место шапки в потоке и работает при переносе мобильного меню; fixed потребовал бы отдельного заполнителя, обработчик scroll не нужен.

**Tech Stack:** React 19, Primer React 38, CSS и ResizeObserver.

## Global Constraints

- Только локальная версия, без GitHub/VPS; текущая ветка codex/PROJ-144-primer-home.
- Существующие компоненты Primer, фон и граница через семантические токены, без новой темы.
- Диалог записи выше шапки, прежнее выравнивание логотипа сохранено.

### Task 1: Sticky header

**Files:** src/layout.css, src/SharedLayout.tsx, evidence/verification.md.

**Interfaces:** SiteHeader({authorized?: boolean}); CSS --site-header-height содержит измеренную высоту header в px и удаляется при размонтировании.

- [x] Добавить `.site-header { position: sticky; top: 0; z-index: 1; }` и scroll-padding-top из --site-header-height. Нулевое геометрическое значение задано напрямую: токена --base-size-0 в Primer нет.
- [x] В SiteHeader измерить header по ref, обновлять высоту через ResizeObserver, отключить observer и удалить переменную при размонтировании.
- [x] Проверить TypeScript, ESLint, существующие тесты, Primer validator и git diff --check.
- [x] В IAB проверить scroll, переход к rules и раскрытие Dialog на desktop; прокрутку и отступ rules на 768/390 px; отсутствие переполнения. Сохранить доказательства и сбросить эмуляцию.
- [x] Сохранить только относящиеся к задаче файлы локальным коммитом PROJ-144.

Проверка спецификации: цель, границы и критерии результата определены; placeholders и новые продуктовые сценарии отсутствуют. Прямое поручение пользователя определяет поведение, дополнительное согласование не требуется.
