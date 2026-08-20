# Placeholder Header Logo Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the separate horizontal logo above the helmet and change the subtitle ending to `2026г.` without altering the branded helmet illustration.

**Architecture:** The deliverable is a single static HTML preview. The implementation removes one independent image element and its unused CSS, updates one text node, and preserves the existing Primer Light token layer, responsive rules, semantic structure, and transparent helmet PNG.

**Tech Stack:** HTML5, CSS custom properties, Primer Light semantic roles, local brainstorm preview server, browser DOM verification.

## Global Constraints

- Remove only the separate `img.brand-logo`; keep the logo printed on the helmet unchanged.
- Preserve `/files/forum-hard-hat-exact-transparent.png` with intrinsic dimensions `1536×1024`.
- Use the exact subtitle: `Мы готовимся к запуску. Пожалуйста, возвращайтесь в декабре 2026г.`
- Keep the subtitle on one line at the desktop card width of `820px`; wrapping remains allowed on mobile.
- Preserve Light-only color mode, the heading, responsive helmet sizing, and `main`/`h1`/`aria-labelledby` semantics.
- Do not add a replacement spacer, hidden logo, or another UI component.

---

### Task 1: Update and verify the placeholder card

**Files:**
- Modify: `.superpowers/brainstorm/33299-1787250471/content/astforum-placeholder-exact-helmet-v1.html`
- Preserve: `.superpowers/brainstorm/33299-1787250471/content/forum-hard-hat-exact-transparent.png`
- Test: inline Python assertions and the local browser preview at `http://localhost:50218/`

**Interfaces:**
- Consumes: `/files/forum-hard-hat-exact-transparent.png` as the only helmet illustration.
- Produces: a static card whose first visual element is `img.maintenance-illustration`, followed by `h1#page-title` and the exact subtitle.

- [ ] **Step 1: Run the requirement assertions against the current HTML and confirm they fail**

```bash
/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 - <<'PY'
from pathlib import Path

path = Path('.superpowers/brainstorm/33299-1787250471/content/astforum-placeholder-exact-helmet-v1.html')
html = path.read_text(encoding='utf-8')
expected = 'Мы готовимся к запуску. Пожалуйста, возвращайтесь в декабре 2026г.'

assert 'class="brand-logo"' not in html
assert '.brand-logo' not in html
assert f'<p>{expected}</p>' in html
PY
```

Expected: `AssertionError`, because the current file still contains `brand-logo` and the old subtitle ending.

- [ ] **Step 2: Apply the minimal HTML and CSS change**

Remove the complete desktop CSS block:

```css
.brand-logo {
  display: block;
  width: min(260px, 72%);
  height: auto;
  margin: 0 0 12px;
}
```

Remove the complete mobile CSS block:

```css
.brand-logo {
  width: min(230px, 80%);
}
```

Remove the complete top-level logo element:

```html
<img
  class="brand-logo"
  src="/files/astforum-preview-logo.png"
  alt="ФОРУМ — проектирование и строительство"
  width="1600"
  height="600"
>
```

Replace the subtitle with:

```html
<p>Мы готовимся к запуску. Пожалуйста, возвращайтесь в декабре 2026г.</p>
```

Do not modify `.maintenance-illustration`, the helmet image path, `h1`, card tokens, or media-query dimensions.

- [ ] **Step 3: Re-run the static assertions and verify they pass**

Run the exact Python command from Step 1.

Expected: exit code `0` with no `AssertionError`.

- [ ] **Step 4: Verify structure and visual behavior in the browser**

Reload `http://localhost:50218/` and evaluate:

```js
const p = document.querySelector('p');
const range = document.createRange();
range.selectNodeContents(p);
({
  brandLogoCount: document.querySelectorAll('.brand-logo').length,
  helmetCount: document.querySelectorAll('.maintenance-illustration').length,
  helmetSource: document.querySelector('.maintenance-illustration')?.getAttribute('src'),
  helmetNaturalSize: [
    document.querySelector('.maintenance-illustration')?.naturalWidth,
    document.querySelector('.maintenance-illustration')?.naturalHeight,
  ],
  heading: document.querySelector('h1')?.textContent,
  subtitle: p?.textContent,
  subtitleLineCount: range.getClientRects().length,
  colorMode: document.documentElement.getAttribute('data-color-mode'),
});
```

Expected on the desktop preview:

```js
{
  brandLogoCount: 0,
  helmetCount: 1,
  helmetSource: '/files/forum-hard-hat-exact-transparent.png',
  helmetNaturalSize: [1536, 1024],
  heading: 'Сайт находится в разработке',
  subtitle: 'Мы готовимся к запуску. Пожалуйста, возвращайтесь в декабре 2026г.',
  subtitleLineCount: 1,
  colorMode: 'light',
}
```

Check browser error logs and require zero resource or runtime errors. At a mobile width, confirm the helmet, heading, and subtitle remain inside the card; the subtitle may wrap.

- [ ] **Step 5: Record the generated-artifact boundary**

```bash
git check-ignore -v '.superpowers/brainstorm/33299-1787250471/content/astforum-placeholder-exact-helmet-v1.html'
```

Expected: the preview file is reported as ignored generated content. Do not force-add it to Git. The tracked design and implementation-plan documents provide the durable audit trail.
