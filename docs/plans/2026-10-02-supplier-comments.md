# Supplier comments implementation plan

Исторический технический план от 2026-10-02. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-2026-10-02-supplier-comments-950fd21a-mMyq3eUN9N).

Действующие требования: [PUB.01.01.03: Страница для поставщиков и подрядчиков](https://docs.astforum.ru/doc/pub010103-stranica-dlya-postavshikov-i-podryadchikov-e2y4p3OOQ9).

Происхождение: `docs/superpowers/plans/2026-10-02-supplier-comments.md`, SHA-256 `950fd21aecc7e66987293a7d5318fc825a34f38ce03111aab04754462463c669`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

Goal: apply and publish all nine comments. Spec: docs/superpowers/specs/2026-10-02-supplier-comments-design.md. Primer/Light only, existing tokens and dependencies. Continue codex/PROJ-145-audience-pages / PR #11, primary OP#PROJ-146.

## Task 1: Four directions and shared sections

Files: deployment/audience-pages/src/{audience-content.json,AudiencePage.tsx,intent.ts,Participation.tsx,intent.test.ts,audience.test.tsx}.
Contract: existing Intent adds design/construction/leasing; strict validation and labels retain legacy services. Existing onAction and onDemo interfaces stay intact.

- [x] RED: extend persistence tests for four supplier directions plus legacy services; verify each new card retains direction through handoff and final CTA, reject unknown directions.
- [x] Implement four cards and requested copy/removals; reuse RulesSection/DemoSection and company demo context.
- [x] GREEN: typecheck, lint, behavior suite, build/package, 3 deployment tests and Primer validation.
- [x] iab responsive and keyboard checks; compare standard sections with the live homepage.
- [x] Independent final review, fix material findings, commit PROJ-146 changes. Review: Critical 0 / Important 0 / Minor 0.

## Task 2: Publish and link

Files: evidence/supplier-comments.md and verification JSON. Interface: dist/site -> unchanged scripts/deploy.py.

- [x] Upload and deploy with backup; verify every served file, homepage/gate and production hash.
- [x] Verify published supplier page after reload in iab and save screenshot.
- [x] Commit evidence, push all task commits, update/attach PR #11 and verify OpenProject GitHub links and remote head. Four links verified under Кузьмина; remote head is checked after the final evidence push.
