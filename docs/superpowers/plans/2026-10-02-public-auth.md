# PROJ-31 Public Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести вход/регистрацию всех публичных страниц dev к текущей PUB.02.02.

**Architecture:** Изолированный общий Primer-компонент и адаптер ссылок независимых публичных приложений. Существующий IAM обеспечивает идентификацию; UI не сохраняет исходную цель. Деплой атомарно добавляет ресурсы и включение компонента в текущие HTML.

**Tech Stack:** React 19.2.8, Primer React 38.37.0, Primitives 11.10.0 Light, Vite 8.2.2, Vitest, Python.

## Global Constraints
- Task OP#PROJ-31; branch codex/PROJ-31-public-auth-form; only dev.astforum.ru.
- Exact current Outline copy and only Сбер ID; no participant selection or stored origin/action.
- /login and /register direct pages use the same component as Primer Dialog.
- Never treat failed session check as anonymous; no automatic OAuth retry or registration.
- No IAM secrets, credentials, production edits, fake accounts or new UI library.

---

### Task 1: Shared form and public-link adapter
**Files:** deployment/public-auth/src/{PublicAuth.tsx,PublicAuth.test.tsx,session.ts,session.test.ts,main.tsx,auth.css}.
**Interfaces:** PublicAuth({navigate?: (url:string)=>void}); checkSession(signal:AbortSignal): Promise<SessionState>. Provider URL is /auth/sber-id/start?intent=login or /auth/sber-id/start?intent=register&subject=individual.
- [ ] Write consumer tests: clicking public login opens dialog and /login; switching register changes label and IAM request; direct /register is page; errors block or offer retry/support. Test missing/malformed session and timeout with an HTTP fake only at fetch boundary.
- [ ] Run npm test; verify missing component fails, then implement minimal component and rerun.
- [ ] Use capture click interception only for unmodified same-origin auth links. Replace corresponding hrefs so modified clicks/bookmarks also use /login and /register. Push modal entry once; replace on mode switch; popstate closes; Dialog returnFocusRef returns focus. Before IAM clear only legacy public-intent keys.
- [ ] Run npm run typecheck, npm run lint, npm test, npm run build and Primer validator.
- [ ] Commit: PROJ-31: add shared public login and registration forms.

### Task 2: Reversible publication and verification
**Files:** deployment/public-auth/scripts/{deploy.py,test_deploy.py}, README.md, evidence/verification.md.
**Interfaces:** deploy(source:Path,target:Path,backups:Path)->report; compiled manifest and index from Task 1.
- [ ] Write tests that deploy on fixture HTML, retain content, remove obsolete callback resume marker, include all public routes and standalone routes, preserve unrelated files, prevent duplicate loaders, restore files on failure.
- [ ] Run python3 -m unittest discover -s scripts -p 'test_*.py'; implement against failures.
- [ ] Upload built resources and script to forum-prod; back up target HTML before writes; atomic copy hashed resources and modified HTML; use no server restart. Store report with commit and sha256.
- [ ] Verify origin/HTTPS HTML/resources and private dev gateway; production fingerprint unchanged. Test IAB all four public routes, direct /login and /register reload, switch/back/close and 360/tablet/desktop keyboard.
- [ ] Commit result, push branch, create PR with OP#PROJ-31, attach artifact, verify GitHub tab in OpenProject.
