# Work carousel skills layout implementation plan

Исторический технический план от 2026-10-06. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-2026-10-06-work-skills-layout-887cc47d-RUuqyXwS9S).

Действующие требования: [PUB.01.01.04: Страница для физических лиц — работа и подработка](https://docs.astforum.ru/doc/pub010104-stranica-dlya-fizicheskih-lic-rabota-i-podrabotka-gXxA2IgKvD).

Происхождение: `docs/superpowers/plans/2026-10-06-work-skills-layout.md`, SHA-256 `887cc47deb3cdf9115b02759f831fd89418dfbb5991243148e7e71a71f35feb7`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> Execution: superpowers:executing-plans inline, one fresh whole-delta reviewer.

Goal: apply approved direction 2 and publish to dev.
Spec: docs/superpowers/specs/2026-10-06-work-skills-layout-design.md.
Baseline: 33f9064c641fe62f332cda9c84b03f8d26c83142.
Global constraints: existing branch/PR11, verified PROJ-147 and Kuzmina identity; Primer only, existing illustrations, stable carousel/auth semantics, IAB only, dev-only backed-up release.

## Task 1: Compose and verify the block

Files: deployment/audience-pages/src/WorkExamples.tsx, layout.css; project-root design-qa.md; deployment/audience-pages/evidence/work-skills-*.
Interface: unchanged WorkExamples() state/effect, WorkExample(image,title,items), group labels, live counter and control labels. Controls remain mounted.

- [x] Group shared heading/subtitle and active-slide h3/body in the left column. Move controls beneath text, keep illustration right and legacy ids. Remove obsolete header spacing rule.
- [x] Run existing 37 tests, typecheck/lint/build/package, Primer validator, four deploy tests. No new copy-mirroring tests for this reversible layout/text edit; existing tests verify behavior.
- [x] IAB local: desktop/mobile, cyclic arrows, keyboard focus, hashes, card auth dialog; source/render combined visual QA, save passed report and evidence.
- [x] Commit intended changes with PROJ-147; one fresh read-only reviewer, resolve material findings.

## Task 2: Publish and prove

Interface: dist/site owns four audience routes plus audience-assets. Existing deploy.py --preserve-homepage preserves independently managed root. Per-process SSH BindInterface=en0.

- [x] Push existing branch and update PR11 with all existing OP# refs; attach PR.
- [x] Capture fresh before fingerprints; upload unique release stage and match all bytes. Deploy with backup and --preserve-homepage. Verify all 28 served files over authenticated HTTPS; root/protected maps unchanged, gate/robots/health/session checks.
- [x] Live IAB screenshots and behavior; OpenProject GitHub links under Kuzmina. Commit evidence, push; verify local/remote/PR head equality and clean tree. Remove only this plan's ignored scratch.
