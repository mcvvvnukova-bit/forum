# Цвет основной кнопки — 01.10.2026

Пользователь разрешил заменить зелёный цвет основной кнопки фирменным оранжевым в локальной главной. Только цветовые роли primary Button изменены; компоненты и взаимодействия остаются Primer.

Источник: [Figma «Макеты 2.0»](https://www.figma.com/design/WT2IPB0eHD9ULCPENEktwp/Макеты-2.0?node-id=7-3940), коллекция `Forum` (`VariableCollectionId:107:73`), режим `Light` (`107:0`). Прочитано через get_variable_defs и read-only use_figma; файл Figma не изменён. В коллекции проверены COLOR type, TEXT_FILL / FRAME_FILL / SHAPE_FILL scopes и цепочки алиасов.

| Primer role | Forum variable → primitive | Light | Status | CSS variable |
| --- | --- | --- | --- | --- |
| action.primary.rest | color/bg/accent → primitive/accent | #FF551A | accepted | --button-primary-bgColor-rest |
| action.primary.hover | color/bg/accent-hover → primitive/accent-hover | #FF7140 | accepted | --button-primary-bgColor-hover |
| action.primary.pressed | color/bg/accent-pressed → primitive/accent-pressed | #E64A12 | accepted | --button-primary-bgColor-active |
| action.primary.disabled | color/bg/accent-muted → primitive/accent-muted | #FFD4B2 | accepted | --button-primary-bgColor-disabled |
| action.primary.label/icon | color/text/on-accent → primitive/black | #040404 | accepted | --button-primary-fgColor-rest / iconColor-rest |
| action.primary.disabled.label/icon | color/text/secondary → primitive/text-secondary | #4A4A4A | accepted | --button-primary-fgColor-disabled / iconColor-disabled |

Semantic variable IDs: rest `107:91`, hover `173:481`, pressed `173:482`, disabled `107:92`, label `109:73`, disabled label `107:89`. Primitive IDs: `107:81`, `173:479`, `173:480`, `107:83`, `173:478`, `107:80` respectively.

Алиасы сохранены в `src/forum-tokens.css`. Нейтральные границы и фокус используют Primer Light. Зеленоватая выбранная тень primary-кнопки заменена штатным нейтральным токеном `--shadow-inset`.

Контраст текста и стрелки на основном фоне проверен по computed styles в браузере: 6,41:1. Белая подпись отклонена: контраст 3,20:1. Клавиатурный фокус подтверждён: `:focus-visible`, blue outline 2px и white inset 3px штатного Primer. Hover/pressed/disabled CSS-переменные подтверждены; реальные pointer-состояния отдельно не проверялись. Геометрия и breakpoint-правила не менялись. Полный VoiceOver не проводился.

TypeScript/build, ESLint и Primer validator прошли. Валидатор: 0 ошибок, прежние 17 просмотренных предупреждений. Скриншоты: `orange-primary.jpg`, `orange-primary-focus.jpg`. Состояния кнопки не требуют нового поведенческого теста.
