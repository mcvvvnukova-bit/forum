# Customer landing implementation plan

Исторический технический план от 2026-09-30. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-customer-landing-implementation-plan-657b3873-PkOys3OdfZ).

Происхождение: `docs/superpowers/plans/2026-09-30-customer-landing.md`, SHA-256 `657b387368e07826217b30f758c1c398c5b796ce7a61ae9421a91a53a0d8da6f`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Реализовать страницу PUB.01.01.02 в стиле существующего dev.astforum.ru.

**Architecture:** Отдельный React entry point и HTML для `/customers/`; общие токены, CSS шрифтов и session hook из действующего проекта. Диалоги и раскрытия используют Primer, направления сохраняются до переходов, отсутствующие рабочие сценарии сообщаются явно.

**Tech Stack:** React 19.2.8, Primer React 38.37.0, Vite 8.2.2, TypeScript 5.9.2, Vitest 4.1.11.

## Global Constraints

- Текст и порядок блоков — PUB.01.01.02, источник в спецификации.
- Только существующие токены оформления и светлая тема; без новых UI библиотек.
- Не менять роль и права участника, не придумывать реквизиты и рабочие функции.
- Сохранить изменения пользователя и общую главную.
- Не создавать тестовую регистрацию или бронирование во внешних сервисах.

### Task 1: Customer page and action boundaries

**Files:** Create `deployment/dev-landing/src/customers/{CustomerLanding.tsx,CustomerLanding.test.tsx,customer-content.ts,customer-screen.css,main.tsx}` and `deployment/dev-landing/customers/index.html`. Modify `src/landing/use-landing-session.ts`, `vite.landing.config.ts`, `scripts/finalize-landing-build.mjs` and a customer link in `src/landing/LandingApp.tsx` only.

**Interfaces:** `CustomerLanding({destinations?: {registration?: string; newOrder?: string}})` consumes the real session response, with optional participant `{id,status,role}`. It renders public content and Primer Dialog; destinations default to unavailable. `customerDemoUrl` is a public Cal URL carrying customer audience.

- [x] Add tests demonstrating registration company selection, preserved intent, explicit provider-role handling, customer continuation, FAQ and demo audience.
- [x] Run `npx vitest run src/customers/CustomerLanding.test.tsx`; expect failure because customer implementation is absent.
- [x] Implement the page and dedicated HTML route. Bind semantic CSS values to the existing `--landing-*` tokens. Keep all expected copy in `customer-content.ts`.
- [x] Run `npm run typecheck`, `npm run test:frontend`, `npm run test:gateway`, `npm run build`; expect all to pass.
- [x] Open the built page in iab and verify 1440/768/390 px, questions, main CTA, dialog keyboard behavior, customer demo parameter and valid assets. Run the Primer validator and record any baseline-only failures.
- [x] Publish the isolated `/customers/` output and its hashed assets on the existing dev host, preserving current main landing and gateway. Verify saved route through iab.

## Review focus

No silent role changes; no invented registration/order/contract capabilities. Deep-link route must survive reload and use absolute assets. Deployment must preserve remote main page. Unknown session/error states must retain customer intent.
