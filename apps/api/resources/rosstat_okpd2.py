"""Bounded reader of Rosstat's official consolidated OKPD2 archive.

The added CA chain is scoped to this source, never installed system-wide.
The archive edition is a source edition, not a legal effective-date claim.
"""
import datetime,hashlib,io,json,os,re,selectors,ssl,subprocess,sys,tempfile,time,urllib.request,zipfile
from html.parser import HTMLParser
import xml.etree.ElementTree as ET
from pathlib import Path,PurePosixPath

PAGE='https://rosstat.gov.ru/classification'
ARCHIVE='https://rosstat.gov.ru/storage/mediabank/OKPD2.rar'
PARTS={'OKPD2 01-35.docx':'01-35','OKPD2 36-99.docx':'36-99'}
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
CODE=re.compile(r'\d{2}(?:\.\d(?:\d(?:\.\d(?:\d(?:\.\d{3})?)?)?)?)?')
clean=lambda value:re.sub(r'\s+',' ',value).strip()

def page_metadata(text):
    # Only a complete document item containing the official link supplies metadata.
    class Items(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.divs=[];self.active=None;self.blocks=[];self.links=0
        def handle_starttag(self,tag,attrs):
            attrs=dict(attrs)
            if tag=='div':
                item='document-list__item' in attrs.get('class','').split()
                if item:
                    if self.active is not None:raise ValueError('Nested source document items')
                    self.active={'text':[],'links':0}
                self.divs.append(item)
            if tag=='a' and attrs.get('href')=='/storage/mediabank/OKPD2.rar':
                self.links+=1
                if self.active is not None:self.active['links']+=1
        def handle_data(self,data):
            if self.active is not None:self.active['text'].append(data)
        def handle_endtag(self,tag):
            if tag=='div' and self.divs and self.divs.pop():
                if self.active['links']:self.blocks.append(self.active)
                self.active=None
    parser=Items();parser.feed(text);parser.close()
    if parser.links!=1 or len(parser.blocks)!=1:raise ValueError('Source document missing, incomplete or duplicated')
    block=clean(' '.join(parser.blocks[0]['text']))
    editions=re.findall(r'по\s+(\d{1,4}/20\d{2})',block)
    dates=re.findall(r'\b(\d{2}\.\d{2}\.20\d{2})\b',block)
    if len(editions)!=1 or len(dates)!=1:raise ValueError('Source edition/date missing or ambiguous')
    date=datetime.datetime.strptime(dates[0],'%d.%m.%Y').date()
    if date>datetime.datetime.now(datetime.timezone.utc).date():raise ValueError('Future source date')
    return {'edition':editions[0],'publishedDate':date.isoformat()}

def command_bytes(args,limit,timeout):
    proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL)
    out=bytearray();deadline=time.monotonic()+timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout,selectors.EVENT_READ)
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Archive reader timeout')
                if not selector.select(remaining):raise TimeoutError('Archive reader timeout')
                chunk=os.read(proc.stdout.fileno(),min(65536,limit-len(out)+1))
                if not chunk:break
                out.extend(chunk)
                if len(out)>limit:raise ValueError('Archive output too large')
        if proc.wait(timeout=max(0.01,deadline-time.monotonic())):raise ValueError('Invalid archive')
        return bytes(out)
    finally:
        if proc.poll() is None:proc.kill()
        proc.wait();proc.stdout.close()

def parse_docx(data,part):
    if len(data)>16*1024*1024:raise ValueError('DOCX too large')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos=archive.infolist();names=[i.filename for i in infos]
        if len(names)!=len(set(names)) or len(infos)>2000:raise ValueError('Duplicate/large DOCX directory')
        for info in infos:
            path=PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename or (info.external_attr>>16)&0o170000==0o120000 or info.flag_bits&1:raise ValueError('Unsafe DOCX entry')
        if sum(i.file_size for i in infos)>128*1024*1024:raise ValueError('DOCX expanded size too large')
        entry=archive.getinfo('word/document.xml')
        if entry.file_size>64*1024*1024:raise ValueError('XML too large')
        xml=archive.read(entry)
    if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():raise ValueError('XML declarations forbidden')
    document=ET.fromstring(xml)
    sections=[];items=[];seen=set();section=None
    low,high=map(int,part.split('-'))
    for row in document.findall('.//w:tr',NS):
        cells=row.findall('w:tc',NS)
        values=[clean(' '.join(''.join(t.text or '' for t in p.findall('.//w:t',NS)) for p in c.findall('.//w:p',NS))) for c in cells]
        if not values:continue
        key=re.sub(r'\s+','',values[0]);match=re.fullmatch(r'РАЗДЕЛ([A-U])',key)
        if match:
            if len(values)!=2 or not values[1] or any(s['code']==match[1] for s in sections):raise ValueError('Invalid section')
            section=match[1];sections.append({'code':section,'name':values[1]});continue
        if section is None:continue  # introductory code examples are not classifier rows
        if not key:continue  # explanatory text lives in separate rows
        if len(values)!=2 or not CODE.fullmatch(key) or not values[1] or len(values[1])>2000:raise ValueError('Invalid code/name row')
        if not low<=int(key[:2])<=high:raise ValueError('Code outside part range')
        if key in seen:raise ValueError('Duplicate code')
        seen.add(key);digits=key.replace('.','');parent={3:key[:2],4:key[:4],5:key[:5],6:key[:7],9:key[:8]}.get(len(digits))
        items.append({'code':key,'name':values[1],'section':section,'parentCode':parent,'level':{2:1,3:2,4:3,5:4,6:5,9:6}[len(digits)]})
    if not sections or not items:raise ValueError('Missing classifier sections')
    return {'sections':sections,'items':items}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Source redirects forbidden')

def load():
    certs=Path(__file__).with_name('certs');context=ssl.create_default_context()
    for name in ('root.pem','sub2024.pem'):context.load_verify_locations(str(certs/name))
    opener=urllib.request.build_opener(NoRedirect,urllib.request.HTTPSHandler(context=context))
    deadline=time.monotonic()+120
    def fetch(url,limit):
        if url not in (PAGE,ARCHIVE):raise ValueError('Source URL forbidden')
        with opener.open(urllib.request.Request(url,headers={'User-Agent':'ASTForum-OKPD2/1.0'}),timeout=max(1,min(30,deadline-time.monotonic()))) as response:
            if response.status!=200:raise ValueError('Unexpected source status')
            chunks=[];size=0
            while True:
                if time.monotonic()>deadline:raise TimeoutError('Source timeout')
                chunk=response.read(min(65536,limit-size+1))
                if not chunk:break
                size+=len(chunk)
                if size>limit:raise ValueError('Source response too large')
                chunks.append(chunk)
            return b''.join(chunks)
    metadata=page_metadata(fetch(PAGE,4*1024*1024).decode('utf-8'))
    raw=fetch(ARCHIVE,8*1024*1024)
    if not raw.startswith(b'Rar!\x1a\x07'):raise ValueError('RAR expected')
    with tempfile.TemporaryDirectory(prefix='forum-okpd2-') as temp:
        archive=Path(temp)/'source.rar';archive.write_bytes(raw)
        names=command_bytes(['bsdtar','-tf',str(archive)],65536,10).decode().splitlines()
        if set(names)!=set(PARTS) or len(names)!=2:raise ValueError('Incomplete or unexpected archive parts')
        listing=command_bytes(['bsdtar','-tvf',str(archive)],65536,10).decode().splitlines()
        if len(listing)!=2 or any(not row.startswith('-') for row in listing):raise ValueError('Unsafe archive entries')
        parts=[parse_docx(command_bytes(['bsdtar','-xOf',str(archive),name],16*1024*1024,20),PARTS[name]) for name in sorted(PARTS)]
    sections=[s for p in parts for s in p['sections']];items=[r for p in parts for r in p['items']]
    if len(items)<20000 or len(items)>100000 or {s['code'] for s in sections}!=set('ABCDEFGHIJKLMNOPQRSTU') or len(sections)!=21:raise ValueError('Incomplete classifier')
    if len({r['code'] for r in items})!=len(items):raise ValueError('Duplicate code across parts')
    return {**metadata,'url':ARCHIVE,'archiveHash':hashlib.sha256(raw).hexdigest(),'sections':sorted(sections,key=lambda r:r['code']),'items':sorted(items,key=lambda r:r['code'])}

if __name__=='__main__':
    try:print(json.dumps(load(),ensure_ascii=False,separators=(',',':')))
    except Exception as error:
        # No response bodies, file paths, DB credentials or source contents in logs.
        print(json.dumps({'event':'okpd2_source_failed','type':type(error).__name__}),file=sys.stderr);sys.exit(1)
