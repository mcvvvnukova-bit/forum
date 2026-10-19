import importlib.util,io,unittest,zipfile
from pathlib import Path
from xml.sax.saxutils import escape

spec=importlib.util.spec_from_file_location('source',Path(__file__).with_name('rosstat_okpd2.py'))
source=importlib.util.module_from_spec(spec)
if spec.loader and Path(spec.origin).exists():spec.loader.exec_module(source)

def docx(rows):
 xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>'
 for row in rows:
  xml+='<w:tr>'+''.join('<w:tc><w:p>'+''.join('<w:r><w:t>'+escape(t)+'</w:t></w:r>' for t in cell)+'</w:p></w:tc>' for cell in row)+'</w:tr>'
 xml+='</w:tbl></w:body></w:document>'
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:z.writestr('word/document.xml',xml)
 return b.getvalue()

class Parser(unittest.TestCase):
 def test_ignores_introductory_example_preserves_zeroes_and_joins_runs(self):
  self.assertTrue(hasattr(source,'parse_docx'),'DOCX parser is not implemented')
  data=docx([[['01.19.10'],['Introductory example']],[['РАЗДЕЛ A'],['ПРОДУКЦИЯ']],[['01'],['Продук','ция']],[['01.1'],['Культуры  однолетние']],[[''],['Эта группировка включает: пояснение']]])
  result=source.parse_docx(data,'01-35')
  self.assertEqual([(r['code'],r['name']) for r in result['items']],[('01','Продукция'),('01.1','Культуры однолетние')])
  self.assertEqual(result['sections'],[{'code':'A','name':'ПРОДУКЦИЯ'}])
 def test_rejects_duplicate_code_and_wrong_part(self):
  self.assertTrue(hasattr(source,'parse_docx'),'DOCX parser is not implemented')
  for rows in [ [[['РАЗДЕЛ A'],['Section']],[['01'],['Name']],[['01'],['Other']]], [[['РАЗДЕЛ E'],['Section']],[['36'],['Name']]] ]:
   with self.assertRaisesRegex(ValueError,'Duplicate|range'):source.parse_docx(docx(rows),'01-35')
 def test_rejects_numeric_code_that_cannot_be_read(self):
  self.assertTrue(hasattr(source,'parse_docx'),'DOCX parser is not implemented')
  with self.assertRaisesRegex(ValueError,'code'):source.parse_docx(docx([[['РАЗДЕЛ A'],['Section']],[['01.A'],['Name']]]),'01-35')
 def test_rejects_missing_section_and_xml_entities(self):
  self.assertTrue(hasattr(source,'parse_docx'),'DOCX parser is not implemented')
  with self.assertRaises(ValueError):source.parse_docx(docx([[['01'],['Name']]]),'01-35')
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:z.writestr('word/document.xml','<!DOCTYPE x [<!ENTITY e "value">]><x/>')
  with self.assertRaisesRegex(ValueError,'XML'):source.parse_docx(b.getvalue(),'01-35')
 def test_rejects_zip_traversal_and_duplicate_document(self):
  self.assertTrue(hasattr(source,'parse_docx'),'DOCX parser is not implemented')
  for names in [['../outside','word/document.xml'],['word/document.xml','word/document.xml']]:
   b=io.BytesIO()
   with zipfile.ZipFile(b,'w') as z:
    for n in names:z.writestr(n,'<x/>')
   with self.assertRaises(ValueError):source.parse_docx(b.getvalue(),'01-35')
 def test_metadata_binds_exact_official_link_to_edition_and_date(self):
  self.assertTrue(hasattr(source,'page_metadata'),'Source metadata is not implemented')
  html='<div class="document-list__item"><a href="/storage/mediabank/OKPD2.rar">RAR</a><div>ОКПД2 с учетом изменений с 1/2015 по 148/2026</div><div>1.1 Мб, 02.10.2026</div></div>'
  self.assertEqual(source.page_metadata(html),{'edition':'148/2026','publishedDate':'2026-10-02'})
  with self.assertRaises(ValueError):source.page_metadata(html.replace('OKPD2.rar','other.rar'))
 def test_metadata_excludes_adjacent_documents_and_accepts_html_attribute_variations(self):
  item="<div class='document-list__item extra'><a href='/storage/mediabank/OKPD2.rar'>RAR</a><div>ОКПД2 по 148/2026</div><div>02.10.2026</div></div>"
  neighbor='<div class="document-list__item"><div>Другой документ по 150/2026</div><div>09.10.2026</div></div>'
  for page in (item+neighbor,neighbor+item,item.replace("'",'"')+neighbor):
   self.assertEqual(source.page_metadata(page),{'edition':'148/2026','publishedDate':'2026-10-02'})
 def test_metadata_rejects_unbounded_or_ambiguous_document_items(self):
  item='<div class="document-list__item"><a href="/storage/mediabank/OKPD2.rar">ОКПД2 по 148/2026</a><div>02.10.2026</div></div>'
  for page in (item.replace('</div></div>','</div>'),item.replace('document-list__item','document-list__item-title'),item+item,item.replace('02.10.2026','02.10.2026 09.10.2026')):
   with self.assertRaises(ValueError):source.page_metadata(page)
 def test_subprocess_output_and_time_are_bounded(self):
  self.assertTrue(hasattr(source,'command_bytes'),'Bounded subprocess is not implemented')
  import sys
  with self.assertRaisesRegex(ValueError,'large'):source.command_bytes([sys.executable,'-c','print("a"*10000)'],100,3)
  with self.assertRaises(TimeoutError):source.command_bytes([sys.executable,'-c','import time;time.sleep(3)'],100,0.05)

if __name__=='__main__':unittest.main()
