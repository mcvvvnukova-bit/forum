# Sber ID Primer Token Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three PDS004 findings through the explicitly approved Sber ID token source while preserving the button appearance and all other Primer checks.

**Architecture:** Keep the existing Sber CSS token exports and their bindings to Primer Button unchanged. Commit an unchanged snapshot of the current Primer validator, a small project entrypoint with exact approved token paths, and negative regression tests; run that same entrypoint locally and in the existing web CI job.

**Tech Stack:** Python standard library, Node.js 24, npm workspaces, Primer React 38.37.0, Primer Primitives 11.10.0, GitHub Actions.

## Global Constraints

- Work package: [PROJ-154](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-154); parent: [PROJ-35](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-35). API identities are 192 and 72 respectively; OpenProject actor is user 8, `kuzmina`.
- Owner approval on 2026-10-07: preserve Sber ID appearance and allow exactly `apps/web/src/auth/sber-tokens.css` as the provider token source.
- Preserve all existing application, CSS, font, SVG and media bytes. Light mode, Primer components, authentication behavior and routes stay unchanged.
- Preserve the existing Forum token export allowance. Provider permission applies only to root-scoped CSS custom-property exports, never element styling or another file with the same basename.
- Do not modify the installed global skill or depend on `/Users/vvv/.codex`, another checkout, untracked files, network downloads or a runtime package install to run the project gate.
- Snapshot source: `/Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py`, 105142 bytes, SHA256 `c926222170bb455281ebc2c6f2f279d75ef44143b7e41b18ea0fe0d0841a88e7`; preserve its bytes and rules.
- Base application validation: 3 PDS004 errors at `src/auth/sber-tokens.css:7–9`, and 71 PDS007 warnings. The warnings remain visible and are not removed or declared resolved.
- Root lockfile/workspace ownership and strict `docs/plans/` structure remain intact. Product descriptions belong in Outline.
- No Cal.diy reconstruction, OKVED parser work, live authentication change, production publication or application refactoring belongs to this task.

## Task 1: Reproducible exact-file Primer gate

**Files:**
- Create: `scripts/verification/primer-ui/validate_primer_ui.py` — unchanged vendor snapshot.
- Create: `scripts/verification/primer-ui/policy.json` — source provenance and approved token paths.
- Create: `scripts/verification/check-primer-ui.py` — small project command.
- Create: `tests/integration/test_primer_ui_policy.py` — acceptance and negative boundaries.
- Modify: `package.json`, `.github/workflows/quality.yml`, `scripts/verification/repository-layout.json` — commands, web CI gate, tracked source contract.
- Create: `artifacts/repository-audits/2026-10-07-sber-primer-token-policy.json` — factual controller verification receipt after the code review.

**Interfaces:**
- Consumes: the pinned validator's `scan_project(root, allowed_token_globs)` and CLI JSON findings (`severity`, `code`, `path`, `line`, `message`).
- Produces: `npm run check:primer` (full `apps/web` scan; errors fail, warnings printed), `npm run test:primer` (standard-library unittest regressions), and equivalent direct Python entrypoints.
- Entrypoint may expose `--root` for isolated fixture roots and `--format {text,json}`. It must not expose arbitrary token-file permissions or forward unknown arguments to the vendor CLI.
- Approved paths relative to the web root are exactly `src/home/forum-tokens.css` and `src/auth/sber-tokens.css`, without glob wildcards. Token values remain in the already existing files.
- Configuration/source/integrity/read errors fail with nonzero status and a useful diagnostic. Warning findings stay in the output.

- [ ] **Step 1: Establish the baseline and write discriminating regressions.**

Use a temporary minimal web project with real Primer dependencies/imports and a real valid Light root composition. Test the scanner rather than mocking it. Cover these scenarios:

| Input / action | Expected result |
| --- | --- |
| Existing Sber root exports with project policy | No PDS004; existing full-project PDS007 warnings still visible |
| Same source with vendor defaults only | Three PDS004 on the Sber export lines |
| Add a hex color to a component style or ordinary CSS file | PDS004 and nonzero project command exit |
| Add `:root { --sber-button-rest: #21a038; }` in a different `sber-tokens.css` path | PDS004; basename does not grant permission |
| Add `.arbitrary { color: #fff; }` inside the approved Sber file | PDS004; file permission does not excuse component styling |
| Existing Forum root exports | Still accepted |
| Run direct script from another working directory | Same scan target and result |
| Invalid command option, unreadable root, invalid policy or snapshot mismatch | Nonzero result; no false success |

Run the focused test before creating the entrypoint; retain the expected failure as RED evidence.

- [ ] **Step 2: Copy and pin the existing scanner without changing its implementation.**

```python
from hashlib import sha256
from pathlib import Path
source = Path('/Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py')
data = source.read_bytes()
assert sha256(data).hexdigest() == 'c926222170bb455281ebc2c6f2f279d75ef44143b7e41b18ea0fe0d0841a88e7'
target = Path('scripts/verification/primer-ui/validate_primer_ui.py')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(data)
```

Record the snapshot SHA256, original source name, approval date, exact allowed paths and official Sber reference `https://developers.sber.ru/docs/ru/sberid/guidebook` in `policy.json`. The committed copy is the executable source in clean CI; the local source path is historical provenance only.

- [ ] **Step 3: Implement the project gate and integrate it.**

Resolve the repository/web paths from the entrypoint file, load the committed policy and verified vendor implementation, and invoke the existing scanner with the exact token paths. Preserve the original error/warning contract. Use the same `npm run check:primer` and `npm run test:primer` commands in the existing `frontend` job when `matrix.package == 'web'`. Add the new scripts/tests/source files to the repository layout ownership contract. Keep package-lock dependency content unchanged.

- [ ] **Step 4: Run the task verification suite.**

```bash
npm run test:primer
npm run check:primer
npm run check:layout
node --test scripts/verification/checks.test.mjs
npm run typecheck --workspace @astforum/web
npm run lint --workspace @astforum/web
npm test --workspace @astforum/web
npm run build --workspace @astforum/web
npm run test:composition
npx --no-install playwright test --config tests/e2e/public-site.config.ts
```

Expected: policy regressions pass; full Primer output has zero errors and the same 71 PDS007 warnings; layout, frontend/composition and built-browser checks pass. Preserve logs in this plan's ignored SDD directory. Compare application source hashes to base to prove the CSS and component bytes did not change.

- [ ] **Step 5: Inspect real rendered states in the in-app browser.**

Controller verifies `/login` and `/register`, narrow/mobile/tablet/desktop widths, rest/hover/pressed/focus/loading/disabled and keyboard/focus behavior using controlled local fixtures with no real provider submission. Record computed font size/weight and contrast from rendered foreground/background. For the retained 19px bold label, verify the applicable WCAG AA large-text threshold; the existing backgrounds with white have calculated contrast approximately 3.415 and 4.125. Source: `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html`. Screen-reader and full Forum alias verification must be labelled unverified unless actually performed. Existing Forum appearance is preserved; this approval concerns the provider source only.

- [ ] **Step 6: Commit, independent review and publish the branch.**

Before edits, check GitNexus impact and direct source references; before each commit, run staged `detect_changes`. Use commit messages containing `PROJ-154`. Independent reviewer checks specification and quality, followed by whole-branch review. Push `codex/PROJ-154-sber-token-policy`, create a PR against `main`, include both `OP#PROJ-154` and `OP#PROJ-35` in its description, attach it to the current Codex chat, and verify both actual OpenProject GitHub tabs and the exact candidate CI. Preserve the worktree for PR iteration.

## Definition of Done

- All three PDS004 findings are resolved under the explicitly approved, narrow project policy.
- All unrelated Primer rules and the 71 existing PDS007 warnings are retained.
- Local and clean GitHub CI execute the same tracked implementation and policy.
- Negative tests prove that arbitrary colors, sibling token filenames and component styles remain rejected.
- Application source bytes are unchanged; scoped browser/contrast evidence and unverified manual limits are reported accurately.
- Commits, pushed branch, passing candidate CI, PR attachment and verified links to PROJ-154 and PROJ-35 exist.
- PR merge and production rollout require a subsequent explicit integration decision.
