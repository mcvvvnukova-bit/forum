#!/usr/bin/env python3
"""Validate a frontend project against the Primer UI dependency policy."""

import argparse
from bisect import bisect_right
from collections import deque
from dataclasses import asdict, dataclass
import fnmatch
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Iterable, Iterator, Optional, Sequence


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    path: str
    line: int
    message: str


REQUIRED_PACKAGES = (
    "@primer/react",
    "@primer/primitives",
    "@primer/octicons-react",
)
FORBIDDEN_PREFIXES = (
    "@mui/",
    "@chakra-ui/",
    "@mantine/",
    "@headlessui/",
    "antd",
    "bootstrap",
    "semantic-ui-react",
    "tailwindcss",
)
SOURCE_SUFFIXES = {".js", ".jsx", ".ts", ".tsx", ".css", ".scss"}
SKIP_DIRS = {".git", ".next", "build", "coverage", "dist", "node_modules"}
DEFAULT_TOKEN_GLOBS = ("**/forum-tokens.css", "**/forum.tokens.css")
MAX_SOURCE_BYTES = 1024 * 1024

_DEPENDENCY_GROUPS = ("dependencies", "devDependencies", "peerDependencies")
_CONTROL_HEAD_KEYWORDS = {"catch", "for", "if", "switch", "while", "with"}
_JAVASCRIPT_SUFFIXES = {".js", ".jsx", ".ts", ".tsx"}
_STYLE_SUFFIXES = {".css", ".scss"}
_LIGHT_THEME_MODULE = (
    "@primer/primitives/dist/css/functional/themes/light.css"
)

_COLOR_LITERAL_RE = re.compile(
    r"(?<![\w#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})"
    r"(?![0-9a-f\w-])",
    re.IGNORECASE,
)
_COLOR_FUNCTION_RE = re.compile(
    r"(?<![-\w])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(",
    re.IGNORECASE,
)
_JS_LITERAL_VALUE = (
    r"(?:['\"][^'\"\n]*['\"]|`[^`\n]*`|"
    r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[a-z%]+)?)"
)
_CSS_TYPOGRAPHY_RE = re.compile(
    r"(?<![-\w])(?P<property>font|font-family|font-size|font-weight|line-height|"
    r"letter-spacing)\s*:\s*(?P<value>[^;}\n]+)",
    re.IGNORECASE,
)
_JS_TYPOGRAPHY_PROP_RE = re.compile(
    r"\b(?P<property>font|fontFamily|fontSize|fontWeight|lineHeight|"
    r"letterSpacing)\s*=\s*(?P<value>"
    r"(?:\{\s*" + _JS_LITERAL_VALUE + r"\s*\}|" + _JS_LITERAL_VALUE + r"))"
)
_DIRECT_FORUM_RE = re.compile(
    r"(?:\bForum/|var\(\s*--forum-[^)]+\))", re.IGNORECASE
)
_CSS_VISUAL_LITERAL_RE = re.compile(
    r"(?<![-\w])(?P<property>margin(?:-(?:top|right|bottom|left|inline|block))?|"
    r"padding(?:-(?:top|right|bottom|left|inline|block))?|gap|"
    r"row-gap|column-gap|border-radius|box-shadow)\s*:\s*"
    r"(?P<value>[^;}\n]+)",
    re.IGNORECASE,
)
_JS_VISUAL_LITERAL_RE = re.compile(
    r"\b(?P<property>margin(?:Top|Right|Bottom|Left|Inline|Block)?|"
    r"padding(?:Top|Right|Bottom|Left|Inline|Block)?|gap|rowGap|"
    r"columnGap|borderRadius|boxShadow)\s*:\s*"
    r"(?P<value>" + _JS_LITERAL_VALUE + r")"
)
_JS_VISUAL_PROP_RE = re.compile(
    r"\b(?P<property>margin(?:Top|Right|Bottom|Left|Inline|Block)?|"
    r"padding(?:Top|Right|Bottom|Left|Inline|Block)?|gap|rowGap|"
    r"columnGap|borderRadius|boxShadow)\s*=\s*(?P<value>"
    r"(?:\{\s*" + _JS_LITERAL_VALUE + r"\s*\}|" + _JS_LITERAL_VALUE + r"))"
)
_CSS_LIGHT_THEME_IMPORT_RE = re.compile(
    r"@(?:import|use|forward)\s+(?:"
    r"['\"]"
    + re.escape(_LIGHT_THEME_MODULE)
    + r"['\"]|url\(\s*(?:['\"]"
    + re.escape(_LIGHT_THEME_MODULE)
    + r"['\"]|"
    + re.escape(_LIGHT_THEME_MODULE)
    + r")\s*\))"
)
_PRIMER_PRIMITIVES = {
    "Button",
    "Dialog",
    "Modal",
    "Tooltip",
    "TextInput",
    "Select",
    "Checkbox",
    "Radio",
    "ToggleSwitch",
}
_ROOT_COMPONENTS = {"ThemeProvider", "BaseStyles"}
_JS_VISUAL_PROPERTIES = {
    "borderRadius",
    "boxShadow",
    "columnGap",
    "gap",
    "margin",
    "marginBlock",
    "marginBottom",
    "marginInline",
    "marginLeft",
    "marginRight",
    "marginTop",
    "padding",
    "paddingBlock",
    "paddingBottom",
    "paddingInline",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "rowGap",
}
_ALLOWED_CSS_KEYWORDS = {"inherit", "initial", "unset"}
_BOUND_VALUE_RE = re.compile(
    r"(?:\bvar\s*\(|(?:^|[^\w])\$[-\w]+|\b(?:Primer|primer|theme|tokens)\.)"
)


@dataclass(frozen=True)
class _Token:
    kind: str
    value: str
    line: int
    start: int = -1
    end: int = -1


class ScanError(Exception):
    """A project cannot be scanned completely and safely."""


@dataclass(frozen=True)
class _SourceView:
    path: Path
    relative_path: str
    text: str
    newline_starts: tuple[int, ...]

    def line(self, offset: int) -> int:
        return bisect_right(self.newline_starts, offset)


@dataclass(frozen=True)
class _CssDeclaration:
    property: str
    value: str
    start: int
    value_start: int
    in_font_face: bool
    block_header: str


@dataclass(frozen=True)
class _JsxElement:
    component: str
    start: int
    opening_end: int
    parent: Optional[int]


@dataclass(frozen=True)
class _JsxAttribute:
    name: str
    value: str
    start: int
    value_start: int
    value_end: int


def _is_forbidden(package: str) -> bool:
    package_root = _package_root(package)
    for prefix in FORBIDDEN_PREFIXES:
        if prefix.endswith("/"):
            if package_root.startswith(prefix):
                return True
        elif package_root == prefix:
            return True
    return False


def _package_root(specifier: str) -> str:
    if specifier.startswith("@"):
        parts = specifier.split("/")
        return "/".join(parts[:2]) if len(parts) >= 2 else specifier
    return specifier.split("/", 1)[0]


def _npm_alias_target(specification: str) -> Optional[str]:
    if not specification.startswith("npm:"):
        return None
    target = specification[4:]
    if target.startswith("@"):
        slash = target.find("/")
        if slash == -1:
            return None
        version_separator = target.find("@", slash)
        return target if version_separator == -1 else target[:version_separator]
    return target.split("@", 1)[0]


def _dependency_target(package: str, specification: str) -> str:
    return _npm_alias_target(specification) or package


def _is_contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def _relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _safe_file_target(root: Path, path: Path, label: str) -> Path:
    relative_path = _relative_path(root, path)
    try:
        file_stat = path.lstat()
    except OSError as error:
        raise ScanError(f"unable to inspect {relative_path}: {error}") from error
    target = path
    if stat.S_ISLNK(file_stat.st_mode):
        try:
            target = path.resolve(strict=True)
        except OSError as error:
            raise ScanError(f"unsafe {label} symlink: {relative_path}: {error}") from error
        if not _is_contained(root, target):
            raise ScanError(
                f"unsafe {label} symlink escapes root: {relative_path}"
            )
        try:
            file_stat = target.stat()
        except OSError as error:
            raise ScanError(f"unable to inspect {relative_path}: {error}") from error
    if not stat.S_ISREG(file_stat.st_mode):
        raise ScanError(f"not a regular file: {relative_path}")
    if file_stat.st_size > MAX_SOURCE_BYTES:
        raise ScanError(
            f"{label} exceeds {MAX_SOURCE_BYTES} bytes: {relative_path}"
        )
    return target


def _safe_read_text(root: Path, path: Path, label: str) -> str:
    target = _safe_file_target(root, path, label)
    try:
        payload = target.read_bytes()
    except OSError as error:
        raise ScanError(f"unable to read {_relative_path(root, path)}: {error}") from error
    if len(payload) > MAX_SOURCE_BYTES:
        raise ScanError(
            f"{label} exceeds {MAX_SOURCE_BYTES} bytes: {_relative_path(root, path)}"
        )
    try:
        return payload.decode("utf-8")
    except UnicodeError as error:
        raise ScanError(
            f"unable to decode {_relative_path(root, path)} as UTF-8: {error}"
        ) from error


def _source_files(root: Path) -> list[Path]:
    root = root.resolve(strict=True)
    files = []

    def visit(directory: Path) -> None:
        relative_directory = (
            "." if directory == root else _relative_path(root, directory)
        )
        try:
            with os.scandir(str(directory)) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
        except OSError as error:
            raise ScanError(
                f"unreadable directory: {relative_directory}: {error}"
            ) from error
        for entry in entries:
            path = directory / entry.name
            try:
                entry_stat = entry.stat(follow_symlinks=False)
            except OSError as error:
                raise ScanError(
                    f"unable to inspect {_relative_path(root, path)}: {error}"
                ) from error
            if stat.S_ISDIR(entry_stat.st_mode):
                if entry.name not in SKIP_DIRS:
                    visit(path)
                continue
            if stat.S_ISLNK(entry_stat.st_mode):
                if entry.name in SKIP_DIRS:
                    continue
                try:
                    target = path.resolve(strict=True)
                except OSError as error:
                    raise ScanError(
                        f"unsafe source symlink: {_relative_path(root, path)}: {error}"
                    ) from error
                if not _is_contained(root, target):
                    raise ScanError(
                        "unsafe source symlink escapes root: "
                        f"{_relative_path(root, path)}"
                    )
                if target.is_dir():
                    raise ScanError(
                        "source directory symlink is not supported: "
                        f"{_relative_path(root, path)}"
                    )
                if path.suffix.lower() in SOURCE_SUFFIXES:
                    _safe_file_target(root, path, "source file")
                    files.append(path)
                continue
            if path.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            if not stat.S_ISREG(entry_stat.st_mode):
                raise ScanError(
                    f"not a regular file: {_relative_path(root, path)}"
                )
            if entry_stat.st_size > MAX_SOURCE_BYTES:
                raise ScanError(
                    f"source file exceeds {MAX_SOURCE_BYTES} bytes: "
                    f"{_relative_path(root, path)}"
                )
            files.append(path)

    visit(root)
    return sorted(files, key=lambda path: _relative_path(root, path))


def _manifest_dependencies(manifest: object) -> dict[str, str]:
    if not isinstance(manifest, dict):
        return {}
    dependencies = {}
    for group_name in _DEPENDENCY_GROUPS:
        group = manifest.get(group_name, {})
        if isinstance(group, dict):
            dependencies.update(
                (str(package), str(specification))
                for package, specification in group.items()
            )
    return dependencies


def _regex_can_start(tokens: list[_Token], context_start: int) -> bool:
    if len(tokens) == context_start:
        return True
    previous = tokens[-1]
    if previous.value in {"+", "-"}:
        # Only an entire two-character run is postfix here. In `x+++ /re/`,
        # the maximal run is `+++` (`x++` then binary `+`), so `/re/` starts
        # a regex; inspecting just the final adjacent pair gets that wrong.
        operator_run_start = len(tokens) - 1
        while (
            operator_run_start > context_start
            and tokens[operator_run_start - 1].value == previous.value
            and tokens[operator_run_start - 1].end
            == tokens[operator_run_start].start
        ):
            operator_run_start -= 1
        if len(tokens) - operator_run_start == 2:
            return False
    if previous.kind == "control_close":
        return True
    if previous.kind == "identifier":
        return previous.value in {
            "await",
            "case",
            "delete",
            "in",
            "instanceof",
            "of",
            "return",
            "throw",
            "typeof",
            "void",
            "yield",
        }
    return previous.kind == "punctuation" and previous.value in {
        "(",
        "[",
        "{",
        "=",
        ",",
        ":",
        ";",
        "!",
        "&",
        "|",
        "?",
        "+",
        "-",
        "*",
        "%",
        "^",
        "~",
        "<",
        ">",
    }


def _starts_control_head(tokens: list[_Token], context_start: int) -> bool:
    if len(tokens) == context_start:
        return False
    previous = tokens[-1]
    if previous.kind != "identifier":
        return False
    if previous.value in _CONTROL_HEAD_KEYWORDS:
        return (
            len(tokens) == context_start + 1 or tokens[-2].value != "."
        )
    return (
        previous.value == "await"
        and len(tokens) >= context_start + 2
        and tokens[-2].kind == "identifier"
        and tokens[-2].value == "for"
    )


def _lex_source(
    source: str,
    ignored_ranges: Optional[list[tuple[int, int]]] = None,
) -> list[_Token]:
    tokens = []
    length = len(source)

    def scan_template(index: int, line: int) -> tuple[int, int]:
        template_line = line
        index += 1
        while index < length:
            character = source[index]
            if character == "\\" and index + 1 < length:
                if source[index + 1] == "\n":
                    line += 1
                index += 2
                continue
            if character == "`":
                tokens.append(_Token("literal", "", template_line))
                return index + 1, line
            if source.startswith("${", index):
                index, line = scan_code(index + 2, line, True)
                if index < length and source[index] == "}":
                    index += 1
                continue
            if character == "\n":
                line += 1
            index += 1
        tokens.append(_Token("literal", "", template_line))
        return index, line

    def scan_code(
        index: int, line: int, stop_at_closing_brace: bool = False
    ) -> tuple[int, int]:
        context_start = len(tokens)
        brace_depth = 0
        parenthesis_roles = []
        while index < length:
            character = source[index]
            if stop_at_closing_brace and character == "}" and brace_depth == 0:
                return index, line
            if character.isspace():
                if character == "\n":
                    line += 1
                index += 1
                continue

            if source.startswith("//", index):
                comment_start = index
                newline = source.find("\n", index + 2)
                comment_end = length if newline == -1 else newline
                if ignored_ranges is not None:
                    ignored_ranges.append((comment_start, comment_end))
                index = comment_end
                continue

            if source.startswith("/*", index):
                comment_start = index
                end = source.find("*/", index + 2)
                comment_end = length if end == -1 else end + 2
                if ignored_ranges is not None:
                    ignored_ranges.append((comment_start, comment_end))
                line += source.count("\n", index, comment_end)
                index = comment_end
                continue

            is_jsx_closing_tag = index > 0 and source[index - 1] == "<"
            if (
                character == "/"
                and not is_jsx_closing_tag
                and _regex_can_start(tokens, context_start)
            ):
                regex_start = index
                token_line = line
                index += 1
                in_character_class = False
                while index < length:
                    character = source[index]
                    if character == "\\" and index + 1 < length:
                        index += 2
                        continue
                    if character == "[":
                        in_character_class = True
                    elif character == "]":
                        in_character_class = False
                    elif character == "/" and not in_character_class:
                        index += 1
                        while index < length and source[index].isalpha():
                            index += 1
                        break
                    elif character == "\n":
                        line += 1
                        break
                    index += 1
                if ignored_ranges is not None:
                    ignored_ranges.append((regex_start, index))
                tokens.append(
                    _Token("literal", "", token_line, regex_start, index)
                )
                continue

            if character in {"'", '"'}:
                token_start = index
                quote = character
                token_line = line
                value = []
                index += 1
                while index < length:
                    character = source[index]
                    if character == "\\" and index + 1 < length:
                        escaped = source[index + 1]
                        if escaped == "\n":
                            line += 1
                        else:
                            value.append(escaped)
                        index += 2
                        continue
                    if character == quote:
                        index += 1
                        break
                    if character == "\n":
                        line += 1
                    value.append(character)
                    index += 1
                tokens.append(
                    _Token(
                        "string", "".join(value), token_line, token_start, index
                    )
                )
                continue

            if character == "`":
                index, line = scan_template(index, line)
                continue

            if character.isalpha() or character in {"_", "$"}:
                start = index
                index += 1
                while index < length and (
                    source[index].isalnum() or source[index] in {"_", "$"}
                ):
                    index += 1
                tokens.append(
                    _Token(
                        "identifier", source[start:index], line, start, index
                    )
                )
                continue

            token_kind = "punctuation"
            if character == "(":
                parenthesis_roles.append(
                    _starts_control_head(tokens, context_start)
                )
            elif character == ")":
                closes_control_head = (
                    parenthesis_roles.pop() if parenthesis_roles else False
                )
                if closes_control_head:
                    token_kind = "control_close"
            elif character == "{":
                brace_depth += 1
            elif character == "}" and brace_depth:
                brace_depth -= 1
            tokens.append(
                _Token(token_kind, character, line, index, index + 1)
            )
            index += 1

        return index, line

    scan_code(0, 1)
    return tokens


def _module_references(
    source: str, tokens: Optional[list[_Token]] = None
) -> Iterable[tuple[str, int]]:
    if tokens is None:
        tokens = _lex_source(source)
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        if token.kind != "identifier" or (
            previous is not None and previous.value == "."
        ):
            continue
        if token.value not in {"import", "export", "require"}:
            continue
        following_index = index + 1

        if token.value == "require":
            if (
                following_index + 1 < len(tokens)
                and tokens[following_index].value == "("
                and tokens[following_index + 1].kind == "string"
            ):
                package = tokens[following_index + 1]
                yield package.value, package.line
            continue

        if token.value == "import":
            if (
                following_index < len(tokens)
                and tokens[following_index].kind == "string"
            ):
                package = tokens[following_index]
                yield package.value, package.line
                continue
            if (
                following_index + 1 < len(tokens)
                and tokens[following_index].value == "("
                and tokens[following_index + 1].kind == "string"
            ):
                package = tokens[following_index + 1]
                yield package.value, package.line
                continue

        if token.value not in {"import", "export"}:
            continue
        while following_index < len(tokens):
            candidate = tokens[following_index]
            if candidate.value == ";":
                break
            if (
                candidate.kind == "identifier"
                and candidate.value == "from"
                and following_index + 1 < len(tokens)
                and tokens[following_index + 1].kind == "string"
            ):
                package = tokens[following_index + 1]
                yield package.value, package.line
                break
            following_index += 1


def _runtime_module_references(
    source: str, tokens: Optional[list[_Token]] = None
) -> Iterable[tuple[str, int]]:
    """Yield statically resolvable module edges that survive TypeScript erase."""
    if tokens is None:
        tokens = _lex_source(source)
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        if token.kind != "identifier" or (
            previous is not None and previous.value == "."
        ):
            continue
        if token.value not in {"import", "export", "require"}:
            continue
        following_index = index + 1

        if token.value == "require":
            if (
                following_index + 1 < len(tokens)
                and tokens[following_index].value == "("
                and tokens[following_index + 1].kind == "string"
            ):
                package = tokens[following_index + 1]
                yield package.value, package.line
            continue

        if token.value == "import":
            if (
                following_index < len(tokens)
                and tokens[following_index].kind == "string"
            ):
                package = tokens[following_index]
                yield package.value, package.line
                continue
            if (
                following_index + 1 < len(tokens)
                and tokens[following_index].value == "("
                and tokens[following_index + 1].kind == "string"
            ):
                package = tokens[following_index + 1]
                yield package.value, package.line
                continue
            if (
                following_index < len(tokens)
                and tokens[following_index].value == "type"
            ):
                continue

        if token.value == "export" and (
            following_index < len(tokens)
            and tokens[following_index].value == "type"
        ):
            continue
        while following_index < len(tokens):
            candidate = tokens[following_index]
            if candidate.value == ";":
                break
            if (
                candidate.kind == "identifier"
                and candidate.value == "from"
                and following_index + 1 < len(tokens)
                and tokens[following_index + 1].kind == "string"
            ):
                if not _module_clause_has_runtime_binding(
                    tokens, index + 1, following_index
                ):
                    break
                package = tokens[following_index + 1]
                yield package.value, package.line
                break
            following_index += 1


def _module_clause_has_runtime_binding(
    tokens: list[_Token], start: int, end: int
) -> bool:
    """Whether an ESM import/export clause contains a value binding."""
    if start >= end or tokens[start].value == "type":
        return False
    if tokens[start].kind == "identifier" or tokens[start].value == "*":
        return True
    opening = next(
        (
            position
            for position in range(start, end)
            if tokens[position].value == "{"
        ),
        None,
    )
    if opening is None:
        return False
    position = opening + 1
    while position < end and tokens[position].value != "}":
        if tokens[position].value == ",":
            position += 1
            continue
        if tokens[position].value == "type":
            position += 1
            while (
                position < end
                and tokens[position].value not in {",", "}"}
            ):
                position += 1
            continue
        if tokens[position].kind == "identifier":
            return True
        position += 1
    return False


def _runtime_import_bindings(
    tokens: list[_Token],
) -> dict[str, str]:
    """Map local ESM import bindings to their source specifiers."""
    bindings = {}
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        if (
            token.kind != "identifier"
            or token.value != "import"
            or (previous is not None and previous.value == ".")
        ):
            continue
        cursor = index + 1
        if cursor >= len(tokens) or tokens[cursor].value in {"(", "type"}:
            continue
        statement_end = cursor
        from_index = None
        while statement_end < len(tokens):
            if tokens[statement_end].value == ";":
                break
            if tokens[statement_end].value == "from":
                from_index = statement_end
                break
            statement_end += 1
        if (
            from_index is None
            or from_index + 1 >= len(tokens)
            or tokens[from_index + 1].kind != "string"
        ):
            continue
        specifier = tokens[from_index + 1].value
        if tokens[cursor].kind == "identifier":
            bindings[tokens[cursor].value] = specifier
        opening = next(
            (
                position
                for position in range(cursor, from_index)
                if tokens[position].value == "{"
            ),
            None,
        )
        if opening is None:
            continue
        position = opening + 1
        while position < from_index and tokens[position].value != "}":
            if tokens[position].value == ",":
                position += 1
                continue
            if tokens[position].value == "type":
                position += 1
                while (
                    position < from_index
                    and tokens[position].value not in {",", "}"}
                ):
                    position += 1
                continue
            if tokens[position].kind != "identifier":
                position += 1
                continue
            local_name = tokens[position].value
            position += 1
            if (
                position + 1 < from_index
                and tokens[position].value == "as"
                and tokens[position + 1].kind == "identifier"
            ):
                local_name = tokens[position + 1].value
                position += 2
            bindings[local_name] = specifier
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in {"const", "let", "var"}:
            continue
        cursor = index + 1
        if cursor >= len(tokens):
            continue
        if tokens[cursor].kind == "identifier":
            if (
                cursor + 4 < len(tokens)
                and tokens[cursor + 1].value == "="
                and tokens[cursor + 2].value == "require"
                and tokens[cursor + 3].value == "("
                and tokens[cursor + 4].kind == "string"
            ):
                bindings[tokens[cursor].value] = tokens[cursor + 4].value
            continue
        if tokens[cursor].value != "{":
            continue
        closing = cursor + 1
        while closing < len(tokens) and tokens[closing].value != "}":
            closing += 1
        if (
            closing + 4 >= len(tokens)
            or tokens[closing + 1].value != "="
            or tokens[closing + 2].value != "require"
            or tokens[closing + 3].value != "("
            or tokens[closing + 4].kind != "string"
        ):
            continue
        specifier = tokens[closing + 4].value
        position = cursor + 1
        while position < closing:
            if tokens[position].value == ",":
                position += 1
                continue
            if tokens[position].kind != "identifier":
                position += 1
                continue
            local_name = tokens[position].value
            position += 1
            if (
                position + 1 < closing
                and tokens[position].value == ":"
                and tokens[position + 1].kind == "identifier"
            ):
                local_name = tokens[position + 1].value
                position += 2
            bindings[local_name] = specifier
            while position < closing and tokens[position].value != ",":
                position += 1
    return bindings


def _runtime_reexport_references(
    tokens: list[_Token],
) -> list[str]:
    """Return local-capable ESM re-export edges that survive type erasure."""
    references = []
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value != "export":
            continue
        cursor = index + 1
        if cursor >= len(tokens) or tokens[cursor].value == "type":
            continue
        from_index = None
        while cursor < len(tokens) and tokens[cursor].value != ";":
            if tokens[cursor].value == "from":
                from_index = cursor
                break
            cursor += 1
        if (
            from_index is None
            or from_index + 1 >= len(tokens)
            or tokens[from_index + 1].kind != "string"
            or not _module_clause_has_runtime_binding(
                tokens, index + 1, from_index
            )
        ):
            continue
        references.append(tokens[from_index + 1].value)
    return references


def _runtime_react_fragments(
    tokens: list[_Token],
) -> tuple[set[str], set[str]]:
    """Return local named/default-or-namespace React fragment bindings."""
    named = set()
    namespaces = set()
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value != "import":
            continue
        cursor = index + 1
        if cursor >= len(tokens) or tokens[cursor].value in {"(", "type"}:
            continue
        from_index = None
        position = cursor
        while position < len(tokens) and tokens[position].value != ";":
            if tokens[position].value == "from":
                from_index = position
                break
            position += 1
        if (
            from_index is None
            or from_index + 1 >= len(tokens)
            or tokens[from_index + 1].kind != "string"
            or tokens[from_index + 1].value != "react"
        ):
            continue
        if tokens[cursor].kind == "identifier":
            namespaces.add(tokens[cursor].value)
        if (
            tokens[cursor].value == "*"
            and cursor + 2 < from_index
            and tokens[cursor + 1].value == "as"
            and tokens[cursor + 2].kind == "identifier"
        ):
            namespaces.add(tokens[cursor + 2].value)
        opening = next(
            (
                position
                for position in range(cursor, from_index)
                if tokens[position].value == "{"
            ),
            None,
        )
        if opening is None:
            continue
        position = opening + 1
        while position < from_index and tokens[position].value != "}":
            if tokens[position].value in {",", "type"}:
                position += 1
                continue
            original = tokens[position].value
            local = original
            position += 1
            if (
                position + 1 < from_index
                and tokens[position].value == "as"
                and tokens[position + 1].kind == "identifier"
            ):
                local = tokens[position + 1].value
                position += 2
            if original == "Fragment":
                named.add(local)
    return named, namespaces


def _has_unresolved_dynamic_module_reference(tokens: list[_Token]) -> bool:
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        if (
            token.kind != "identifier"
            or token.value not in {"import", "require"}
            or (previous is not None and previous.value == ".")
        ):
            continue
        if index + 1 >= len(tokens) or tokens[index + 1].value != "(":
            continue
        if index + 2 >= len(tokens) or tokens[index + 2].kind != "string":
            return True
    return False


def _newline_starts(source: str) -> tuple[int, ...]:
    return (0,) + tuple(
        index + 1 for index, character in enumerate(source) if character == "\n"
    )


def _mask_ranges(
    source: str, ranges: Iterable[tuple[int, int]]
) -> str:
    masked = list(source)
    for start, end in ranges:
        for position in range(start, end):
            if masked[position] != "\n":
                masked[position] = " "
    return "".join(masked)


def _mask_style_comments(source: str, allow_line_comments: bool) -> str:
    """Mask CSS/SCSS comments without changing source offsets."""
    masked = list(source)
    index = 0
    quote = ""
    while index < len(source):
        character = source[index]
        if quote:
            if character == "\\" and index + 1 < len(source):
                index += 2
                continue
            if character == quote:
                quote = ""
            index += 1
            continue
        if character in {"'", '"'}:
            quote = character
            index += 1
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            comment_end = len(source) if end == -1 else end + 2
            for position in range(index, comment_end):
                if masked[position] != "\n":
                    masked[position] = " "
            index = comment_end
            continue
        if allow_line_comments and source.startswith("//", index):
            newline = source.find("\n", index + 2)
            comment_end = len(source) if newline == -1 else newline
            for position in range(index, comment_end):
                masked[position] = " "
            index = comment_end
            continue
        index += 1
    return "".join(masked)


def _scan_css_value_end(source: str, start: int) -> tuple[int, str]:
    index = start
    quote = ""
    parentheses = 0
    brackets = 0
    while index < len(source):
        character = source[index]
        if quote:
            if character == "\\" and index + 1 < len(source):
                index += 2
                continue
            if character == quote:
                quote = ""
            index += 1
            continue
        if character in {"'", '"'}:
            quote = character
        elif character == "(":
            parentheses += 1
        elif character == ")" and parentheses:
            parentheses -= 1
        elif character == "[":
            brackets += 1
        elif character == "]" and brackets:
            brackets -= 1
        elif not parentheses and not brackets and character in ";}":
            return index, character
        elif not parentheses and not brackets and character == "{":
            return index, character
        index += 1
    return index, ""


def _css_declarations(
    source: str, allow_line_comments: bool
) -> tuple[str, list[_CssDeclaration]]:
    masked = _mask_style_comments(source, allow_line_comments)
    declarations = []
    block_headers: list[str] = []
    segment_start = 0
    index = 0
    quote = ""
    parentheses = 0
    brackets = 0
    property_pattern = re.compile(r"(?:--)?[-a-zA-Z_][-\w]*")
    while index < len(masked):
        character = masked[index]
        if quote:
            if character == "\\" and index + 1 < len(masked):
                index += 2
                continue
            if character == quote:
                quote = ""
            index += 1
            continue
        if character in {"'", '"'}:
            quote = character
            index += 1
            continue
        if character == "(":
            parentheses += 1
        elif character == ")" and parentheses:
            parentheses -= 1
        elif character == "[":
            brackets += 1
        elif character == "]" and brackets:
            brackets -= 1
        elif not parentheses and not brackets and character == "{":
            block_headers.append(masked[segment_start:index].strip().lower())
            segment_start = index + 1
        elif not parentheses and not brackets and character == "}":
            if block_headers:
                block_headers.pop()
            segment_start = index + 1
        elif not parentheses and not brackets and character == ";":
            segment_start = index + 1
        elif not parentheses and not brackets and character == ":" and block_headers:
            raw_property = masked[segment_start:index].strip()
            if property_pattern.fullmatch(raw_property):
                value_start = index + 1
                while value_start < len(masked) and masked[value_start].isspace():
                    value_start += 1
                value_end, delimiter = _scan_css_value_end(masked, value_start)
                if delimiter != "{":
                    declarations.append(
                        _CssDeclaration(
                            property=raw_property,
                            value=masked[value_start:value_end].strip(),
                            start=segment_start
                            + len(masked[segment_start:index])
                            - len(masked[segment_start:index].lstrip()),
                            value_start=value_start,
                            in_font_face=any(
                                header.startswith("@font-face")
                                for header in block_headers
                            ),
                            block_header=(
                                block_headers[-1] if block_headers else ""
                            ),
                        )
                    )
        index += 1
    return masked, declarations


def _mask_quoted_and_url_values(value: str) -> str:
    masked = list(value)
    index = 0
    while index < len(value):
        if value[index] in {"'", '"'}:
            quote = value[index]
            start = index
            index += 1
            while index < len(value):
                if value[index] == "\\" and index + 1 < len(value):
                    index += 2
                    continue
                if value[index] == quote:
                    index += 1
                    break
                index += 1
            for position in range(start, index):
                masked[position] = " "
            continue
        url_match = re.match(r"url\s*\(", value[index:], re.IGNORECASE)
        if url_match:
            start = index
            index += url_match.end()
            depth = 1
            quote = ""
            while index < len(value) and depth:
                character = value[index]
                if quote:
                    if character == "\\" and index + 1 < len(value):
                        index += 2
                        continue
                    if character == quote:
                        quote = ""
                elif character in {"'", '"'}:
                    quote = character
                elif character == "(":
                    depth += 1
                elif character == ")":
                    depth -= 1
                index += 1
            for position in range(start, index):
                masked[position] = " "
            continue
        index += 1
    return "".join(masked)


def _mask_url_functions(value: str) -> str:
    masked = list(value)
    index = 0
    while index < len(value):
        match = re.match(r"url\s*\(", value[index:], re.IGNORECASE)
        if match is None:
            index += 1
            continue
        start = index
        index += match.end()
        depth = 1
        quote = ""
        while index < len(value) and depth:
            character = value[index]
            if quote:
                if character == "\\" and index + 1 < len(value):
                    index += 2
                    continue
                if character == quote:
                    quote = ""
            elif character in {"'", '"', "`"}:
                quote = character
            elif character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
            index += 1
        for position in range(start, index):
            if masked[position] != "\n":
                masked[position] = " "
    return "".join(masked)


def _balanced_function_end(value: str, opening: int) -> int:
    depth = 0
    quote = ""
    index = opening
    while index < len(value):
        character = value[index]
        if quote:
            if character == "\\" and index + 1 < len(value):
                index += 2
                continue
            if character == quote:
                quote = ""
        elif character in {"'", '"'}:
            quote = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return len(value)


def _hard_color_offsets(
    value: str, preserve_quoted_literals: bool
) -> list[int]:
    candidate = (
        _mask_url_functions(value)
        if preserve_quoted_literals
        else _mask_quoted_and_url_values(value)
    )
    offsets = [match.start() for match in _COLOR_LITERAL_RE.finditer(candidate)]
    for match in _COLOR_FUNCTION_RE.finditer(candidate):
        function_end = _balanced_function_end(candidate, match.end() - 1)
        function_value = candidate[match.start():function_end]
        if not _uses_bound_value(function_value):
            offsets.append(match.start())
    return sorted(set(offsets))


def _style_module_references(source: str) -> Iterator[str]:
    masked = _mask_style_comments(source, allow_line_comments=True)
    pattern = re.compile(
        r"@(?:import|use|forward)\s+(?:url\(\s*)?(?:"
        r"['\"](?P<quoted>[^'\"]+)['\"]|"
        r"(?P<unquoted>[^\s);]+))",
        re.IGNORECASE,
    )
    for match in pattern.finditer(masked):
        yield match.group("quoted") or match.group("unquoted")


def _has_light_theme_css_import(source: str) -> bool:
    index = 0
    brace_depth = 0
    statement_start = True
    while index < len(source):
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = len(source) if end == -1 else end + 2
            continue
        if source.startswith("//", index):
            newline = source.find("\n", index + 2)
            index = len(source) if newline == -1 else newline
            continue
        character = source[index]
        if character.isspace():
            index += 1
            continue
        if character in {"'", '"'}:
            if brace_depth == 0:
                statement_start = False
            quote = character
            index += 1
            while index < len(source):
                if source[index] == "\\" and index + 1 < len(source):
                    index += 2
                    continue
                if source[index] == quote:
                    index += 1
                    break
                index += 1
            continue
        if (
            character == "@"
            and brace_depth == 0
            and statement_start
            and _CSS_LIGHT_THEME_IMPORT_RE.match(source, index)
        ):
            return True
        if character == "{":
            brace_depth += 1
            statement_start = False
        elif character == "}":
            brace_depth = max(0, brace_depth - 1)
            if brace_depth == 0:
                statement_start = True
        elif character == ";" and brace_depth == 0:
            statement_start = True
        elif brace_depth == 0:
            statement_start = False
        index += 1
    return False


def _matches_allowed_token_glob(
    relative_path: str, allowed_token_globs: tuple[str, ...]
) -> bool:
    for pattern in allowed_token_globs:
        if fnmatch.fnmatchcase(relative_path, pattern):
            return True
        if pattern.startswith("**/") and fnmatch.fnmatchcase(
            relative_path, pattern[3:]
        ):
            return True
    return False


def _is_semantic_token_export(
    declaration: _CssDeclaration, token_bridge: bool
) -> bool:
    """Limit token-file exemptions to root-scoped CSS variable exports."""
    if not token_bridge or not declaration.property.startswith("--"):
        return False
    selectors = (
        selector.strip().lower()
        for selector in declaration.block_header.split(",")
    )
    return any(selector == ":root" for selector in selectors)


def _normalized_value(value: str) -> str:
    value = value.strip()
    while len(value) >= 2 and (
        (value[0], value[-1]) in {("'", "'"), ('"', '"'), ("{", "}")}
    ):
        value = value[1:-1].strip()
    return value


def _uses_bound_value(value: str) -> bool:
    normalized = _normalized_value(value)
    return (
        normalized.lower() in _ALLOWED_CSS_KEYWORDS
        or _BOUND_VALUE_RE.search(normalized) is not None
    )


def _runtime_primer_imports(
    tokens: list[_Token],
) -> tuple[dict[str, set[str]], set[str]]:
    named_imports: dict[str, set[str]] = {}
    namespace_imports = set()
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        if (
            token.kind != "identifier"
            or token.value != "import"
            or (previous is not None and previous.value == ".")
        ):
            continue
        clause_start = index + 1
        if clause_start >= len(tokens):
            continue
        if tokens[clause_start].value in {"(", "type"}:
            continue

        statement_end = clause_start
        package = None
        while statement_end < len(tokens):
            candidate = tokens[statement_end]
            if candidate.value == ";":
                break
            if (
                candidate.kind == "identifier"
                and candidate.value == "from"
                and statement_end + 1 < len(tokens)
                and tokens[statement_end + 1].kind == "string"
            ):
                package = tokens[statement_end + 1].value
                break
            statement_end += 1
        if package != "@primer/react":
            continue

        if (
            tokens[clause_start].value == "*"
            and clause_start + 2 < len(tokens)
            and tokens[clause_start + 1].value == "as"
            and tokens[clause_start + 2].kind == "identifier"
        ):
            namespace_imports.add(tokens[clause_start + 2].value)
            continue

        opening_brace = next(
            (
                position
                for position in range(clause_start, statement_end)
                if tokens[position].value == "{"
            ),
            None,
        )
        if opening_brace is None:
            continue
        position = opening_brace + 1
        while position < statement_end and tokens[position].value != "}":
            if tokens[position].value == ",":
                position += 1
                continue
            is_type_only = tokens[position].value == "type"
            if is_type_only:
                position += 1
            if (
                position >= statement_end
                or tokens[position].kind != "identifier"
            ):
                position += 1
                continue
            original_name = tokens[position].value
            local_name = original_name
            position += 1
            if (
                position + 1 < statement_end
                and tokens[position].value == "as"
                and tokens[position + 1].kind == "identifier"
            ):
                local_name = tokens[position + 1].value
                position += 2
            if not is_type_only:
                named_imports.setdefault(original_name, set()).add(local_name)
            while (
                position < statement_end
                and tokens[position].value not in {",", "}"}
            ):
                position += 1

    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in {"const", "let", "var"}:
            continue
        cursor = index + 1
        if cursor >= len(tokens):
            continue
        if tokens[cursor].kind == "identifier":
            local_name = tokens[cursor].value
            if (
                cursor + 4 < len(tokens)
                and tokens[cursor + 1].value == "="
                and tokens[cursor + 2].value == "require"
                and tokens[cursor + 3].value == "("
                and tokens[cursor + 4].kind == "string"
                and tokens[cursor + 4].value == "@primer/react"
            ):
                namespace_imports.add(local_name)
            continue
        if tokens[cursor].value != "{":
            continue
        closing = cursor + 1
        while closing < len(tokens) and tokens[closing].value != "}":
            closing += 1
        if (
            closing + 4 >= len(tokens)
            or tokens[closing + 1].value != "="
            or tokens[closing + 2].value != "require"
            or tokens[closing + 3].value != "("
            or tokens[closing + 4].kind != "string"
            or tokens[closing + 4].value != "@primer/react"
        ):
            continue
        position = cursor + 1
        while position < closing:
            if tokens[position].value == ",":
                position += 1
                continue
            if tokens[position].kind != "identifier":
                position += 1
                continue
            original_name = tokens[position].value
            local_name = original_name
            position += 1
            if (
                position + 1 < closing
                and tokens[position].value == ":"
                and tokens[position + 1].kind == "identifier"
            ):
                local_name = tokens[position + 1].value
                position += 2
            named_imports.setdefault(original_name, set()).add(local_name)
            while position < closing and tokens[position].value != ",":
                position += 1
    return named_imports, namespace_imports


def _custom_primitive_declarations(
    tokens: list[_Token],
) -> Iterable[tuple[str, int]]:
    declaration_keywords = {"class", "const", "function", "let", "var"}
    for index, token in enumerate(tokens[:-1]):
        if token.kind != "identifier" or token.value not in declaration_keywords:
            continue
        if index and tokens[index - 1].value == "declare":
            continue
        name = tokens[index + 1]
        if name.kind == "identifier" and name.value in _PRIMER_PRIMITIVES:
            yield name.value, name.line


def _jsx_can_start(tokens: list[_Token], index: int) -> bool:
    if index == 0:
        return True
    previous = tokens[index - 1]
    if previous.kind == "identifier":
        return previous.value in {"case", "return", "yield"}
    return previous.value in {
        "(",
        "[",
        "{",
        "=",
        ">",
        ",",
        ":",
        ";",
        "?",
        "!",
        "&",
        "|",
    }


def _jsx_elements(tokens: list[_Token]) -> list[_JsxElement]:
    """Parse JSX with explicit stacks so valid depth is not recursion-bound."""
    token_count = len(tokens)

    def tag_name_at(position: int, limit: int) -> Optional[tuple[str, int]]:
        if position >= limit or tokens[position].kind != "identifier":
            return None
        name = tokens[position].value
        position += 1
        while (
            position + 1 < limit
            and tokens[position].value in {"-", ".", ":"}
            and tokens[position + 1].kind == "identifier"
        ):
            name += tokens[position].value + tokens[position + 1].value
            position += 2
        return name, position

    def opening_at(
        position: int, limit: int
    ) -> Optional[
        tuple[Optional[str], int, bool, list[tuple[int, int]]]
    ]:
        if position + 1 >= limit or tokens[position].value != "<":
            return None
        name_position = position + 1
        if tokens[name_position].value == ">":
            return None, name_position, False, []
        parsed_name = tag_name_at(name_position, limit)
        if parsed_name is None:
            return None
        component, cursor = parsed_name
        brace_depth = 0
        expression_start = -1
        expression_ranges = []
        while cursor < limit:
            candidate = tokens[cursor]
            if candidate.value == "{":
                if brace_depth == 0:
                    expression_start = cursor + 1
                brace_depth += 1
            elif candidate.value == "}" and brace_depth:
                brace_depth -= 1
                if brace_depth == 0:
                    expression_ranges.append((expression_start, cursor))
            elif brace_depth == 0 and candidate.value == ">":
                return (
                    component,
                    cursor,
                    tokens[cursor - 1].value == "/",
                    expression_ranges,
                )
            elif brace_depth == 0 and candidate.value in {";", "<"}:
                return None
            cursor += 1
        return None

    def closing_end_at(
        position: int, component: Optional[str], limit: int
    ) -> Optional[int]:
        if (
            position + 2 >= limit
            or tokens[position].value != "<"
            or tokens[position + 1].value != "/"
        ):
            return None
        if component is None:
            return position + 3 if tokens[position + 2].value == ">" else None
        parsed_name = tag_name_at(position + 2, limit)
        if parsed_name is None:
            return None
        closing_name, cursor = parsed_name
        if (
            closing_name != component
            or cursor >= limit
            or tokens[cursor].value != ">"
        ):
            return None
        return cursor + 1

    def matching_brace(position: int, limit: int) -> Optional[int]:
        depth = 0
        while position < limit:
            if tokens[position].value == "{":
                depth += 1
            elif tokens[position].value == "}":
                depth -= 1
                if depth == 0:
                    return position
            position += 1
        return None

    elements: list[_JsxElement] = []
    pending_ranges: list[tuple[int, int, Optional[int]]] = [
        (0, token_count, None)
    ]
    pending_index = 0
    while pending_index < len(pending_ranges):
        start, limit, inherited_parent = pending_ranges[pending_index]
        pending_index += 1
        frames: list[dict[str, object]] = [
            {
                "kind": "code",
                "cursor": start,
                "start": start,
                "limit": limit,
                "parent": inherited_parent,
            }
        ]
        while frames:
            frame = frames[-1]
            cursor = int(frame["cursor"])
            frame_limit = int(frame["limit"])
            if cursor >= frame_limit:
                frames.pop()
                continue

            if frame["kind"] == "element":
                component = frame["component"]
                closing_end = closing_end_at(
                    cursor,
                    component if isinstance(component, str) else None,
                    frame_limit,
                )
                if closing_end is not None:
                    frames.pop()
                    if frames:
                        frames[-1]["cursor"] = closing_end
                    continue
                if tokens[cursor].value == "{":
                    expression_end = matching_brace(cursor, frame_limit)
                    if expression_end is not None:
                        pending_ranges.append(
                            (
                                cursor + 1,
                                expression_end,
                                frame["child_parent"]
                                if isinstance(frame["child_parent"], int)
                                else inherited_parent,
                            )
                        )
                        frame["cursor"] = expression_end + 1
                        continue
                can_open = tokens[cursor].value == "<"
            else:
                can_open = tokens[cursor].value == "<" and (
                    cursor == int(frame["start"])
                    or _jsx_can_start(tokens, cursor)
                )

            if can_open:
                opening = opening_at(cursor, frame_limit)
                if opening is not None:
                    component, opening_end, self_closing, expression_ranges = opening
                    parent = frame["parent"]
                    if frame["kind"] == "element":
                        parent = frame["child_parent"]
                    element_index: Optional[int] = None
                    if component is not None:
                        element_index = len(elements)
                        elements.append(
                            _JsxElement(
                                component=component,
                                start=tokens[cursor].start,
                                opening_end=tokens[opening_end].end,
                                parent=parent if isinstance(parent, int) else None,
                            )
                        )
                    expression_parent = (
                        parent if isinstance(parent, int) else None
                    )
                    for expression_start, expression_end in expression_ranges:
                        pending_ranges.append(
                            (expression_start, expression_end, expression_parent)
                        )
                    frame["cursor"] = opening_end + 1
                    if not self_closing:
                        frames.append(
                            {
                                "kind": "element",
                                "cursor": opening_end + 1,
                                "limit": frame_limit,
                                "component": component,
                                "child_parent": (
                                    element_index
                                    if element_index is not None
                                    else expression_parent
                                ),
                                "parent": expression_parent,
                            }
                        )
                    continue
            frame["cursor"] = cursor + 1
    return elements


def _jsx_attributes(
    source: str, tags: list[tuple[str, int, int]]
) -> Iterator[_JsxAttribute]:
    def skip_quoted(index: int, limit: int) -> int:
        quote = source[index]
        index += 1
        while index < limit:
            if source[index] == "\\" and index + 1 < limit:
                index += 2
                continue
            if source[index] == quote:
                return index + 1
            index += 1
        return index

    def skip_braced(index: int, limit: int) -> int:
        depth = 0
        while index < limit:
            character = source[index]
            if character in {"'", '"', "`"}:
                index = skip_quoted(index, limit)
                continue
            if character == "{":
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    return index + 1
            index += 1
        return index

    for _component, tag_start, tag_end in tags:
        index = tag_start + 1
        while index < tag_end and (
            source[index].isalnum()
            or source[index] in {"_", "$", ".", ":", "-"}
        ):
            index += 1
        while index < tag_end:
            while index < tag_end and source[index].isspace():
                index += 1
            if index >= tag_end or source[index] in {"/", ">"}:
                break
            if source[index] == "{":
                index = skip_braced(index, tag_end)
                continue
            name_start = index
            if not (source[index].isalpha() or source[index] in {"_", "$"}):
                index += 1
                continue
            index += 1
            while index < tag_end and (
                source[index].isalnum()
                or source[index] in {"_", "$", ":", "-"}
            ):
                index += 1
            attribute = source[name_start:index]
            while index < tag_end and source[index].isspace():
                index += 1
            if index >= tag_end or source[index] != "=":
                continue
            index += 1
            while index < tag_end and source[index].isspace():
                index += 1
            value_start = index
            if index < tag_end and source[index] in {"'", '"', "`"}:
                index = skip_quoted(index, tag_end)
            elif index < tag_end and source[index] == "{":
                index = skip_braced(index, tag_end)
            else:
                while (
                    index < tag_end
                    and not source[index].isspace()
                    and source[index] not in {"/", ">"}
                ):
                    index += 1
            yield _JsxAttribute(
                name=attribute,
                value=source[value_start:index],
                start=name_start,
                value_start=value_start,
                value_end=index,
            )


def _jsx_style_ranges(
    source: str, tags: list[tuple[str, int, int]]
) -> list[tuple[int, int]]:
    return [
        (attribute.value_start, attribute.value_end)
        for attribute in _jsx_attributes(source, tags)
        if attribute.name in {"style", "sx"}
        and attribute.value.startswith("{")
    ]


def _style_object_property_ranges(
    source: str, start: int, end: int
) -> list[tuple[str, int, int]]:
    """Return top-level object property value ranges from a JSX style prop."""
    ranges = []
    index = start
    while index < end and source[index].isspace():
        index += 1
    if index < end and source[index] == "{":
        index += 1
    while index < end and source[index].isspace():
        index += 1
    if index < end and source[index] == "{":
        index += 1
    else:
        return ranges

    def skip_literal(position: int) -> int:
        quote = source[position]
        position += 1
        while position < end:
            if source[position] == "\\" and position + 1 < end:
                position += 2
                continue
            if source[position] == quote:
                return position + 1
            position += 1
        return position

    while index < end:
        while index < end and (source[index].isspace() or source[index] == ","):
            index += 1
        if index >= end or source[index] == "}":
            break
        if not (source[index].isalpha() or source[index] in {"_", "$"}):
            return []
        name_start = index
        index += 1
        while index < end and (
            source[index].isalnum() or source[index] in {"_", "$", "-"}
        ):
            index += 1
        name = source[name_start:index]
        while index < end and source[index].isspace():
            index += 1
        if index >= end or source[index] != ":":
            return []
        index += 1
        while index < end and source[index].isspace():
            index += 1
        value_start = index
        round_depth = square_depth = brace_depth = 0
        while index < end:
            character = source[index]
            if character in {"'", '"', "`"}:
                index = skip_literal(index)
                continue
            if character == "(":
                round_depth += 1
            elif character == ")" and round_depth:
                round_depth -= 1
            elif character == "[":
                square_depth += 1
            elif character == "]" and square_depth:
                square_depth -= 1
            elif character == "{":
                brace_depth += 1
            elif character == "}" and brace_depth:
                brace_depth -= 1
            elif not round_depth and not square_depth and not brace_depth:
                if character in {",", "}"}:
                    break
            index += 1
        value_end = index
        while value_end > value_start and source[value_end - 1].isspace():
            value_end -= 1
        ranges.append((name, value_start, value_end))
        if index < end and source[index] == ",":
            index += 1
    return ranges


def _tagged_template_ranges(source: str) -> list[tuple[int, int]]:
    ranges = []
    index = 0
    prefix_pattern = re.compile(
        r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$"
    )
    while index < len(source):
        if source[index] != "`":
            index += 1
            continue
        prefix_start = max(
            source.rfind(";", 0, index),
            source.rfind("=", 0, index),
            source.rfind("\n", 0, index),
        ) + 1
        is_tagged = prefix_pattern.search(source[prefix_start:index]) is not None
        content_start = index + 1
        index += 1
        while index < len(source):
            if source[index] == "\\" and index + 1 < len(source):
                index += 2
                continue
            if source[index] == "`":
                if is_tagged:
                    ranges.append((content_start, index))
                index += 1
                break
            index += 1
    return ranges


def _scan_jsx_visual_attributes(
    source: str,
    tags: list[tuple[str, int, int]],
    relative_path: str,
) -> list[Finding]:
    findings = []
    newline_starts = _newline_starts(source)
    for attribute in _jsx_attributes(source, tags):
        if attribute.name not in _JS_VISUAL_PROPERTIES:
            continue
        candidate = f"{attribute.name}={attribute.value}"
        match = _JS_VISUAL_PROP_RE.fullmatch(candidate)
        if match is None or _uses_bound_value(match.group("value")):
            continue
        findings.append(
            Finding(
                severity="warning",
                code="PDS007",
                path=relative_path,
                line=bisect_right(newline_starts, attribute.start),
                message=(
                    "Arbitrary visual literal; use a Primer token or "
                    "component prop instead"
                ),
            )
        )
    return findings


def _finding(
    severity: str,
    code: str,
    view: _SourceView,
    offset: int,
    message: str,
) -> Finding:
    return Finding(
        severity=severity,
        code=code,
        path=view.relative_path,
        line=view.line(offset),
        message=message,
    )


def _scan_style_view(
    view: _SourceView,
    allowed_token_globs: tuple[str, ...],
) -> list[Finding]:
    findings = []
    _masked, declarations = _css_declarations(
        view.text, allow_line_comments=view.path.suffix.lower() == ".scss"
    )
    token_bridge = _matches_allowed_token_glob(
        view.relative_path, allowed_token_globs
    )
    typography = {
        "font",
        "font-family",
        "font-size",
        "font-weight",
        "letter-spacing",
        "line-height",
    }
    visual = {
        "border-radius",
        "box-shadow",
        "column-gap",
        "gap",
        "margin",
        "margin-block",
        "margin-bottom",
        "margin-inline",
        "margin-left",
        "margin-right",
        "margin-top",
        "padding",
        "padding-block",
        "padding-bottom",
        "padding-inline",
        "padding-left",
        "padding-right",
        "padding-top",
        "row-gap",
    }
    for declaration in declarations:
        property_name = declaration.property.lower()
        is_custom_property = property_name.startswith("--")
        is_token_export = _is_semantic_token_export(
            declaration, token_bridge
        )
        if (
            not is_token_export
            and property_name not in {"content", "src"}
            and _hard_color_offsets(
                declaration.value, preserve_quoted_literals=False
            )
        ):
            findings.append(
                _finding(
                    "error",
                    "PDS004",
                    view,
                    declaration.start,
                    "Hard-coded color; bind a semantic Primer token instead",
                )
            )
        if (
            not is_custom_property
            and property_name in typography
            and not declaration.in_font_face
            and not _uses_bound_value(declaration.value)
        ):
            findings.append(
                _finding(
                    "error",
                    "PDS005",
                    view,
                    declaration.start,
                    "Hard-coded typography; bind a semantic Primer token instead",
                )
            )
        forum_candidate = _mask_quoted_and_url_values(declaration.value)
        if (
            not is_token_export
            and property_name not in {"content", "src"}
            and _DIRECT_FORUM_RE.search(forum_candidate)
        ):
            findings.append(
                _finding(
                    "error",
                    "PDS006",
                    view,
                    declaration.start,
                    "Direct Forum reference; map it through the semantic Primer layer",
                )
            )
        if (
            not is_custom_property
            and property_name in visual
            and not _uses_bound_value(declaration.value)
        ):
            findings.append(
                _finding(
                    "warning",
                    "PDS007",
                    view,
                    declaration.start,
                    "Arbitrary visual literal; use a Primer token or component prop instead",
                )
            )
    return findings


def _manual_evidence_finding(
    code: str, view: _SourceView, offset: int, description: str
) -> Finding:
    return _finding(
        "warning",
        code,
        view,
        offset,
        f"{description}; manual review required because the style context is unproven",
    )


def _scan_javascript_view(
    view: _SourceView,
    tokens: list[_Token],
    elements: list[_JsxElement],
    ignored_ranges: list[tuple[int, int]],
) -> list[Finding]:
    findings = []
    tags = [
        (element.component, element.start, element.opening_end)
        for element in elements
    ]
    style_ranges = _jsx_style_ranges(view.text, tags)
    typography_properties = {
        "font",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "letterSpacing",
        "lineHeight",
    }
    color_properties = {
        "background",
        "backgroundColor",
        "backgroundImage",
        "border",
        "borderBottom",
        "borderBottomColor",
        "borderColor",
        "borderInlineColor",
        "borderLeftColor",
        "borderRightColor",
        "borderTopColor",
        "boxShadow",
        "caretColor",
        "color",
        "columnRuleColor",
        "fill",
        "outline",
        "outlineColor",
        "stroke",
        "textDecorationColor",
        "textShadow",
    }
    for start, end in style_ranges:
        properties = _style_object_property_ranges(view.text, start, end)
        if not properties:
            fragment = view.text[start:end]
            if _hard_color_offsets(fragment, preserve_quoted_literals=True):
                findings.append(
                    _manual_evidence_finding(
                        "PDS004", view, start, "Possible hard-coded color"
                    )
                )
            if _DIRECT_FORUM_RE.search(fragment):
                findings.append(
                    _manual_evidence_finding(
                        "PDS006", view, start, "Possible direct Forum reference"
                    )
                )
            continue
        for property_name, value_start, value_end in properties:
            value = view.text[value_start:value_end]
            literal_value = (
                re.fullmatch(r"\s*" + _JS_LITERAL_VALUE + r"\s*", value)
                is not None
            )
            if property_name in color_properties:
                for offset in _hard_color_offsets(
                    value, preserve_quoted_literals=True
                ):
                    findings.append(
                        _finding(
                            "error",
                            "PDS004",
                            view,
                            value_start + offset,
                            "Hard-coded color; bind a semantic Primer token instead",
                        )
                    )
            if (
                property_name in typography_properties
                and not _uses_bound_value(value)
            ):
                findings.append(
                    _finding(
                        "error" if literal_value else "warning",
                        "PDS005",
                        view,
                        value_start,
                        (
                            "Hard-coded typography; bind a semantic Primer token instead"
                            if literal_value
                            else "Dynamic typography value; manual semantic-token review required"
                        ),
                    )
                )
            if (
                property_name != "content"
                and _DIRECT_FORUM_RE.search(value)
            ):
                findings.append(
                    _finding(
                        "error",
                        "PDS006",
                        view,
                        value_start,
                        "Direct Forum reference; map it through the semantic Primer layer",
                    )
                )
            if (
                property_name in _JS_VISUAL_PROPERTIES
                and not _uses_bound_value(value)
                and literal_value
            ):
                findings.append(
                    _finding(
                        "warning",
                        "PDS007",
                        view,
                        value_start,
                        "Arbitrary visual literal; use a Primer token or component prop instead",
                    )
                )

    typography_attributes = typography_properties
    color_attributes = color_properties
    for attribute in _jsx_attributes(view.text, tags):
        if attribute.name in typography_attributes:
            match = _JS_TYPOGRAPHY_PROP_RE.fullmatch(
                f"{attribute.name}={attribute.value}"
            )
            if match is not None and not _uses_bound_value(match.group("value")):
                findings.append(
                    _finding(
                        "error",
                        "PDS005",
                        view,
                        attribute.start,
                        "Hard-coded typography; bind a semantic Primer token instead",
                    )
                )
        if attribute.name in color_attributes and _hard_color_offsets(
            attribute.value, preserve_quoted_literals=True
        ):
            findings.append(
                _finding(
                    "error",
                    "PDS004",
                    view,
                    attribute.start,
                    "Hard-coded color; bind a semantic Primer token instead",
                )
            )
        if (
            attribute.name
            in typography_attributes
            | color_attributes
            | _JS_VISUAL_PROPERTIES
            | {"style", "sx"}
            and _DIRECT_FORUM_RE.search(attribute.value)
            and not any(
                range_start <= attribute.value_start < range_end
                for range_start, range_end in style_ranges
            )
        ):
            findings.append(
                _finding(
                    "error",
                    "PDS006",
                    view,
                    attribute.start,
                    "Direct Forum reference; map it through the semantic Primer layer",
                )
            )
    findings.extend(
        _scan_jsx_visual_attributes(view.text, tags, view.relative_path)
    )

    for start, end in _tagged_template_ranges(view.text):
        fragment = view.text[start:end]
        if _hard_color_offsets(fragment, preserve_quoted_literals=True):
            findings.append(
                _manual_evidence_finding(
                    "PDS004", view, start, "Possible hard-coded color"
                )
            )
        for match in _CSS_TYPOGRAPHY_RE.finditer(fragment):
            if not _uses_bound_value(match.group("value")):
                findings.append(
                    _manual_evidence_finding(
                        "PDS005",
                        view,
                        start + match.start(),
                        "Possible hard-coded typography",
                    )
                )
                break
        forum_match = _DIRECT_FORUM_RE.search(fragment)
        if forum_match is not None:
            findings.append(
                _manual_evidence_finding(
                    "PDS006",
                    view,
                    start + forum_match.start(),
                    "Possible direct Forum reference",
                )
            )
        for match in _CSS_VISUAL_LITERAL_RE.finditer(fragment):
            if not _uses_bound_value(match.group("value")):
                findings.append(
                    _manual_evidence_finding(
                        "PDS007",
                        view,
                        start + match.start(),
                        "Possible arbitrary visual literal",
                    )
                )
                break

    scannable = _mask_ranges(view.text, ignored_ranges)
    color_constant = re.compile(
        r"\b(?:const|let|var)\s+[A-Z0-9_]*COLOR[A-Z0-9_]*\s*=\s*"
        r"(?P<quote>['\"])(?P<value>#[0-9a-fA-F]+)(?P=quote)"
    )
    for match in color_constant.finditer(scannable):
        if _COLOR_LITERAL_RE.fullmatch(match.group("value")):
            findings.append(
                _manual_evidence_finding(
                    "PDS004", view, match.start(), "Possible hard-coded color"
                )
            )
    forum_constant = re.compile(
        r"\b(?:const|let|var)\s+forum\w*\s*=\s*"
        r"(?P<quote>['\"])(?P<value>[^'\"\n]*)(?P=quote)",
        re.IGNORECASE,
    )
    for match in forum_constant.finditer(scannable):
        if _DIRECT_FORUM_RE.search(match.group("value")):
            findings.append(
                _manual_evidence_finding(
                    "PDS006",
                    view,
                    match.start(),
                    "Possible direct Forum reference",
                )
            )

    runtime_imports, namespace_imports = _runtime_primer_imports(tokens)
    for component, line_number in _custom_primitive_declarations(tokens):
        if component in runtime_imports or component in namespace_imports:
            continue
        findings.append(
            Finding(
                severity="warning",
                code="PDS008",
                path=view.relative_path,
                line=line_number,
                message=(
                    f"Custom {component} primitive; import and compose "
                    f"@primer/react {component} instead"
                ),
            )
        )
    return findings


def _conventional_entrypoints(
    views: dict[Path, _SourceView], manifest: object
) -> list[Path]:
    by_relative = {view.relative_path: path for path, view in views.items()}
    if isinstance(manifest, dict):
        configured = []
        for field in ("source", "module", "main"):
            value = manifest.get(field)
            if isinstance(value, str):
                normalized = value.removeprefix("./")
                if normalized in by_relative:
                    configured.append(by_relative[normalized])
        if configured:
            return sorted(
                set(configured), key=lambda path: views[path].relative_path
            )
    priorities = (
        ("src/main",),
        ("src/index",),
        ("app/main",),
        ("app/index",),
        ("main",),
        ("index",),
        ("src/App",),
        ("App",),
    )
    javascript_suffixes = {".js", ".jsx", ".ts", ".tsx"}
    for stems in priorities:
        matches = [
            path
            for path, view in views.items()
            if view.path.suffix.lower() in javascript_suffixes
            and any(
                view.relative_path == stem + view.path.suffix
                for stem in stems
            )
        ]
        if matches:
            return sorted(matches, key=lambda path: views[path].relative_path)
    return []


def _resolve_local_module(
    root: Path,
    current: Path,
    specifier: str,
    views: dict[Path, _SourceView],
) -> Optional[Path]:
    clean_specifier = re.split(r"[?#]", specifier, maxsplit=1)[0]
    base = (current.parent / clean_specifier).resolve(strict=False)
    if not _is_contained(root, base):
        return None
    candidates = [base]
    if base.suffix.lower() not in SOURCE_SUFFIXES:
        candidates.extend(
            Path(str(base) + suffix)
            for suffix in (".js", ".jsx", ".ts", ".tsx", ".css", ".scss")
        )
        candidates.extend(
            base / ("index" + suffix)
            for suffix in (".js", ".jsx", ".ts", ".tsx", ".css", ".scss")
        )
    for candidate in candidates:
        normalized = candidate.resolve(strict=False)
        if normalized in views:
            return normalized
    return None


def _reachable_sources(
    root: Path,
    entrypoints: list[Path],
    views: dict[Path, _SourceView],
    token_cache: dict[Path, list[_Token]],
    dependency_names: set[str],
) -> tuple[set[Path], bool]:
    reachable = set(entrypoints)
    queue = deque(entrypoints)
    uncertain = not entrypoints
    while queue:
        path = queue.popleft()
        view = views[path]
        references: list[str] = []
        if view.path.suffix.lower() in _JAVASCRIPT_SUFFIXES:
            if _has_unresolved_dynamic_module_reference(token_cache[path]):
                uncertain = True
            references.extend(
                package
                for package, _line in _runtime_module_references(
                    view.text, token_cache[path]
                )
            )
        else:
            references.extend(_style_module_references(view.text))
        for specifier in references:
            if specifier.startswith("."):
                resolved = _resolve_local_module(
                    root, path, specifier, views
                )
                if resolved is None:
                    uncertain = True
                elif resolved not in reachable:
                    reachable.add(resolved)
                    queue.append(resolved)
            elif specifier.startswith(("@/", "~/")):
                uncertain = True
            elif _package_root(specifier) not in dependency_names:
                # A bare specifier not declared as a dependency may be a
                # tsconfig/jsconfig/bundler path alias. Do not call an
                # incomplete graph a proven root violation.
                uncertain = True
    return reachable, uncertain


def _primer_role(
    component: str,
    named_imports: dict[str, set[str]],
    namespace_imports: set[str],
) -> Optional[str]:
    for role in _ROOT_COMPONENTS:
        if component in named_imports.get(role, set()):
            return role
        if any(component == f"{namespace}.{role}" for namespace in namespace_imports):
            return role
    return None


def _select_jsx_elements(
    elements: list[_JsxElement], start: int, end: int
) -> list[_JsxElement]:
    """Select an owner range and rebase its parent indexes."""
    selected_indexes = [
        index
        for index, element in enumerate(elements)
        if start <= element.start < end
    ]
    rebased = {
        original: selected for selected, original in enumerate(selected_indexes)
    }
    return [
        _JsxElement(
            component=elements[index].component,
            start=elements[index].start,
            opening_end=elements[index].opening_end,
            parent=rebased.get(elements[index].parent),
        )
        for index in selected_indexes
    ]


def _root_setup_status(
    root: Path,
    entrypoints: list[Path],
    reachable: set[Path],
    views: dict[Path, _SourceView],
    token_cache: dict[Path, list[_Token]],
    elements_cache: dict[Path, list[_JsxElement]],
) -> tuple[bool, bool]:
    """Return (proven, uncertain) for application-root wrapper coverage.

    A nested pair in an entrypoint is proven only when it contains every
    top-level JSX element in that entrypoint. Pairs in imported modules are
    interprocedural evidence: useful, but not proof that the exported
    component is actually rendered by the entrypoint.
    """
    uncertain = False
    active = set(entrypoints)
    queue = deque(entrypoints)
    while queue:
        path = queue.popleft()
        all_elements = elements_cache.get(path, [])
        elements = all_elements
        if all_elements:
            source = views[path].text
            preferred_names = []
            stem_name = path.stem
            if stem_name and stem_name[0].isupper():
                preferred_names.append(stem_name)
            preferred_names.extend(["root", "App"])
            for owner_name in preferred_names:
                owner_match = re.search(
                    r"\b(?:export\s+(?:default\s+)?)?"
                    r"(?:const|let|var|function)\s+"
                    + re.escape(owner_name)
                    + r"\b",
                    source,
                )
                if owner_match is None:
                    continue
                next_owner = re.search(
                    r"\b(?:export\s+(?:default\s+)?)?"
                    r"(?:const|let|var|function)\s+"
                    r"[A-Za-z_$][\w$]*\b",
                    source[owner_match.end():],
                )
                owner_end = (
                    len(source)
                    if next_owner is None
                    else owner_match.end() + next_owner.start()
                )
                owned = _select_jsx_elements(
                    all_elements, owner_match.start(), owner_end
                )
                if owned:
                    elements = owned
                    break
            else:
                cjs_owner = re.search(
                    r"\bmodule\s*\.\s*exports\s*=", source
                )
                if cjs_owner is not None:
                    owned = _select_jsx_elements(
                        all_elements, cjs_owner.end(), len(source)
                    )
                    if owned:
                        elements = owned
        if elements:
            named_imports, namespace_imports = _runtime_primer_imports(
                token_cache[path]
            )
            fragment_names, react_namespaces = _runtime_react_fragments(
                token_cache[path]
            )
            transparent_fragments = fragment_names | {
                f"{namespace}.Fragment" for namespace in react_namespaces
            }
            roles = [
                _primer_role(
                    element.component, named_imports, namespace_imports
                )
                for element in elements
            ]
            valid_provider_indexes = set()
            for index, role in enumerate(roles):
                if role != "BaseStyles":
                    continue
                parent = elements[index].parent
                while parent is not None:
                    if roles[parent] == "ThemeProvider":
                        valid_provider_indexes.add(parent)
                        break
                    parent = elements[parent].parent
            top_level = [
                index for index, element in enumerate(elements)
                if element.parent is None
            ]
            while (
                len(top_level) == 1
                and elements[top_level[0]].component in transparent_fragments
            ):
                fragment_index = top_level[0]
                top_level = [
                    index for index, element in enumerate(elements)
                    if element.parent == fragment_index
                ]
            if len(top_level) == 1 and top_level[0] in valid_provider_indexes:
                provider = top_level[0]
                for base in (
                    index
                    for index, role in enumerate(roles)
                    if role == "BaseStyles"
                ):
                    parent = elements[base].parent
                    inside_provider = False
                    while parent is not None:
                        if parent == provider:
                            inside_provider = True
                            break
                        parent = elements[parent].parent
                    if not inside_provider:
                        continue
                    covers_all = True
                    for descendant in range(len(elements)):
                        if descendant in {provider, base}:
                            continue
                        if elements[descendant].component in transparent_fragments:
                            continue
                        parent = elements[descendant].parent
                        has_provider = False
                        has_base = False
                        while parent is not None:
                            has_provider = has_provider or parent == provider
                            has_base = has_base or parent == base
                            parent = elements[parent].parent
                        if has_provider and not has_base:
                            covers_all = False
                            break
                    if covers_all:
                        return True, uncertain

            bindings = _runtime_import_bindings(token_cache[path])
            for index in top_level:
                component = elements[index].component.split(".", 1)[0]
                specifier = bindings.get(component)
                if specifier is None or not specifier.startswith("."):
                    continue
                resolved = _resolve_local_module(
                    root, path, specifier, views
                )
                if resolved is not None and resolved not in active:
                    active.add(resolved)
                    queue.append(resolved)

        # Preserve explicit CommonJS forwarding/bootstrap chains. A bare
        # local require executes the module, while `module.exports=require`
        # forwards the rendered export.
        view = views[path]
        source = view.text
        if not elements and re.search(r"\b(?:React\s*\.\s*)?createElement\s*\(", source):
            uncertain = True
        if not elements:
            reexports = sorted(
                {
                    specifier
                    for specifier in _runtime_reexport_references(
                        token_cache[path]
                    )
                    if specifier.startswith(".")
                }
            )
            if len(reexports) == 1:
                resolved = _resolve_local_module(
                    root, path, reexports[0], views
                )
                if resolved is None:
                    uncertain = True
                elif resolved not in active:
                    active.add(resolved)
                    queue.append(resolved)
            elif len(reexports) > 1:
                uncertain = True
        for specifier, _line in _runtime_module_references(
            source, token_cache[path]
        ):
            if not specifier.startswith("."):
                continue
            forwarding_pattern = (
                r"\s*module\s*\.\s*exports\s*=\s*"
                r"require\s*\(\s*['\"]"
                + re.escape(specifier)
                + r"['\"]\s*\)\s*;?\s*"
            )
            bootstrap_pattern = (
                r"\s*require\s*\(\s*['\"]"
                + re.escape(specifier)
                + r"['\"]\s*\)\s*;?\s*"
            )
            if elements or not (
                re.fullmatch(forwarding_pattern, source)
                or re.fullmatch(bootstrap_pattern, source)
            ):
                continue
            resolved = _resolve_local_module(root, path, specifier, views)
            if resolved is not None and resolved not in active:
                active.add(resolved)
                queue.append(resolved)
    return False, uncertain


def scan_project(
    root: Path,
    allowed_token_globs: tuple[str, ...] = DEFAULT_TOKEN_GLOBS,
) -> list[Finding]:
    """Return stable, path-sorted findings for a frontend project."""
    root = Path(root).resolve(strict=True)
    findings = []

    manifest_path = root / "package.json"
    manifest: object = {}
    if os.path.lexists(str(manifest_path)):
        manifest = json.loads(
            _safe_read_text(root, manifest_path, "manifest file")
        )
    dependencies = _manifest_dependencies(manifest)
    dependency_targets = {
        package: _dependency_target(package, specification)
        for package, specification in dependencies.items()
    }
    aliases = {
        package: target
        for package, target in dependency_targets.items()
        if target != package
    }

    for package in sorted(dependency_targets):
        target = dependency_targets[package]
        if _is_forbidden(target):
            message = f"Forbidden UI dependency: {package}"
            if package != target:
                message = (
                    f"Forbidden UI dependency alias: {package} -> {target}"
                )
            findings.append(
                Finding(
                    severity="error",
                    code="PDS001",
                    path="package.json",
                    line=1,
                    message=message,
                )
            )

    source_files = _source_files(root)
    views = {}
    token_cache: dict[Path, list[_Token]] = {}
    ignored_ranges_cache: dict[Path, list[tuple[int, int]]] = {}
    elements_cache: dict[Path, list[_JsxElement]] = {}
    for path in source_files:
        normalized = path.resolve(strict=False)
        source = _safe_read_text(root, path, "source file")
        view = _SourceView(
            path=path,
            relative_path=_relative_path(root, path),
            text=source,
            newline_starts=_newline_starts(source),
        )
        views[normalized] = view
        if path.suffix.lower() in _JAVASCRIPT_SUFFIXES:
            ignored_ranges: list[tuple[int, int]] = []
            tokens = _lex_source(source, ignored_ranges)
            token_cache[normalized] = tokens
            ignored_ranges_cache[normalized] = ignored_ranges
            if path.suffix.lower() in {".js", ".jsx", ".tsx"}:
                elements_cache[normalized] = _jsx_elements(tokens)

    target_packages = set(dependency_targets.values())
    is_react_project = "react" in target_packages or any(
        path.suffix.lower() in {".jsx", ".tsx"} for path in source_files
    )
    if is_react_project:
        for package in REQUIRED_PACKAGES:
            if package not in target_packages:
                findings.append(
                    Finding(
                        severity="error",
                        code="PDS003",
                        path="package.json",
                        line=1,
                        message=f"Missing required dependency: {package}",
                    )
                )

    for source_path, view in sorted(
        views.items(), key=lambda item: item[1].relative_path
    ):
        suffix = view.path.suffix.lower()
        module_references = []
        if suffix in _JAVASCRIPT_SUFFIXES:
            module_references = list(
                _module_references(view.text, token_cache[source_path])
            )
        for package, line_number in module_references:
            imported_root = _package_root(package)
            target = aliases.get(imported_root, imported_root)
            if _is_forbidden(target):
                message = f"Forbidden UI import: {package}"
                if imported_root in aliases:
                    message = (
                        "Forbidden UI import via alias: "
                        f"{imported_root} -> {target}"
                    )
                findings.append(
                    Finding(
                        severity="error",
                        code="PDS002",
                        path=view.relative_path,
                        line=line_number,
                        message=message,
                    )
                )
        if suffix in _STYLE_SUFFIXES:
            findings.extend(
                _scan_style_view(view, allowed_token_globs)
            )
        else:
            findings.extend(
                _scan_javascript_view(
                    view,
                    token_cache[source_path],
                    elements_cache.get(source_path, []),
                    ignored_ranges_cache[source_path],
                )
            )

    if is_react_project:
        entrypoints = _conventional_entrypoints(views, manifest)
        reachable, uncertain_graph = _reachable_sources(
            root, entrypoints, views, token_cache, set(dependencies)
        )
        has_root_setup, uncertain_root = _root_setup_status(
            root,
            entrypoints,
            reachable,
            views,
            token_cache,
            elements_cache,
        )
        has_light_theme_import = False
        for path in reachable:
            view = views[path]
            if view.path.suffix.lower() in _JAVASCRIPT_SUFFIXES:
                module_references = list(
                    _runtime_module_references(
                        view.text, token_cache[path]
                    )
                )
                has_light_theme_import = has_light_theme_import or any(
                    package == _LIGHT_THEME_MODULE
                    for package, _line in module_references
                )
            elif view.path.suffix.lower() in _STYLE_SUFFIXES:
                has_light_theme_import = (
                    has_light_theme_import
                    or _has_light_theme_css_import(view.text)
                )
        diagnostic_path = (
            views[entrypoints[0]].relative_path
            if entrypoints
            else "package.json"
        )
        root_severity = (
            "warning" if uncertain_graph or uncertain_root else "error"
        )
        theme_severity = "warning" if uncertain_graph else "error"
        if not has_root_setup:
            message = (
                "Missing Primer root setup; wrap the reachable application root "
                "with nested ThemeProvider and BaseStyles"
            )
            if root_severity == "warning":
                message = (
                    "Unable to prove nested ThemeProvider and BaseStyles at the "
                    "application root; manual reachability review required"
                )
            findings.append(
                Finding(
                    severity=root_severity,
                    code="PDS009",
                    path=diagnostic_path,
                    line=1,
                    message=message,
                )
            )
        if not has_light_theme_import:
            message = f"Missing reachable light theme import: {_LIGHT_THEME_MODULE}"
            if theme_severity == "warning":
                message = (
                    "Unable to prove reachable Primer light-theme setup; manual "
                    "reachability review required"
                )
            findings.append(
                Finding(
                    severity=theme_severity,
                    code="PDS010",
                    path=diagnostic_path,
                    line=1,
                    message=message,
                )
            )

    return sorted(
        findings,
        key=lambda item: (item.path, item.line, item.code, item.message),
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a frontend project against the Primer UI policy.",
        usage=(
            "%(prog)s ROOT [--format {text,json}]\n"
            "                            [--allow-token-file GLOB]\n"
            "                            [--warnings-as-errors]"
        ),
    )
    parser.add_argument("root", type=Path, metavar="ROOT")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument(
        "--allow-token-file",
        action="append",
        dest="allowed_token_globs",
        metavar="GLOB",
    )
    parser.add_argument("--warnings-as-errors", action="store_true")
    return parser


def _print_findings(findings: Sequence[Finding], output_format: str) -> None:
    if output_format == "json":
        print(json.dumps([asdict(item) for item in findings], indent=2))
        return
    for item in findings:
        print(
            f"{item.severity.upper()} {item.code} "
            f"{item.path}:{item.line} {item.message}"
        )


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    arguments = parser.parse_args(argv)
    root = arguments.root
    if not root.is_dir() or not os.access(root, os.R_OK | os.X_OK):
        parser.error(f"unreadable root: {root}")

    allowed_token_globs = (
        tuple(arguments.allowed_token_globs)
        if arguments.allowed_token_globs
        else DEFAULT_TOKEN_GLOBS
    )
    try:
        findings = scan_project(root, allowed_token_globs)
    except (ScanError, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"error: unable to scan {root}: {error}", file=sys.stderr)
        return 2

    _print_findings(findings, arguments.format)
    has_errors = any(item.severity == "error" for item in findings)
    has_warnings = any(item.severity == "warning" for item in findings)
    if has_errors or (arguments.warnings_as_errors and has_warnings):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
