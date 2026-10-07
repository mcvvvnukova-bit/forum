# Технические доказательства

`repository-audits/` хранит audit findings, immutable source pins, текущую карту владения исходниками и sanitized migration receipts. `releases/` хранит датированные observed manifests и verified release manifests согласно [контракту](../deployment/release-manifest.schema.json).

Разрешены source/candidate paths, full commit/blob/SHA hashes, стабильные Outline page/attachment URLs, состояния и timestamps проверок, task links, команды/результаты технических проверок и явно отмеченные ограничения. Immutable source pins и исходные observation dates не заменяются актуальными значениями; новая проверка получает отдельную запись. Candidate ownership/path/hash обновляется при техническом переносе.

Продуктовые тексты, требования, дизайн-копии, архивы исходных документов и binary originals сохраняются в Outline; Git receipts содержат только разрешённую provenance. Raw delivery/access reports, dumps, cookie/session responses, uploads, secrets, signed upload forms, credentials, personal/user data, cache, generated build folders и временные screenshots сохраняются приватно вне Git или удаляются по отдельному решению. `artifacts/` не является обходным product archive.

Перед добавлением записи проверить её назначение, источники, строки и метаданные; отсутствие слова password не заменяет санитарный просмотр. Не использовать прошлый source parity/observed receipt как доказательство свежего release. [Миграция документации](repository-audits/document-migration-manifest.json) хранит per-source completion и lineage, не содержание источника.
