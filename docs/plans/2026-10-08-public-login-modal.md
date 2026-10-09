# Public login modal implementation plan

> **For agentic workers:** Execute the tasks sequentially in this chat, with regression tests before implementation.

**Goal:** Follow the approved navigation map: all public entry CTAs open the shared `/login` modal over their current page.

**Source:** https://docs.astforum.ru/doc/karta-perehodov-publichnoj-chasti-pQHZ5JZyJI (updated 2026-10-07). Work package: OP#PROJ-31.

**Architecture:** Audience CTA handlers use the existing public navigation event. The authentication controller consumes that event, clears obsolete participation intent, and remembers the opener for focus restoration. Homepage configuration points Start to `/login`. Registration remains available inside the shared form and at its direct URL. Demo, policy, audience and in-page links keep their existing behavior.

1. Add regression coverage for every customer, supplier and work CTA, both homepage entry links, history/background preservation and stale intent cleanup. Run it against the current implementation and confirm failures.
2. Replace audience-specific participation dialogs with the common login entry. Extend the shared navigation event with the opener and connect the authentication controller. Update homepage defaults and release configuration.
3. Update superseded participation-dialog tests; retain carousel, demo and standalone authentication coverage. Run web typecheck, lint, unit tests and composition tests, plus required repository checks.
4. Refresh the GitNexus graph, review staged effects, commit with PROJ-31, push and create a linked PR. Verify OpenProject integration.
5. Publish the successful exact-head CI dev artifact through the atomic publisher. Revisit all ten documented routes in the in-app browser, check all entry CTAs, close/back behavior and preserved demo/policy links.

**Acceptance:** One login dialog per entry action; no company/worker registration dialog; `/login` URL; unchanged background and return URL; focus restored to the actual opener; registration switch and standalone URLs still work.
