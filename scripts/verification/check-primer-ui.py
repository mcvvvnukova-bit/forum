#!/usr/bin/env python3
"""Run the pinned Primer scanner with Forum's approved exact-file policy."""
import argparse
from collections import Counter
from dataclasses import asdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

BASE = Path(__file__).resolve().parent
SNAPSHOT_SHA256 = 'c926222170bb455281ebc2c6f2f279d75ef44143b7e41b18ea0fe0d0841a88e7'
APPROVED_PATHS = ('src/home/forum-tokens.css', 'src/audience/forum-tokens.css', 'src/auth/sber-tokens.css')
SEMANTIC_PROPS = {
    ('@primer/react', 'Stack'): {
        name: frozenset(('none', 'tight', 'condensed', 'cozy', 'normal', 'spacious'))
        for name in ('gap', 'padding', 'paddingBlock', 'paddingInline')
    },
    ('@primer/react/experimental', 'Card'): {
        'padding': frozenset(('none', 'condensed', 'normal')),
        'borderRadius': frozenset(('medium', 'large')),
    },
}


def load_scanner():
    policy = json.loads((BASE / 'primer-ui/policy.json').read_text(encoding='utf-8'))
    if (policy.get('schema_version') != 1
            or policy.get('allowed_token_paths') != list(APPROVED_PATHS)
            or policy.get('snapshot_sha256') != SNAPSHOT_SHA256):
        raise ValueError('invalid Primer policy: expected pinned snapshot and exact approved token paths')
    source = BASE / 'primer-ui/validate_primer_ui.py'
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SNAPSHOT_SHA256:
        raise ValueError('Primer validator snapshot integrity mismatch')
    # Execute exactly the bytes that passed the integrity check, without a stale
    # bytecode cache or a second source read between verification and execution.
    spec = importlib.util.spec_from_file_location('forum_primer_validator', source)
    scanner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = scanner
    exec(compile(data, str(source), 'exec'), scanner.__dict__)
    return scanner


def semantic_bindings(tokens, tags):
    """Prove static ESM bindings, declining any non-tag use of a local name.

    This deliberately rejects even benign value/type references: without a
    scope resolver they could be a shadow, assignment, or namespace mutation.
    Comments and quoted lookalikes are absent from executable token evidence.
    """
    # The pinned lexer does not decode Unicode identifier escapes. A legal
    # escaped parameter/local may therefore shadow an imported binding without
    # matching its raw spelling. Decline all bindings when such executable
    # evidence occurs; comments, strings and template text do not emit these
    # adjacent punctuation/identifier tokens (template interpolations do).
    if any(token.kind == 'punctuation' and token.value == '\\'
           and following.kind == 'identifier' and following.value.startswith('u')
           and token.end == following.start
           for token, following in zip(tokens, tokens[1:])):
        return {}
    bindings = {}
    import_ranges = {}
    depth = 0
    for index, token in enumerate(tokens):
        if token.value == '{':
            depth += 1
        elif token.value == '}':
            depth -= 1
        if depth or token.kind != 'identifier' or token.value != 'import':
            continue
        cursor = index + 1
        if cursor >= len(tokens) or tokens[cursor].value in ('type', '(', '.'):
            continue
        end = cursor
        while end < len(tokens) and tokens[end].value not in ('from', ';'):
            end += 1
        if (end + 1 >= len(tokens) or tokens[end].value != 'from'
                or tokens[end + 1].kind != 'string'):
            continue
        module = tokens[end + 1].value
        if module not in ('@primer/react', '@primer/react/experimental'):
            continue
        clause = tokens[cursor:end]
        # A default import may precede a named/namespace clause; it is not
        # itself evidence for a supported component.
        if clause and clause[0].kind == 'identifier':
            clause = clause[2:] if len(clause) > 1 and clause[1].value == ',' else []
        parsed = []
        if (len(clause) == 3 and [t.value for t in clause[:2]] == ['*', 'as']
                and clause[2].kind == 'identifier'):
            parsed.append((clause[2].value, None))
        elif clause and clause[0].value == '{' and clause[-1].value == '}':
            position = 1
            while position < len(clause) - 1:
                is_type = clause[position].value == 'type'
                position += int(is_type)
                if position >= len(clause) - 1 or clause[position].kind != 'identifier':
                    parsed = []
                    break
                original = local = clause[position].value
                position += 1
                if position < len(clause) - 1 and clause[position].value == 'as':
                    position += 1
                    if position >= len(clause) - 1 or clause[position].kind != 'identifier':
                        parsed = []
                        break
                    local = clause[position].value
                    position += 1
                if not is_type and (module, original) in SEMANTIC_PROPS:
                    parsed.append((local, original))
                if position < len(clause) - 1:
                    if clause[position].value != ',':
                        parsed = []
                        break
                    position += 1
        for local, original in parsed:
            if local in bindings:
                bindings[local] = None
            else:
                bindings[local] = (module, original)
                import_ranges[local] = (index, end + 2)

    # Opening names must come from actual upstream JSX elements. Closing
    # names have their own lexical </Name[.Member]> shape, never a value use.
    opening_starts = {start for _name, start, _end in tags}
    tag_names = set()
    for index, token in enumerate(tokens):
        if token.value == '<':
            cursor = index + 1
            closing = cursor < len(tokens) and tokens[cursor].value == '/'
            cursor += int(closing)
            if (cursor >= len(tokens) or tokens[cursor].kind != 'identifier'
                    or not (closing or token.start in opening_starts)):
                continue
            root = cursor
            cursor += 1
            while (cursor + 1 < len(tokens) and tokens[cursor].value == '.'
                   and tokens[cursor + 1].kind == 'identifier'):
                cursor += 2
            if not closing or (cursor < len(tokens) and tokens[cursor].value == '>'):
                tag_names.add(root)
    for local in list(bindings):
        start, end = import_ranges[local]
        if any(t.kind == 'identifier' and t.value == local
               and not start <= i < end and i not in tag_names
               for i, t in enumerate(tokens)):
            bindings[local] = None
    return {name: binding for name, binding in bindings.items() if binding is not None}


def semantic_attribute_value(value):
    """Only complete unescaped string literals; no interpolation/expression."""
    value = value.strip()
    if value.startswith('{') and value.endswith('}'):
        value = value[1:-1].strip()
    match = re.fullmatch(r"(['\"`])([a-z]+)\1", value)
    return match.group(2) if match else None


def neutral_css_value(property_name, value):
    """Accept complete zero/auto shorthands with each property's slot limit."""
    property_name = property_name.lower()
    limits = {'margin': 4, 'padding': 4, 'border-radius': 4, 'gap': 2,
              'margin-inline': 2, 'margin-block': 2,
              'padding-inline': 2, 'padding-block': 2,
              'row-gap': 1, 'column-gap': 1}
    for group in ('margin', 'padding'):
        limits.update((f'{group}-{side}', 1) for side in ('top', 'right', 'bottom', 'left'))
    limit = limits.get(property_name)
    if limit is None:
        return False
    value = re.sub(r'\s*!\s*important\s*$', '', value, flags=re.IGNORECASE).strip()
    slots = value.lower().split()
    allowed = {'0', 'auto'} if property_name.startswith('margin') else {'0'}
    return 1 <= len(slots) <= limit and all(slot in allowed for slot in slots)


def scan_with_semantic_values(scanner, root):
    """Install narrow emission hooks on this verified scanner, then restore it.

    JSX masks exact attributes only in its visual-attribute emitter. All other
    rules receive original source. CSS subtracts full Finding occurrences,
    derived only from declarations the pinned upstream would warn on; equal
    findings share all output metadata, so their retained multiplicity is exact.
    """
    original_jsx = scanner._scan_jsx_visual_attributes
    original_css = scanner._scan_style_view

    def scan_jsx(source, tags, relative_path):
        bindings = semantic_bindings(scanner._lex_source(source), tags)
        permitted = []
        for tag in tags:
            component, _start, _end = tag
            parts = component.split('.')
            binding = bindings.get(parts[0])
            if binding is None:
                continue
            module, named = binding
            if named is None and len(parts) == 2:
                named = parts[1]
            elif named is None or len(parts) != 1:
                continue
            props = SEMANTIC_PROPS.get((module, named), {})
            for attribute in scanner._jsx_attributes(source, [tag]):
                if (semantic_attribute_value(attribute.value) in props.get(attribute.name, ())
                        and scanner._JS_VISUAL_PROP_RE.fullmatch(f'{attribute.name}={attribute.value}')
                        and not scanner._uses_bound_value(attribute.value)):
                    permitted.append((attribute.start, attribute.value_end))
        return original_jsx(scanner._mask_ranges(source, permitted), tags, relative_path)

    def scan_css(view, allowed_token_globs):
        findings = original_css(view, allowed_token_globs)
        _masked, declarations = scanner._css_declarations(
            view.text, allow_line_comments=view.path.suffix.lower() == '.scss')
        permitted = Counter(
            scanner._finding('warning', 'PDS007', view, declaration.start,
                             'Arbitrary visual literal; use a Primer token or component prop instead')
            for declaration in declarations
            if neutral_css_value(declaration.property, declaration.value)
            and not scanner._uses_bound_value(declaration.value)
        )
        result = []
        for finding in findings:
            if permitted[finding]:
                permitted[finding] -= 1
            else:
                result.append(finding)
        return result

    scanner._scan_jsx_visual_attributes = scan_jsx
    scanner._scan_style_view = scan_css
    try:
        return scanner.scan_project(root, APPROVED_PATHS)
    finally:
        scanner._scan_jsx_visual_attributes = original_jsx
        scanner._scan_style_view = original_css


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--root', type=Path, default=BASE.parents[1] / 'apps/web')
    parser.add_argument('--format', choices=('text', 'json'), default='text')
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve(strict=True)
        mode = root.stat().st_mode
        if (not root.is_dir() or not mode & (stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
                or not mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                or not os.access(root, os.R_OK | os.X_OK)):
            raise ValueError(f'unreadable root: {root}')
        scanner = load_scanner()
        findings = scan_with_semantic_values(scanner, root)
    except Exception as error:
        print(f'error: unable to validate Primer UI: {error}', file=sys.stderr)
        return 2
    if args.format == 'json':
        print(json.dumps([asdict(finding) for finding in findings], indent=2))
    else:
        for finding in findings:
            print(f'{finding.severity.upper()} {finding.code} '
                  f'{finding.path}:{finding.line} {finding.message}')
    return int(any(finding.severity == 'error' for finding in findings))


if __name__ == '__main__':
    raise SystemExit(main())
