# Общая форма входа и регистрации: PROJ-31

Источник: [PUB.02.02](https://docs.astforum.ru/doc/pub0202-perehod-k-registracii-i-vhodu-dC0gjF8wo8), актуальная редакция 02.10.2026, updatedAt `2026-10-02T14:29:50.285Z`, API прочитан под Кузьмина. [Задача PROJ-31](https://roadmap.astforum.ru/work_packages/PROJ-31/activity), внутренний API id 68. Копия требований в `requirements/PUB.02.02.md`; прежняя локальная подробная спецификация этой редакцией заменена.

Один компонент `PublicAuth` для модального окна на всех публичных страницах и самостоятельных `/login`, `/register`. Только Сбер ID. Существующие ссылки публичных пакетов заменяются адаптером на прямые URL; обычное нажатие открывает Primer Dialog, modified click работает как обычная ссылка. Обновление модального URL открывает самостоятельную форму. Переключение режима заменяет историю; Back/крестик/Escape/фон закрывают окно. Действия и источник в query или storage не передаются. Устаревший marker resume.js удаляется из публичных HTML при публикации; старые public/customer intent очищаются до нового IAM-потока.

`GET /api/auth/session` проверяется до запуска IAM с 10-секундным timeout. Только 401 означает гостя. Невалидный 200, 5xx, сеть и timeout дают повтор проверки. `auth=success` не выдаёт сессию. Ошибки E01–E07, `registration_required`, `account_exists` обрабатываются без автоматического нового OAuth. Блокировка/конфликт не предлагают регистрацию для обхода. Уже вошедшему показан статус входа; кабинет и создание участников принадлежат IAM.

Уточнение владельца от 02.10.2026: кнопка Сбер ID компактна, центрируется и ограничена шириной содержимого; отдельная ссылка «Вернуться на сайт» удалена из общей формы. На самостоятельной странице остаётся ссылка бренда «АСТ Форум».

Кнопки используют только Primer React / Primitives Light / Octicons. Поверхности и фокус — Primer Light без новых Forum mappings. Специальные vendor-токены Сбера из [официального руководства](https://developers.sber.ru/docs/ru/sberid/guidebook) вынесены в `src/sber-tokens.css`: зелёный rest #21A038, hover #1E9032, белый официальный знак Сбера. Жирная подпись 19px обеспечивает необходимый контраст для large text. Последнее уточнение владельца заменяет текст регистрации на «Зарегистрироваться по Сбер ID» и требует одну строку. Исходная копия Outline сохранена без изменений; руководство Сбера рекомендует «Зарегистрироваться со Сбер ID».

Для стабильной однострочной геометрии кнопки используется компактное начертание Noto Sans, одной из гарнитур fallback-стека Primer. Локальные Cyrillic/Latin WOFF2 загружены из официального Google Fonts, 21.2 kB суммарно; лицензия SIL OFL 1.1 в `src/fonts/OFL.txt`. Гарнитура ограничена кнопкой Сбер ID, размеры 19px/700/62.5%; шрифт остальных элементов не меняется. `Dialog.Body` на узком экране задаётся через публичный renderBody API; в 320px диалог занимает всю доступную ширину, чтобы сохранить текст и управление без горизонтальной прокрутки.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py "$PWD" --allow-token-file '**/sber-tokens.css'
```

Локальная форма: http://127.0.0.1:5193/login и /register. Local proxy использует только session API dev.astforum.ru. Автоматические тесты используют управляемый fetch; регистрация реального аккаунта не запускается.

Пакет независим от незавершённых веток главной и страниц аудиторий. `scripts/deploy.py` подключает один hashed script/style к текущим HTML и добавляет самостоятельные страницы. Он не пересобирает текущие страницы, не меняет IAM, Caddy, шлюз dev-пароля и production. До замены создаёт резервную копию в `/opt/outline/backups/public-auth-*`; проверяет отсутствие параллельных изменений и атомарно пишет HTML. При ошибке восстанавливает HTML; дополнительные hashed assets безопасно остаются. Старые хеши сохраняются для открытых вкладок.

```sh
release_commit=$(git rev-parse HEAD)
release_dir="/home/testing-user/public-auth-${release_commit}"
ssh -o BindInterface=en0 forum-prod "mkdir -p '$release_dir'"
COPYFILE_DISABLE=1 tar --no-xattrs -cf - dist scripts/deploy.py | ssh -o BindInterface=en0 forum-prod "tar -C '$release_dir' -xf -"
ssh -o BindInterface=en0 forum-prod "sudo -n python3 '$release_dir/scripts/deploy.py' '$release_dir/dist' --commit '$release_commit'"
```

После публикации другой версии публичного пакета снова выполнить этот сценарий, чтобы включение общей формы сохранилось; сами исходники независимых публичных приложений этот PR не меняет. Rollback: атомарно восстановить HTML из резервного каталога, удалить только новые login/register index, если их не было в backup; не удалять каталог landing целиком. Отчёт deployment.json содержит контрольные суммы всех опубликованных HTML и ресурсов. Production fingerprint и реальный origin/HTTPS проверяются отдельно; доказательства в evidence/verification.md.

Публикация 05.10.2026 выполнена на dev из коммита `38420491fafcfe85f5931f7964400120b190e143`. Backup: `/opt/outline/backups/public-auth-20261005T170414402072Z`. Перезапуск не требовался. В текущей локальной сети SSH работает с per-process `BindInterface=en0`; настройки сети не менялись. Сценарий пропускает служебные AppleDouble / __MACOSX файлы старых загрузок. Отдельный identifierPrefix общего React root предотвращает совпадение aria-labelledby с элементами независимо собранных страниц.

Origin и HTTPS подтвердили SHA256 11 файлов, сохранность 31 защищённого файла и dev-шлюза. IAB подтвердил окна на пяти публичных страницах, самостоятельные формы, переключение и закрытие, клавиатуру и восемь однострочных layouts. Проверочный переход достиг Сбер ID и вернулся на dev с ошибкой «Не удалось завершить вход. Попробуйте ещё раз»; успешный OAuth не подтверждён. Callback существующего IAM указывает на `https://astforum.ru/authorization`; конфигурация IAM не изменялась. Доказательства публикации: `evidence/live-*` и `evidence/protected-before.json`.
