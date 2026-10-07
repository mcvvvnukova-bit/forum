# Primer semantic visual values implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 71 false PDS007 warnings by recognizing imported Primer component variants and valid CSS layout values, while preserving warnings for arbitrary values.

**Architecture:** Keep the pinned upstream scanner byte-identical. Add narrowly scoped semantic classification to the project entrypoint, using the upstream tokenizer and JSX/CSS readers. Only proven PDS007 instances may be removed; findings on the same source line must be counted individually so another attribute or style declaration remains visible.

**Tech Stack:** Python 3, unittest, pinned Primer React 38.37.0, GitNexus 1.6.12, GitHub Actions.

## Global Constraints

- Task: PROJ-154; branch: codex/PROJ-154-sber-token-policy; update PR #22 with OP#PROJ-154 and OP#PROJ-35.
- The only new provider-token exception remains src/auth/sber-tokens.css root custom-property exports.
- Preserve apps/, package-lock.json, the pinned upstream scanner and policy.json byte-for-byte.
- Preserve accepted-source-matrix.json and Task5/6/7 receipts, and the previous dated Sber audit byte-for-byte.
- Modify the existing project entrypoint and integration tests; update only current newFiles hashes in proj-154-verification-ownership.json, and add a separate dated audit.
- No global skill changes, no generic PDS007 suppression, no deployment or merge.
- Resolve imports from executable JavaScript/TypeScript tokens; comments, strings, type-only imports, another package and a matching local component name are not proof.
- Imported aliases and namespace imports must work. If a binding is shadowed, reassigned or otherwise not proven, keep the warning conservatively.
- JSX component props are separate from CSS declarations and style/sx objects. An accepted prop must not authorize the same literal on another component or in an inline style.

## Task 1: Recognize exact supported variants without weakening validation

**Files:**
- Modify: `scripts/verification/check-primer-ui.py`
- Modify: `tests/integration/test_primer_ui_policy.py`
- Modify: `artifacts/repository-audits/proj-154-verification-ownership.json`
- Create: `artifacts/repository-audits/2026-10-07-primer-semantic-visual-values.json`

**Interfaces:**
- Consumes: verified `load_scanner()` module; `scanner.scan_project(root, APPROVED_PATHS)` findings; upstream tokenizer, JSX attribute and CSS declaration readers.
- Produces: unchanged CLI `--root` / `--format text|json`, findings with original code/path/line/severity, exit 1 for errors and 0 for warnings or no findings. No new CLI bypass.
- Add a focused project helper, such as `scan_with_semantic_values(scanner, root) -> list[Finding]`, called by `main()` after integrity validation. Use exact source occurrences, not a set of accepted line numbers.

### Supported component contracts

| Source import | Component | Prop | Allowed literal values |
| --- | --- | --- | --- |
| @primer/react | Stack | gap, padding, paddingBlock, paddingInline | none, tight, condensed, cozy, normal, spacious |
| @primer/react/experimental | Card | padding | none, condensed, normal |
| @primer/react/experimental | Card | borderRadius | medium, large |

Recognize direct named imports, aliases and namespace members of these exact modules. Type-only imports and re-exports are not runtime bindings. Literal strings, JSX string expressions and templates without interpolation may be accepted only when the scanner itself would otherwise flag them. Responsive objects already unflagged by the upstream scanner require no extra exemption.

CSS `auto` is allowed only on margin properties. Unitless `0` is allowed for margin/padding, gap/row-gap/column-gap and border-radius. Validate complete shorthand values: margin supports up to four zero/auto slots, padding and border-radius up to four zero slots, gap up to two zero slots, single-axis/single-side properties their valid slot count. Do not accept zero as a box-shadow value, `auto` for padding/gap/radius, a nonzero literal, unknown identifier, expression or quoted value. Preserve all color, typography and other finding rules. CSS `!important` must not widen allowed values.

- [ ] **Step 1: Add failing behavioral regressions.** The real entrypoint must report no PDS007 for this fixture:

```tsx
import {Stack as Layout} from '@primer/react'
import {Card as Panel} from '@primer/react/experimental'
export const Example = () => <Layout gap="normal"><Panel padding="none" borderRadius="medium" /></Layout>
```

And no PDS007 for:

```css
.center { margin-inline: auto; margin: 0 auto; }
.reset { padding-inline: 0; margin: 0; gap: 0; border-radius: 0; }
```

Add independently expected findings for unknown values, non-Primer and type-only imports, missing imports, same-name local components, shadowed function/destructured parameters and reassigned imported namespaces/aliases. Add same-line cases where a valid Primer prop appears next to a nonzero `style`/`sx` value or another component's invalid prop. Add CSS same-line valid and invalid declarations, invalid shorthand lengths, `padding: auto`, `box-shadow: 0`, comments/string lookalikes, minified imports and multiline JSX. Preserve the existing color and integrity negative tests. Replace the old full-project expectation of 71 with no findings and add a separate upstream-snapshot check retaining the original 71 PDS007 warnings.

- [ ] **Step 2: Run the new tests against the original entrypoint and save red evidence.**

```bash
python3 -m unittest discover -s tests/integration -p test_primer_ui_policy.py -v
```

Expected: new positive cases fail because PDS007 remains; negative cases continue to produce findings.

- [ ] **Step 3: Add exact semantic classification.** Reuse lexical parsing and inspect the complete attribute/declaration value. One safe removal representation is a multiset of proven occurrences:

```python
from collections import Counter

def retain_unproven(findings, permitted):
    remaining = Counter(permitted)
    result = []
    for finding in findings:
        key = (finding.path, finding.line, finding.code)
        if finding.code == 'PDS007' and remaining[key]:
            remaining[key] -= 1
        else:
            result.append(finding)
    return result
```

The permitted occurrence multiset must be derived only from corresponding upstream-recognized warnings with verified import/prop/value or CSS property/value, so it cannot hide an unrelated finding at the same location. Alternatively install narrow scanner hooks which classify exact attributes before they emit findings. Keep the upstream snapshot unchanged.

- [ ] **Step 4: Run focused tests, then the full relevant gates once.**

```bash
npm run test:primer
npm run check:primer
node scripts/verification/check-repository-layout.mjs
node --test scripts/verification/checks.test.mjs
python3 -c "import importlib.util; s=importlib.util.spec_from_file_location('operational','scripts/verification/check-operational-sources.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.verify_provenance())"
```

Refresh only the wrapper/test hashes in the current governance receipt before governance checks. The new audit records the inspected base commit, 71 upstream/before findings, exact 58 gap + 5 padding + 2 radius + 4 auto + 2 zero breakdown, post-change count, test results and immutable-byte checks. Historical audit facts remain historical.

- [ ] **Step 5: Refresh GitNexus, verify scope, commit.** Use the verified `/Users/vvv/.local/bin/gitnexus` distribution, `analyze --index-only --pdg`, then current status/context and staged detect_changes. Commit only the four task files with `fix(PROJ-154): recognize semantic Primer visual values`. Report red/green evidence, exact test counts, commit, preserved files and known limits.

## Delivery and definition of done

Task review and final branch review must pass. Push the existing feature branch, update PR #22 around the final behavior, attach it to the chat, verify both push and PR Actions runs include successful quality, and verify OP links and saved results under Kuzmina. Complete only with zero errors/zero warnings on apps/web, retained negative detections, clean local tree and matching local/remote/PR commit. Merge and deployment are outside this task.
