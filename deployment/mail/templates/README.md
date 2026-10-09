# Standalone email templates and previews

Eight HTML sources are pinned from PR8 (`465496e308f53821a0969f063290e61dc38936dc`),
owned by [PROJ-143](https://roadmap.astforum.ru/work_packages/PROJ-143).
`email.html` is the request-received template; `index.html` is its local preview.
`remaining/` contains the other six standalone templates. Open these sources
locally or serve this directory with a loopback static server to inspect them.

These are independent template source files. They do not replace Cal.diy's
runtime email renderer or configure SMTP. Repository checks parse all eight
files and verify their required HTML structure without sending email or
executing remote requests. Publishing/synchronizing them into an email system
requires its own source-to-rendered-output release proof. Their physical move
to the final mail owner is deferred to Task5.


Local resources belong to this template directory. `logo.webp` is the unchanged accepted Forum horizontal brand asset retained from the immutable accepted-source matrix; its SHA-256 is checked against the accepted pin after the original landing source retirement. Fragment preview actions are placeholders. External HTTP(S), mailto and data URLs are not fetched by offline verification. Template URL variables (whole `{{...}}` or `${...}` values) are placeholders, never local files. Verify all eight sources with `npm run test:mail` from the repository root; this sends no email.
