# PROJ-147: Work carousel direction 2

Approved by the user: direction 2, followed by implementation and dev publication.
Source visual: /Users/vvv/.codex/generated_images/01a0f97e-a15f-7b00-9a6b-7abd903cd5c4/exec-fc8a51a9-1ba6-4b75-aef8-2d0d19897e47.png.

## Composition and exact copy

Both slides use two equal columns on desktop, one column on mobile. The left column contains all text followed by the previous/counter/next controls; the right contains the existing native illustration. Remove the full-width heading above the columns. Keep the actual illustration files and accessible hidden captions/facts.

Shared h2: «Найдите работу по своей специальности».
Shared subtitle: «Выбирайте заказы и вакансии с учётом ваших навыков и места работы.»
Orders h3: «Заказы и подработка».
Orders body: «Изучите задачу, объём работ, место и сроки. Предложите свою стоимость и откликнитесь на подходящий заказ.»
Jobs h3: «Работа в штате».
Jobs body: «Сравните обязанности, зарплату, график и место работы. Откликнитесь на вакансию, которая вам подходит.»

## Constraints and acceptance

Reuse current Primer components, Forum Light semantic tokens, spacing and illustrations. No new dependencies, fonts, assets or auth behavior. Keep existing manual cyclic controls, stable keyboard focus, one current accessible slide, live counter, legacy hashes and saved auth-intent independence.

Verify existing 37 behavior tests, typecheck, lint, build/package, Primer validator and four deployment tests. Inspect rendered desktop and mobile in IAB; compare source and implementation in one normalized image and save design-qa.md. Existing mock typography is adapted to the current Primer heading scale; no screenshot is used as UI.

Continue branch codex/PROJ-145-audience-pages and PR11, task PROJ-147 (API id185), parent PROJ-29. Preserve existing OP#PROJ-145/146 links. Publish only the owned audience routes/assets to dev with backup and --preserve-homepage, proving all served bytes and fresh protected-file fingerprints. Do not publish production.
