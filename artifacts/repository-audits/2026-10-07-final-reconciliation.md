# PROJ-152: сверка перед завершающей очисткой

Срез 7 октября 2026 года. Этот офлайн-аудит сверяет сохранённые контроллером доказательства Task7 с исходниками `e513872ce218357c77b1f7381c26e57c6de66e79` и готовит Task8 к ревью. Он **не завершает очистку**, не утверждает принятие новой main и не меняет прежние observations 6 октября. Принятая main в момент входных данных — `a56b52ed05a5f1fbe267dafcfe5d41ce1042916b`; Task8 работает в `codex/PROJ-152-final-reconciliation` поверх e513872.

## Точные границы доказательств

Полные безопасные значения и timestamps находятся в [runtime reconciliation](2026-10-07-runtime-reconciliation.json). Это отдельный receipt измеренных границ, а не переименование всего окружения в verified.

| Граница | Фактическое доказательство | Ограничение |
| --- | --- | --- |
| Dev web | Точный успешный GitHub run37566462831, artifact11457924757, 117 Git inputs, source/tree/lock/config/dependencies; 48 файлов совпадают с mounted/origin/HTTPS после последнего API/ACL изменения | SHA относится к e513872; технический commit Task8 не называется новой поставкой web |
| Dev переключение | Операция `005e10614e494692ae2058dbf1888274`, atomic child exchange в стабильном parent mount; forced failure/automatic rollback, candidate, explicit rollback, final reapply; сохранение старого preview cookie | Старые хеши не удалены; срок жизни открытых страниц ещё не задаёт разрешённую политику удаления |
| Production | Artifact11457854721, отдельный static-copy; все 7 исходных/CI/mounted файлов и 14 origin/public ответов совпадают | Production не изменялся; timestamp проверки не выдаётся за дату deploy |
| API | Точный Git archive, реальная VPS-сборка, image `9fbf457667c2b4ab1f827da08b64e911797e39eda713f9e8d65bea3ab33c5ae9`, 6205 dependency entries, весь inventory13 dist/migration файлов; candidate/final совпадают с built | Динамический JSON HTTP не равен dist; actual Node24.21.0 отличается от web CI24.18.1. Dockerfile использует floating `node:24-alpine`; реальный resolved digest сохранён отдельно, будущий rebuild не обещан бит-в-бит |
| API rollback | Возвращён original image `05845ef24741384bda793f4c67709c74b8b6fa4a58272637019479c986dd9865`; Node/dependencies5804 entries/16 dist+migration файлов равны original receipt | Проверены read-only readiness200, guest401, provider TLS; это не реальный Sber OAuth identity proof |
| DB | Изолированная PostgreSQL18.6 реставрация owner/role/membership/schema/relation/column/function/default ACL; live forward→rollback→final. Меняются только будущие TABLE/SEQUENCE grants owner outline/public для forum_app_role | Все существующие права и sandbox неизменны; семантические hashes/counts21+9 таблиц одинаковы. Public IAM migration и новые данные профиля не выполнялись |
| Shared services | Все 20 контейнеров running, health healthy либо отсутствует; current image IDs, 7 mounted code comparisons, 18 origin/public probes девяти доменов | Hash динамического HTTP — наблюдение доступности. Существующие vendor images не пересобирались |
| Cal.diy | Существующий custom image ID и отдельный mounted reminder source SHA `8b6088261b096d94d0304512b2df4ea32d4cb8ed` | Полный custom-image buildchain неизвестен. Reminder file не служит доказательством всей сборки |
| pgAdmin | Persistent registrations39–43, успешный реальный read-only SQL в пяти базах; forum_app ограничен forum | Другие пользовательские регистрации не менялись; косметическая recreation не требовалась |
| Codex iab | 42 direct/reload/width route checks, 6 held-session/modal/history/focus cases, calendar в3 ширинах, unreloaded old-page19 ресурсов после candidate/rollback, финальный homepage без новых console errors | Session200 и error states частично synthetic fixtures; booking и реальный provider login не выполнялись |

[Dev](../releases/2026-10-07-vps-dev-observed.json), [production](../releases/2026-10-07-vps-production-observed.json) и [shared](../releases/2026-10-07-vps-shared-observed.json) содержат current inventories всех перечисленных компонентов. Статус schema v1 `observed-unreconciled` консервативен: её full-release контракт требует static HTTP equality и полную build/deploy provenance без limitations. Для dynamic API и opaque custom image он неприменим. Вместо ложных `matchesMountedBytes:true`, придуманных времён сборки/production deploy или изменения контракта опубликован отдельный scoped receipt. `matchesMountedBytes:true` присутствует только для проверенных статических файлов. Оригинальные CI manifests сохранены побайтно как `build-only`.

Проверки выполнялись контроллером в указанные в receipts времена. Офлайн-исполнитель заново сопоставил source inputs, manifest hashes, static file inventories, API payloads и rollback, ACL metadata и data digests; не выполнял новых сетевых probes, серверных изменений или браузерных операций. Private source receipts доступны в сохранённом recovery-контуре контроллера; в Git нет их полных inventories, access/config hashes, env, dumps, cookies, пользовательских строк или вложений.

## Сохранение исходников и рабочие копии

[Cleanup eligibility](2026-10-07-cleanup-eligibility.json) перечисляет текущие локальные branch heads и **каждый commit**, отсутствующий в принятой main и в e513872, а также heads/status counts/ownership девяти worktrees. Это графовая уникальность commit, не доказательство отсутствия полезного эквивалентного файла после cherry-pick. [Accepted source matrix](accepted-source-matrix.json) хранит per-file решения; [Outline migration manifest](document-migration-manifest.json) хранит saved/reopened preservation и attachment lineage. Совместно они объясняют selected/superseded/document dispositions; оставшаяся история должна сохраняться целиком независимо от выбранных файлов.

Source PR3–14 и16 всё ещё OPEN. Их 13 exact heads совпали с GitHub/local refs; сумма unique-per-source относительно e513872 —172, с возможным повторным учётом общих commits. Ни одна исходная ветка не признана автоматически удаляемой. Нужны принятие main и финальный проверенный all-ref bundle после Task8 commits, затем свежая проверка refs перед source closure. PR2/parser остаётся исключённым из системы; сохранность исторических объектов не разрешает восстановление отменённого функционала.

Fresh primary recovery контроллера включает331453 filesystem entries с ignored материалами: совпадают bytes/types/modes/symlinks; восстановлены primary и оба nested Git heads/status; оба nested прошли full fsck. Original all-ref bundle независимо перепроверен контроллером. **Final all-ref bundle ещё не создан.** Original primary остаётся на `0dd7dd2eb5f1a6a7fa5a7d3e8991072934d39692`; исполнителем не изменялся. Private file inventory и его fingerprint не опубликованы.

Четыре managed worktrees PROJ151/31/150/145 принадлежат другим чатам и сохраняются. Три старых unmanaged checkout требуют отдельной проверки полного восстановления и активных writers перед удалением. Собственный managed checkout сохраняется до whole Tasks5–8 review и внешних gates; его ignored SDD необходимо отдельно сохранить перед native archive. Статус чата notLoaded сам по себе не разрешает архивирование.

Два существующих Graft readers PID28876/28877 не принадлежат этой очистке. Контроллер сохраняет primary `.graft/` и планирует переместить полный независимый Cal.diy checkout за пределы Forum с совместимой ссылкой `cal-diy-astforum`; целевая отдельная копия не должна перезаписываться или сливаться. Эти операции ещё не выполнены. `.gitignore` и `.gitnexusignore` исключают generated graph и ссылку/поддерево Cal.diy. `.dockerignore` также исключает `.graft`, `.worktrees` и совместимую Cal.diy-ссылку из build context. Dockerfile и копируемые app/package/lock inputs неизменны; изменение упаковочных exclusions не объявляется новой сборкой активного API image. Другие SDD остаются ignored на месте.

## Оставшиеся этапы контроллера

1. Scoped Task8 review, необходимые исправления, push/PR/exact-head CI и реальные OpenProject GitHub links под Кузьмина; native PR attachment.
2. Whole Tasks5–8 review, включая явное решение об inherited Primer3PDS004 errors и geometry warnings. Эти результаты не объявлены зелёными.
3. Принятие итоговой main, fresh final all-ref bundle/restore и дополнительное сохранение новых dirty/ignored/SDD материалов; повторная проверка remote refs, активных владельцев и source dispositions.
4. Безопасная синхронизация primary, отдельное сохранение/перемещение nested repos, закрытие согласованных source PR/branches; только затем cleanup собственных процессов и допустимых checkout. Native archive использует exact owned identityKey и не заменяет backup ignored файлов.
5. Canonical Forum `--index-only` по принятому final HEAD, actual query/context/trace и отсутствие stale prefixes/access paths; сохранить независимый Cal.diy index и чужие процессы. Held alias `forum-repository-order` остаётся на f7dda018, на10 commits позади BASE; его результаты advisory.
6. Закрытие PROJ-152 только после всех обязательных этапов. Этот аудит не добавляет Task8-complete строку в ledger.

Технические plans остаются только `docs/plans`; продуктовые материалы — Outline. Audit/map/index exclusions не изменяют приложение, IAM, DB schema, дизайн или vendor runtime. Current README hash обновлён в mutable candidate ownership Task7 с отдельным Task8 before/after receipt; исходные source pins, Task5/6 snapshots и dated observations сохранены.
