# Compact login dialog implementation plan — PROJ-170

> **For agentic workers:** Execute inline with GitNexus direct-mode impact and change gates. The user selected and authorized variant 1 in the source chat; no new visual exploration is needed.

**Goal:** Implement the first displayed login design in the shared public authentication window.

**Architecture:** Keep `PublicAuth` and its existing authentication/navigation state machine. Compose the compact header from Primer Stack, Heading and IconButton so it has no built-in header divider; retain Primer Dialog and its scroll, focus and Escape behavior. Layout and typography use existing Primer tokens; Sber keeps its supplied artwork, font and provider tokens.

**Tech Stack:** React 19, Primer React 38.37, Primer Primitives, Octicons, Vite, Vitest.

## Global constraints

- Source: first displayed image in `codex://threads/01a1227a-f631-7ea2-b538-7632cb3021e9`, `exec-8c16d00a-9921-4442-9f9b-b367a72b11c4.png`.
- Primer Light only; no new Forum mappings, assets, dependencies, providers or routes.
- Heading left, full-width Sber button, secondary explanation below it: «Нет аккаунта? Он будет создан автоматически после входа.»
- Preserve loading, duplicate-click protection, guest/authenticated/unknown sessions, callback errors, support links, history and opener focus.
- OpenProject: PROJ-170, API id 208, parent PROJ-31, API id 68. Branch `codex/PROJ-170-login-option-1`.

## Task 1: Shared compact window

**Modify:** `apps/web/src/auth/PublicAuth.tsx`, `apps/web/src/auth/auth.css`.
**Consumes:** existing `PublicAuth({navigate?})`, `ModalHeader(DialogHeaderProps)`, Primer Dialog render callbacks.
**Produces:** same exported component and authentication contract; compact presentation.

- [x] Replace `Dialog.Header` with a horizontal `Stack` containing `Heading as="h2"` linked to `dialogLabelId` and the existing close IconButton. Link `Dialog.Body` to the description id supplied by Primer.
- [x] Set Dialog `width="large"` (480 px in installed Primer), cap its width to viewport minus 32 px and allow shrinking below Primer's 296 px minimum.
- [x] Add `block` to the Sber Button, preserve provider tokens, use 56 px minimum height via existing base-size tokens.
- [x] Apply shared 24 px content edges, token-based heading typography and secondary paragraph styling. At narrow widths use medium title typography. Replace only the automatic-account explanation copy.
- [x] Run existing web tests, composition tests, typecheck, lint, build and Primer/layout validation. This reversible presentation change needs no test that merely duplicates implementation; existing behavioral regressions and browser visual checks cover acceptance.
- [x] Run local preview; use Codex IAB to verify 320, 390, 768 and desktop widths, keyboard containment, close/Escape, history/reload, enabled/disabled/loading/error states and console errors. Compare normalized source and actual screenshots and save `design-qa.md`.
- [ ] Refresh GitNexus, stage only these task files, run `detect_changes`, commit with PROJ-170, push, create PR with `OP#PROJ-170` and `OP#PROJ-31`, verify the GitHub tab in both OpenProject packages and attach PR to this chat.

## Review

Product scope is one existing shared window with two implementation files. Existing copy/policy snapshots are adjusted; the required ownership checker and its tampering tests gain an exact PROJ-170 successor receipt without changing historical receipts. No authentication architecture changes or deployment are required. Pixel scale of the generated source is normalized to a 480 px dialog; underlying landing content is retained from the current product. Acceptance requires a running preview, documented visual comparison and verified PR linkage.
