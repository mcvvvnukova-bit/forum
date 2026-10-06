# Аудиториальные страницы АСТ Форум на Primer

Страницы `/customers/`, `/suppliers/`, `/work/` используют компоненты и композиции главной из чата `01a0f71e-e3b3-7903-a766-3463c3b744a7`. Требования прочитаны 02.10.2026 под Кузьмина и сохранены в `requirements/`.

- [PROJ-145](https://roadmap.astforum.ru/work_packages/PROJ-145/activity): заказчики.
- [PROJ-146](https://roadmap.astforum.ru/work_packages/PROJ-146/activity): поставщики и подрядчики.
- [PROJ-147](https://roadmap.astforum.ru/work_packages/PROJ-147/activity): физлица, работа и подработка.
- [PROJ-29](https://roadmap.astforum.ru/work_packages/PROJ-29/activity): родительская фича.

## Разработка и проверки

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
node scripts/package-site.mjs
python3 -m unittest discover -s scripts -p 'test_*.py' -v
python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py "$PWD"
```

Локально: `http://127.0.0.1:5191/customers/`, `/suppliers/`, `/work/`. Корень локального приложения показывает исходную главную для сравнения; её HTML не включается в серверный пакет.

Только Primer React 38.37.0 / Primitives 11.10.0 Light / Octicons 19.33.0. Общие header/footer, sticky навигация, FAQ Details, Card experimental и Dialog взяты из принятой главной. Только основные кнопки используют проверенные семантические aliases Forum / Light; типографика, границы и фокус — Primer Light. Нет новой библиотеки компонентов.

## Границы функциональности

Тексты показывают целевой сценарий платформы. Само создание заказов, профиль, предложения и найм принадлежат отдельным требованиям. Текущий сервер реализует Сбер ID для физлиц, но не реализует Диадок, формы профиля/заказов и найм. CTA открывает честный экран следующего шага. Компаниям доступно демо, физлицам — существующий вход/регистрация Сбер ID. После входа показывается сохранённое направление и статус будущего профиля/заказов. Нажатие не создаёт участника или роль и не имитирует защищённые рабочие данные.

У физлиц обе ознакомительные ветки видны до выбора; выбор фильтрует примеры и шаги. По правилу выпуска PUB.01.01.04 вакансии отмечены «Работа в штате — скоро». Ни один CTA не ведёт из вакансии в тендер под названием вакансии. Примеры явно демонстрационные, не имеют отклика и не выдаются за фактическую зарплатную статистику.

`forum.public.intent` в sessionStorage содержит только `{audience,action,direction?,returnTo}`. Каждая комбинация валидируется; допустимы только локальные страницы аудитории. Значение не является правом доступа. После существующего callback Сбер ID в `/` marker script возвращает сохранённый личный сценарий на `/participate/`; отмена/ошибка сохраняет направление. Вход/регистрация используют только штатные `intent` и `subject` API; не добавляют неподдерживаемые query-поля.

Демо передаёт `audience` календарю Cal.diy и использует тот же Dialog и fallback на страницу записи. Реальное бронирование в проверках не создаётся.

## Публикация на VPS

`node scripts/package-site.mjs` создаёт `dist/site`: только три аудиториальных страницы, `/participate/` и изолированные `/audience-assets/`. Главная, auth gateway и конфигурация Caddy не заменяются. `scripts/deploy.py` принимает путь к загруженному пакету; стандартная цель `/opt/outline/dev-astforum/landing`.

```sh
sudo python3 deploy.py /home/testing-user/audience-pages-release/site
```

Сценарий сохраняет затронутые директории и исходный `index.html` в `/opt/outline/backups/audience-pages-<UTC>`. При исключении восстанавливает прежние маршруты. В корневой HTML добавляет только marker script для возврата после Сбер ID; повторный запуск не дублирует его. Сохраняются общий пароль dev, API, cookies, CSP и noindex. Для rollback вернуть сохранённые директории и `index.html` из указанной backup-директории; не заменять весь `/opt/outline`.

Статусы и доказательства: `evidence/verification.md`. Публикация лендингов не означает завершение зависимых модулей IAM/закупок/найма.
