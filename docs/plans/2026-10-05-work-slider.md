# Work slider implementation plan

Исторический технический план от 2026-10-05. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-2026-10-05-work-slider-8170459f-Jy46WOFBxM).

Действующие требования: [PUB.01.01.04: Страница для физических лиц — работа и подработка](https://docs.astforum.ru/doc/pub010104-stranica-dlya-fizicheskih-lic-rabota-i-podrabotka-gXxA2IgKvD).

Происхождение: `docs/superpowers/plans/2026-10-05-work-slider.md`, SHA-256 `8170459f9833b6e1caf45f5c6b14b342c7828c0868c0cb8befc4cec506a07a52`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Apply six work-page comments and publish the reviewed result to dev.
**Architecture:** WorkPage owns saved auth format and starts explicit intents; WorkExamples owns independent manual slide state/hash handling; WorkExample supplies accessible native image equivalents.
**Tech Stack:** React19.2.8, Primer38.37.0, Octicons19.33.0, Vite8.2.2, Vitest4.1.11.

## Global Constraints

Spec: docs/superpowers/specs/2026-10-05-work-slider-design.md. Existing branch/worktree/PR11, taskPROJ-147, parentPROJ-29; base0078a76. Reuse existing Light tokens and components. Keep auth URLs/resume contract and production unchanged. No new dependencies or generated images. User corrections and established dev publication authorize execution. One final fresh reviewer for this delta.

### Task 1: Slider and direct auth actions

Files: create deployment/audience-pages/src/WorkExamples.tsx; modify WorkPage.tsx, WorkExample.tsx, layout.css, audience.test.tsx.
Interfaces: WorkExamples() has independent slide state (orders|jobs), recognizes #skills/#order-example/#job-example; WorkPage onAction(intent,trigger) receives explicit valid individual format pairs. Existing WorkExample(image,title,items) remains compatible.

- [x] Replace obsolete work filtering tests with behavior tests, retaining supplier/customer coverage. Each explicit card button opens the real App Dialog and persists the correct literal tuple; switching opposite card after return catches stale state. A table covers orders/find-orders and jobs/find-jobs. Assert the carousel has one current group, Next advances order→jobs→order, Previous wraps order→jobs, and sliding does not alter the last auth intent. Initial #job-example and hash changes select the proper example.
  Example: `fireEvent.click(screen.getByRole('button',{name:'Выбрать вакансии'})); expect(screen.getByRole('dialog')).toHaveTextContent('Поиск вакансий'); expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({action:'find-jobs',direction:'jobs'});` Run npm test; expected new behavior cases fail, old supplier/customer/intent/resume cases pass.
- [x] Implement WorkPage `start(selected)` with explicit choice; CTA uses `()=>start(format)`; card action saves choice then `start(choice)` in the same click. Implement manual WorkExamples using Primer IconButton/Stack/Text/Heading and `useState<'orders'|'jobs'>`; Next/Previous use functional state inversion. A hashchange effect selects recognized legacy hashes and scrolls the carousel after content update when navigated by hash. Current slide has group/slide semantics and native illustrated content; controls keep focus. Move visible caption title into VisuallyHidden. Remove exactly the first sentence. Add token spacing layout only.
- [x] Run typecheck/lint/full tests/build/package and Primer validator; Python deploy tests, including preservation of an independently managed homepage. Expected all pass, documented pre-existing token/build warnings only. IAB1608/768/390/320; both card Dialog contexts and return focus, keyboard carousel controls, captions not visible, no overflow, headings/images/hash behavior.
- [x] Commit PROJ-147 intended paths/docs/evidence. One fresh read-only reviewer against0078a76..HEAD, focusing stale auth state, hash events, screen-reader hidden content and keyboard focus. Resolve important findings with RED→GREEN verification.

### Task 2: Publish and prove integration

Files: deployment/audience-pages/evidence/work-slider-{local,deployment,served,published,openproject}.json and work-slider.md; plan checkbox completion.
Interfaces: existing dist/site owns four routes+audience-assets; deploy.py(source) preserves root except existing callback marker and returns backup+SHA map. Per-process ssh BindInterface=en0; no persistent networking changes.

- [x] Capture root/production/protected fingerprints and upload unique work-slider release directory; compare every staged file with dist. Run backed-up audience deploy with explicit --preserve-homepage (current root uses the independently published public-auth callback). Verify all28 files over authenticated HTTPS, root/production/auth/config unchanged and exactly one root resume marker. IAB live controls/FAQ/illustrations and screenshot. Expected byte equality and correct new behavior.
- [x] Commit evidence, push existing branch, update/attach PR11 with all existing OP# refs, verify GitHub-tab links underKuzmina forPROJ-147/29 plus preserved145/146 refs; check local/remote/PR head equality and clean tree. Complete checkboxes and remove only this plan's ignored scratch.

## Review Focus

Stale React format on the same click; slide changes accidentally changing auth intent; unavailable sessionStorage; legacy hash navigation and scroll; hidden native facts only for current slide; controls remaining focused; actual dev package ownership and preserved homepage callback marker.
