# Accepted source matrix

Reviewed base: `510939a854169467c25aa9dbdb771ab1beb906c8`. Task: [PROJ-152](https://roadmap.astforum.ru/work_packages/PROJ-152).

The JSON sibling records each exact source SHA, path, Git blob, mode, content SHA-256, candidate path/hash/mode and source-relative delta. Existing reviewed fixes take precedence over historical blobs. No whole source branch was merged.

| Component | PR | Pinned source | Candidate entries | Historical/superseded |
| --- | --- | --- | ---: | ---: |
| repository-policy | 3 | `4c76633c0a424e94752bc5fbdfcb832b6a13449b` | 1 | 1 |
| legacy-landing-gateway | 4 | `8833c8604e96a437ff4a8b8294e038567544ebec` | 110 | 0 |
| api-db | 5 | `5084b30b0be5c3939870be8fdadd9643cd9af0a0` | 55 | 0 |
| server-infrastructure | 6 | `a75924cb7b715f9bd0d958bc812438389d090094` | 33 | 12 |
| pgadmin-baseline | 7 | `a07a9a0d475d06e391a2c635b572237f33b76a71` | 0 | 16 |
| email-templates | 8 | `465496e308f53821a0969f063290e61dc38936dc` | 8 | 0 |
| maintenance-tools | 9 | `8b8d14886fb7709938ad46976e21a1c1206c9466` | 0 | 21 |
| vps-staging-archive | 10 | `00a47c2acdfd1e6e3f92ce4fb00b1046a40f3b45` | 0 | 177 |
| audience-pages | 11 | `2b85a4162bbd1a64703dab6da6ab787e469516fb` | 57 | 71 |
| primer-home | 12 | `b332db9dc9666c2110403e447d2b46c30675a5dc` | 41 | 58 |
| public-auth | 13 | `e9b9331d32c2a11fe7da6391fe01b6cfba8f9f60` | 25 | 29 |
| profile-preview | 14 | `acd3583c369752107b158b317545e17c966588e9` | 20 | 2 |
| pgadmin-connections | 16 | `9e4666fbd5cddef9d3d4a6b24c286f7a75557ac6` | 4 | 0 |

PR6 includes all seven unchanged production-static blobs; parent private server comparison matched their Git blobs and SHA-256. Its mail/Outline configs and Caddy are selected by exact observed source. PR16 supersedes PR7 pgAdmin. The PR13 DNS override is the exact observed resolver contract; TLS/hostname validation remains in the reviewed API. Profile is a fixture; standalone email HTML does not replace Cal.diy. No old bulk-apply/generator job or staging archive is promoted.

Unique PR10 additions, PR9 one-off scripts, rejected logos/landing variants, old access scripts and excluded evidence remain in pinned Git history and the existing private whole-tree backup/all-ref bundle with restored-clone proof. Preserved-ref digest: `a0bde28a3fdebf50ddee41d684ca2db3e21b3a4319c2d8e6e3531cc7d72b8674`. No source PR is closed by this stage.

Parser cancellation: 176 original paths privately compared; README/.gitignore plus reviewed Task2 root composition package/lock overlap; root scripts contain only Vitest test:composition. No parser source, tests, migrations, runtime config or package jobs were restored. Public API legacy company schema and a common OKVED reference are separate from the cancelled parser. No sandbox-to-public IAM migration occurs.

The original source inventory is a historical capture, not current accepted counts. This matrix does not claim production deployment, live account/permission changes, provider sign-in, current OpenProject tabs, or fresh Outline preservation. Parent owns those gates. Task5 moves owners; Task6 preserves product material in Outline; Task7 verifies publication; Task8 governs source cleanup.
