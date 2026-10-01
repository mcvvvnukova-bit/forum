# Сверка локальных исходников и VPS с GitHub

## Отмена парсера ОКВЭД

После сверки 1 октября 2026 года владелец проекта отменил парсер организаций и финансовых данных по ОКВЭД. [PR № 2](https://github.com/mcvvvnukova-bit/forum/pull/2) закрыт без слияния. Удалены удалённая и локальная ветки `codex/okved-parser`, локальный worktree с исходниками, тестами, миграциями и конфигурацией запуска, а также отдельный локальный план пилота.

В `origin/main` этот код не попадал. На VPS `forum-prod` не обнаружены сервисы, процессы или каталоги установки парсера. На локальном компьютере процессов парсера нет. В инструкциях проекта зафиксирована отмена; исторические документы и дифф закрытого PR не являются действующим заданием на разработку.

Справочник ОКВЭД и остальные функции проекта сохранены. Ниже приведены результаты первоначальной сверки; проверки парсера относятся к его исторической версии до отмены.

## Первоначальная сверка

Проверено 1 октября 2026 года: проект АСТ «Форум», VPS `forum-prod` (`test-debian`), репозитории `mcvvvnukova-bit/forum` и `mcvvvnukova-bit/astforum-cal-diy`.

Созданы восемь draft PR; существующий PR № 2 обновлён 44 локальными коммитами и переведён в draft. GitHub интеграция для форка Cal.diy подключена к тому же OpenProject проекту PROJ; ping и доставка pull_request отвечают HTTP 200. Для пяти PR подтверждены связи с соответствующими задачами, включая явно указанных родителей. Для четырёх PR подходящей задачи не найдено; новые задачи не создавались. Все PR прикреплены к текущему чату Codex.

| PR | Изменение | Проверенные связи OpenProject | Коммит исходников GitHub |
|---|---|---|---|
| [astforum-cal-diy PR № 1](https://github.com/mcvvvnukova-bit/astforum-cal-diy/pull/1) | feat: синхронизировать запись на демо и SMTP напоминания | [PROJ-2](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-2), [PROJ-32](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-32), [PROJ-33](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-33), [PROJ-34](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-34), [PROJ-142](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-142) | `ec4b6d925734` |
| [forum PR № 2 — закрыт](https://github.com/mcvvvnukova-bit/forum/pull/2) | Отменён владельцем проекта; ветка и локальные исходники удалены | Подходящая задача не найдена; функционал отменён | `68c6a0a65c94` (история) |
| [forum PR № 4](https://github.com/mcvvvnukova-bit/forum/pull/4) | feat: лендинги, вход, демо и логотип системы торгов | [PROJ-1](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-1), [PROJ-2](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-2), [PROJ-4](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-4), [PROJ-29](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-29), [PROJ-31](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-31), [PROJ-32](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-32), [PROJ-38](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-38), [PROJ-142](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-142), [PROJ-144](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-144), [PROJ-145](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-145) | `93d0eb506d75` |
| [forum PR № 5](https://github.com/mcvvvnukova-bit/forum/pull/5) | feat: синхронизировать API Сбер ID и схемы профилей | [PROJ-3](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-3), [PROJ-4](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-4), [PROJ-5](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-5), [PROJ-35](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-35), [PROJ-38](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-38), [PROJ-41](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-41), [PROJ-42](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-42) | `5084b30b0be5` |
| [forum PR № 6](https://github.com/mcvvvnukova-bit/forum/pull/6) | ops: сохранить конфигурацию почты, OpenProject и VPS | Подходящая задача не найдена | `1d47da96f30e` |
| [forum PR № 7](https://github.com/mcvvvnukova-bit/forum/pull/7) | ops: синхронизировать публикацию и настройки pgAdmin | Подходящая задача не найдена | `a07a9a0d475d` |
| [forum PR № 8](https://github.com/mcvvvnukova-bit/forum/pull/8) | docs: сохранить HTML шаблоны писем о записи на демо | [PROJ-34](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-34), [PROJ-142](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-142), [PROJ-143](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-143) | `465496e308f5` |
| [forum PR № 9](https://github.com/mcvvvnukova-bit/forum/pull/9) | chore: сохранить служебные сценарии проекта | Подходящая задача не найдена | `8b8d14886fb7` |
| [forum PR № 10](https://github.com/mcvvvnukova-bit/forum/pull/10) | ops: сохранить архив прежних публикаций dev лендинга | [PROJ-1](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-1), [PROJ-2](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-2), [PROJ-4](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-4), [PROJ-29](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-29), [PROJ-31](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-31), [PROJ-38](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-38), [PROJ-144](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-144) | `00a47c2acdfd` |

Коммиты в таблице фиксируют исходники до добавления самого отчёта в PR № 6.

PR № 10 основан на ветке PR № 4 и добавляет только архив прежних публикаций лендинга. PR № 3 с инструкциями AGENTS.md и описанием интеграции уже находился на GitHub и остаётся связан с PROJ-148.

## Что сверено

- 28 файлов текущего API и четыре файла конфигурации релиза `20261001-sber-dns` совпадают с локальными исходниками. Действующий API использует отдельную БД `forum_sber_sandbox`; основная `forum` уже имеет объединённую схему public.
- Действующий шлюз авторизации и production HTML лендинга совпали с локальным снимком. Основной checkout сохранил исходные файлы и ветку; PR подготовлены в отдельных worktree.
- 6102 исходных файла активного Cal.diy релиза совпали с локальным форком. Все коммиты кастомизации вошли в PR форка; 49 исторических release инструментов и patch двух правок старого локального Compose также опубликованы.
- Из 179 исходных файлов серверных staging каталогов 94 уже были представлены опубликованной историей Git. Остальные 85 исходных путей сохранены как 52 уникальных файла в четырёх архивах; source-manifest.json сохраняет соответствие путям. Итоговая проверка по Git blob не выявила неопубликованных исходников staging.
- В локальном снимке проверены 124 файла с расширениями потенциального исходного кода: 120 присутствуют в опубликованной истории Git. Четыре HTML файла являются экспортами требований и снимками Outline before/after; они сохранены локально как данные документов и не входят в приложение.
- Проверены активные локальные ветки и worktree. Ранее непубликованные коммиты с кодом теперь находятся в PR № 2, № 4 и № 7. Оставшиеся внутренние архивные коммиты содержат документы и настройки Obsidian, а не изменения приложения.
- Во время сверки другой чат обновлял логотип в PR № 4; его коммиты уже присутствуют на GitHub. Архив staging вынесен в отдельную ветку PR № 10.

В GitHub переданы исходники, тесты, нужные ресурсы интерфейса, конфигурации и инструкции. Приватные env-файлы, ключи, пароли, базы, пользовательские загрузки, зависимости, сборки и журналы проверок исключены.

## Проверки

| Область | Результат |
|---|---|
| Текущий лендинг | Проверка типов и сборка успешны; 23 теста интерфейса и 11 тестов шлюза прошли |
| API Сбер ID | Проверка типов и сборка успешны; 39 тестов API на отдельной временной PostgreSQL и 8 диагностических тестов прошли |
| Схема public и профили | Миграция, поведение профилей, ограничения, границы ролей и повторное применение миграции успешны; синтетические записи откатились |
| Cal.diy | 56 тестов записи/виджета и 52 теста напоминаний прошли; типы модуля напоминаний проверены; один PostgreSQL тест Cal.diy пропущен |
| ОКВЭД | 333 unit теста и сборка успешны; 48 интеграционных проверок в восьми целиком пройденных файлах прошли на VPS |
| pgAdmin | Все три набора контрактных проверок прошли |
| Конфигурация и сценарии | Семь Compose моделей проверены без чтения приватных env-файлов; три Ruby patch проходят синтаксическую проверку в OpenProject; Python, shell и JavaScript исходники проверены синтаксически |

Проверки текущего лендинга выполнены на снимке синхронизации `fb4307b`; последующие коммиты параллельного чата меняют графический логотип. Архивные варианты исходников не подменяют текущий build/test набор.

## Ограничения, отражённые в draft PR

Полный интеграционный набор ОКВЭД сейчас не пройден. В удалённом окружении отсутствует Chromium для 116 браузерных проверок. Шесть наборов с S3 не проверены: Docker не смог скачать зафиксированный `minio/minio:RELEASE.2025-09-07T16-13-09Z` и вернул pull access denied. Первый прогон через SSH к PostgreSQL также достиг тайм-аутов; тестовый runner в одном namespace с временной БД прошёл проверки БД без этих тайм-аутов. Live-pilot и запросы к реальным List-Org/ФНС при синхронизации не запускались.

Полная сборка Cal.diy не повторялась; проверен активный релиз и целевые тесты. Отдельная Prisma схема для PostgreSQL проверки напоминаний не подготавливалась, поэтому этот тест пропущен.

AuthStore API продолжает работать с прежними схемами iam/party в Sandbox. Перенос API на production public схему требует отдельной реализации; legacy migrator корректно отказывается менять public установку. Это ограничение уже описано в исходниках и PR № 5.

Исторические скрипты deploy, восстановления и изменения внешних приложений сохранены для ревью; они привязаны к своим версиям и входным снимкам. Они не выполнялись при сверке. Серверные приложения не перезапускались; временная тестовая БД и тестовые файлы очищены после проверок.

## Изменения без подходящей задачи

- PR № 6: почтовая инфраструктура Stalwart/listmonk/TMail, установка и patches OpenProject, маршруты VPS и правила доступа.
- PR № 7: публикация pgAdmin, готовность, откат, конфигурация подключений.
- PR № 9: служебные генераторы требований/BPMN и сценарии планирования, восстановления и публикации.
