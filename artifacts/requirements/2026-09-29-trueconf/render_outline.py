from pathlib import Path
import html
import re

base = Path(__file__).parent
source = (base / 'requirements.md').read_text()

def inline(text):
    saved = []
    def keep(value):
        saved.append(value)
        return '\x00' + str(len(saved) - 1) + '\x00'
    text = re.sub(r'`([^`]+)`', lambda m: keep('<code>' + html.escape(m[1]) + '</code>'), text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: keep('<a href="' + html.escape(m[2], quote=True) + '">' + html.escape(m[1]) + '</a>'), text)
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    return re.sub(r'\x00(\d+)\x00', lambda m: saved[int(m[1])], text)

output = []
lines = source.splitlines()
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
    elif line.startswith('#'):
        match = re.match(r'(#+) (.*)', line)
        level = len(match[1])
        output.append(f'<h{level}>{inline(match[2])}</h{level}>')
        i += 1
    elif line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?', c) for c in cells):
                rows.append(cells)
            i += 1
        output.append('<table><thead><tr>' + ''.join('<th><p>' + inline(c) + '</p></th>' for c in rows[0]) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td><p>' + inline(c) + '</p></td>' for c in row) + '</tr>' for row in rows[1:]) + '</tbody></table>')
    elif re.match(r'(?:- |\d+\. )', line):
        ordered = bool(re.match(r'\d+\. ', line))
        tag = 'ol' if ordered else 'ul'
        items = []
        while i < len(lines) and re.match(r'\d+\. ' if ordered else r'- ', lines[i]):
            items.append('<li><p>' + inline(re.sub(r'^(?:- |\d+\. )', '', lines[i])) + '</p></li>')
            i += 1
        output.append('<' + tag + '>' + ''.join(items) + '</' + tag + '>')
    else:
        paragraph = []
        while i < len(lines) and lines[i].strip() and not re.match(r'(#|\||- |\d+\. )', lines[i]):
            paragraph.append(lines[i])
            i += 1
        output.append('<p>' + inline('\n'.join(paragraph)).replace('  \n', '<br>').replace('\n', ' ') + '</p>')

body = '\n'.join(output)
(base / 'requirements.html').write_text(body)
print({'characters': len(body), 'tables': body.count('<table>'), 'headings': len(re.findall('<h[23]>', body))})
