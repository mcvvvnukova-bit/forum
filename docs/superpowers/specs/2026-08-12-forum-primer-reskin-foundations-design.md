# FORUM × Primer: Reskin foundations

## Goal

Create a Light-only FORUM theme layer in the Figma file `Макеты 2.0`, documented on the `Фирменный стиль` page inside frame `Guidelines content` (`33:146`). The theme adapts Primer's visual language to the FORUM brand while preserving Primer component structure, spacing, dimensions, interaction model, and Octicons.

This phase covers foundations only. It does not detach, fork, or rebuild Primer components.

## Source of truth

The Figma brand page is authoritative for color and typography values. Older repository documentation is reference material only where it agrees with Figma.

Canonical brand colors:

| Role | Value |
|---|---:|
| Primary Black | `#040404` |
| Secondary Dark | `#282828` |
| Secondary Gray | `#4A4A4A` |
| Primary Orange | `#FF551A` |
| Secondary Orange | `#FF7140` |
| Tertiary Orange | `#FFD4B2` |

Canonical typefaces:

- `Unbounded` for expressive headings and key messages.
- `Golos Text` for interface text, descriptions, labels, and controls.

When values conflict with `docs/design/colors.md`, the values above win. In particular, use `#040404` rather than `#0A0A0A`, `#FF7140` rather than `#FF7A4A`, and `#FFD4B2` rather than `#FF9D66`.

## Visual direction

The selected direction is **Industrial Precision**:

- light, functional surfaces;
- graphite hierarchy rather than pure black everywhere;
- orange reserved for actions, focus, selection, and concise brand accents;
- restrained radii and elevation;
- Unbounded used sparingly so dense B2B screens remain efficient;
- Primer interaction and component geometry preserved.

## Color architecture

### Brand primitives

| Token | Value | Purpose |
|---|---:|---|
| `primitive/black` | `#040404` | Display and heading contrast |
| `primitive/text-primary` | `#282828` | Default interface text |
| `primitive/text-secondary` | `#4A4A4A` | Secondary text and icons |
| `primitive/accent` | `#FF551A` | Primary action and focus |
| `primitive/accent-hover` | `#FF7140` | Hover state |
| `primitive/accent-muted` | `#FFD4B2` | Muted selection and highlights |
| `primitive/accent-pressed` | `#E64A12` | Pressed state |
| `primitive/link` | `#CC4415` | Accessible orange text on white |

Existing neutral primitives remain unchanged and become the canonical Light neutral set:

| Token | Value |
|---|---:|
| `primitive/white` | `#FFFFFF` |
| `primitive/canvas` | `#F6F8FA` |
| `primitive/surface-muted` | `#F1F1F1` |
| `primitive/surface-subtle` | `#F7F7F7` |
| `primitive/border` | `#D6D6D6` |

### Semantic roles

The Light mode must expose at least these roles:

```text
color/text/heading
color/text/primary
color/text/secondary
color/text/link
color/text/on-accent

color/bg/canvas
color/bg/default
color/bg/muted
color/bg/subtle
color/bg/accent
color/bg/accent-hover
color/bg/accent-pressed
color/bg/accent-muted

color/border/default
color/border/focus
```

Mappings:

- `color/text/heading` aliases `primitive/black`.
- `color/text/primary` aliases `primitive/text-primary`.
- `color/text/secondary` aliases `primitive/text-secondary`.
- `color/text/link` aliases `primitive/link`.
- `color/text/on-accent` aliases `primitive/black`.
- Accent background roles alias their corresponding accent primitives.
- `color/border/focus` aliases `primitive/accent`.

White text on `#FF551A` has only 3.2:1 contrast and must not be used for normal-sized primary button labels. `#040404` on `#FF551A` provides 6.41:1. Text links use `#CC4415`, which provides at least 4.5:1 against white.

Success, attention, danger, and info retain distinct Primer-like semantic colors. They must not be collapsed into brand orange.

## Typography

### Unbounded

| Style | Size/line height | Weight | Use |
|---|---:|---:|---|
| `FORUM / Display` | 40/48 | Bold | Covers and key messages |
| `FORUM / Heading / Page` | 28/36 | SemiBold | Page title |
| `FORUM / Heading / Section` | 20/28 | SemiBold | Major section |
| `FORUM / Heading / Card` | 16/24 | SemiBold | Large card title |

### Golos Text

| Style | Size/line height | Weight | Use |
|---|---:|---:|---|
| `FORUM / Body / Large` | 16/24 | Regular | Introductory copy |
| `FORUM / Body / Medium` | 14/20 | Regular | Default interface text |
| `FORUM / Body / Small` | 12/16 | Regular | Help text and metadata |
| `FORUM / Label / Medium` | 14/20 | SemiBold | Buttons and controls |
| `FORUM / Label / Small` | 12/16 | SemiBold | Badges and compact labels |
| `FORUM / Metric` | 24/32 | SemiBold | Numeric metrics |

Unbounded is not used inside tables, form fields, buttons, or navigation. Long headings that exceed two lines may use Golos Text SemiBold. Uppercase is reserved for short structural labels such as `01 — ПАЛИТРА`.

## Spacing and shape

Primer spacing and component dimensions remain unchanged. The local spacing scale is:

```text
4, 8, 12, 16, 24, 32
```

Radius tokens:

```text
radius/sm   = 6
radius/md   = 8
radius/lg   = 12
radius/full = 999
```

The system avoids oversized 20–32 px card radii. Borders and surface hierarchy carry most of the visual structure.

## Elevation and focus

Create these Effect Styles:

```text
FORUM / Elevation / Low      0 1 2 rgba(4,4,4,.06)
FORUM / Elevation / Medium   0 4 12 rgba(4,4,4,.08)
FORUM / Elevation / Overlay  0 12 32 rgba(4,4,4,.14)
FORUM / Focus / Brand        0 0 0 3 rgba(255,85,26,.28)
```

Default cards use borders and do not receive shadows. Low elevation is for raised controls, Medium for dropdowns and popovers, and Overlay for dialogs. Interactive elements require a visible brand focus treatment.

## Icons and brand assets

- Keep Primer Octicons and their original geometry.
- Use 16 px and 24 px native icon sizes.
- Default icons use semantic foreground colors.
- Orange is limited to active, selected, or actionable icons.
- Status icons retain their semantic status colors.
- Logos and FORUM brand marks remain separate from the system icon library.

## Figma token strategy

Update the existing `FORUM / Dashboard Tokens` collection in place so current variable IDs and bindings remain valid. Do not delete and recreate existing variables.

The collection remains Light-only for v1. Primitive variables use empty scopes; semantic variables use explicit scopes such as `TEXT_FILL`, `FRAME_FILL`, `SHAPE_FILL`, and `STROKE_COLOR`. Every variable receives deterministic WEB code syntax with the `var(--forum-...)` wrapper.

Existing variables should be renamed only when the semantic meaning is incorrect and the ID can be preserved. Specifically:

- redefine `primitive/accent-soft` as the muted brand value `#FFD4B2`;
- rename `primitive/accent-strong` to `primitive/link` and set it to `#CC4415`;
- add `primitive/accent-hover` for `#FF7140`;
- add `primitive/accent-pressed` for `#E64A12`;
- add `primitive/black` for `#040404`;
- rename `color/text/accent` to `color/text/link` while preserving its variable ID;
- rename `color/bg/accent-soft` to `color/bg/accent-muted` while preserving its variable ID;
- add `color/text/heading`, `color/bg/accent-hover`, `color/bg/accent-pressed`, and `color/border/focus`;
- rebind `color/text/on-accent` from white to `primitive/black`;
- update `radius/lg` from 10 to 12.

## Page documentation

Extend `Guidelines content` on the `Фирменный стиль` page with these sections:

1. Brand primitives.
2. Semantic colors and interactive states.
3. Full typography scale.
4. Spacing and radii.
5. Elevation and focus.
6. Octicons usage rules.
7. A compact visual example of the FORUM theme.

The documentation should match the current 1440 px page language: generous margins, white specimen cards on a light neutral canvas, Unbounded section titles, Golos Text annotations, and orange structural labels.

## Boundaries

Included:

- local variables and aliases;
- variable scopes and WEB code syntax;
- local text styles;
- local effect styles;
- foundations documentation in frame `33:146`;
- Light theme validation and contrast checks.

Excluded:

- Dark mode;
- editing the remote Primer library;
- detaching Primer instances;
- rebuilding or forking Primer components;
- remapping production code;
- replacing Octicons;
- changing Primer spacing, control dimensions, or component APIs.

A later component phase may fork a deliberately selected subset of Primer components and bind them to FORUM tokens. That work requires a separate component list and implementation plan.

## Validation

The foundations phase is complete when:

- all planned variables exist in the current collection;
- existing variable IDs used by current designs remain valid;
- primitive and semantic values are correctly aliased;
- no variable uses `ALL_SCOPES`;
- every variable has WEB code syntax;
- all typography and effect styles exist with exact agreed names and values;
- the documentation page contains every planned section;
- screenshots show no clipping, overlap, or missing fonts;
- primary action, text-link, and muted-accent combinations meet the stated contrast requirements;
- Primer components and remote bindings remain untouched.
