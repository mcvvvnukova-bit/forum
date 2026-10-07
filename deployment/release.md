# Проверка и выпуск

Выпуск выполняется только по разрешённой задаче для названного окружения. [Наблюдения6октября](environments.md) фиксируют прежние bytes/runtime, а не release текущей ветки. Production static и dev Primer имеют отдельные source/deployment boundaries.

1. Зафиксировать commit, все source/config/lock inputs и владельцев. Из чистого checkout выполнить locked install, layout, type/build и соответствующие unit/integration/browser checks; сохранить команды и результаты.
2. Собрать неизменяемый artifact, полный inventory и output SHA. Для независимых публичных пакетов проверить общие routes/navigation/auth-loader версии. API runtime target проверить отдельно: наличие `forum.public` не разрешает переключение legacy sandbox.
3. Проверить target/environment, current bytes/config, конкурирующие изменения и rollback. Сохранить backup затронутых путей; не заменять shared infrastructure или production вне scope.
4. Использовать существующие publishers из `scripts/deployment/` соответствующего владельца. Их локальные contract checks: `npm run test:publishers` и component-owned deployment tests. Копирование сборки не является доказательством публикации.
5. Сравнить artifact→deployed→served SHA, runtime/config, origin и публичный HTTPS. Браузером после reload проверить реальные routes/layout/auth links, shared-password boundary и protected files; provider flow/session проверяются отдельно по применимости.
6. Записать полноценный [release manifest](release-manifest.schema.json): exact inputs/build command/runtime/timestamps, deploy operation/target, served receipts. `verified` допустим только при полной подтверждённой цепочке и без unknown provenance; JSON validation само по себе её не доказывает.
7. Проверить exact commits и PR в GitHub, task links с `OP#PROJ-…` в PR body и вкладку GitHub реальной задачи OpenProject; прикрепить PR к чату. Сообщить material limitations отдельно.

Для отмены вернуть только затронутые publisher paths/HTML/config из конкретного backup после проверки concurrent state. Новые immutable hashed assets допускается сохранить для открытых вкладок. Возврат схем/данных выполняется отдельным подтверждённым database runbook, а не удалением identity data.

В receipts не включать secrets, connection strings, personal/session/provider payloads или private backup inventories. Сохранять provenance и точные технические hashes отдельно от приватных operational evidence.
