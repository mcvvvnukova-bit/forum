# Audience review: suppliers, work and shared chrome

User comments 1–25 are the approved design input; the earlier vacancy “soon” decision is superseded by comment 14. Publish to dev immediately under the existing PR workflow.

- Suppliers (1–4): first FAQ ends after «доступные вашей компании.»; cost «Работа на платформе бесплатна.»; amendments «Зависит от вида тендера и условий, определяемых организатором тендера.» Final CTA uses the customer's muted Card, horizontal desktop copy/action and one primary action.
- Work (5–10,12–15,17–23): remove hero registration note, format note, unavailable-staff label/banner/copy and example labels/disclaimer in skills. Hero/action is «Найти работу», both formats are active choices. Merge skills intro with the order example. Vacancy section heading «Официальное трудоустройство в штат». Keep one common five-step sequence for orders and vacancies. FAQ exact requested Sber ID/both-scenarios/platform copy. Final CTA uses the same composition, omits Sber note and «предлагайте свои условия».
- Illustrations (11,16): two transparent landscape illustrations of a Primer Light order/vacancy interface, matching the existing homepage hero's black-outline/gray/orange style. Built-in image_gen; no new design tokens. Preserve human-readable text equivalents for image details. These are illustrations, not live submissions.
- Shared chrome (24–25): use the existing measured logo alpha offset for footer as well as header; rename shared nav item «О платформе», retain /#rules. Apply to audience pages and the separately built homepage so headers remain consistent.

Work choices retain sessionStorage format and dispatch distinct personal intents: orders/find-orders, jobs/find-jobs, no chosen format/find-work with absent direction. Only these three exact combinations can resume through the existing Sber callback; returnTo remains /work/. Participation displays the selected route without mapping jobs to procurement. Existing authentication URLs and server services are retained. This request revises the public page, not the server-side employment module.

Use only existing Primer components/Forum Light token bindings. No fixed heights, new UI dependency, internal Primer selectors, arbitrary brand mapping or production publication. Adapt existing behavior tests and add meaningful intent/resume cases for jobs and generic search; do not add copy-mirror tests.

Tasks verified as Кузьмина8: PROJ-146 (184), PROJ-147 (185), PROJ-144 (182), parentPROJ-29 (66). Continue audience branch/PR11; continue homepage branch/PR12 in clean managed checkout. Verify both PR links and heads after push. Home publication preserves existing audience callback marker, audience routes, auth/API/gateway/config and production. Both releases have backups and actual served-file checks.

Acceptance: all25 comments mapped above; desktop/tablet/mobile1679/768/390/320 without overflow; keyboard format/action/FAQ/focus; both generated assets load with transparent margins; all affected live pages share nav label/footer alignment. Screen-reader semantics inspected; full VoiceOver/external Sber/real vacancy submission are outside the manual check.
