from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
import json

OUT = Path(__file__).parent
BASE = 'html=1;fontFamily=Arial;fontSize=18;fontColor=#17324D;strokeColor=#54708B;strokeWidth=2;whiteSpace=wrap;'
TASK = 'shape=mxgraph.bpmn.task2;rectStyle=rounded;size=12;container=1;expand=0;collapsible=0;'
EVENT = 'shape=mxgraph.bpmn.event;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=#ffffff;'

class Diagram:
    def __init__(self, title, subtitle, height):
        self.model=Element('mxGraphModel',{'dx':'1740','dy':str(height),'grid':'1','gridSize':'10','guides':'1','tooltips':'1','connect':'1','arrows':'1','fold':'1','page':'0','pageScale':'1','pageWidth':'1740','pageHeight':str(height),'background':'#ffffff','math':'0','shadow':'0'})
        self.root=SubElement(self.model,'root')
        SubElement(self.root,'mxCell',{'id':'0'});SubElement(self.root,'mxCell',{'id':'1','parent':'0'})
        self.pos={}
        self.text('title',title,40,24,1660,52,30,True)
        self.text('subtitle',subtitle,40,82,1660,50,18)
        self.node('pool','Запись на демо · PUB.02.01.01',40,150,1660,height-270,'swimlane;horizontal=1;startSize=40;container=1;collapsible=0;fillColor=#E7EEF5;swimlaneFillColor=#FFFFFF;fontSize=20;fontStyle=1;')
        self.node('visitor','ПОСЕТИТЕЛЬ',0,40,530,height-310,'swimlane;horizontal=1;startSize=42;container=1;collapsible=0;fillColor=#E9F2FF;swimlaneFillColor=#F8FBFF;fontStyle=1;',parent='pool')
        self.node('system','СИСТЕМА',530,40,1130,height-310,'swimlane;horizontal=1;startSize=42;container=1;collapsible=0;fillColor=#EAF0F5;swimlaneFillColor=#FFFFFF;fontStyle=1;',parent='pool')
        self.text('legend','○ начало   ◎ завершение   ◇ × выбор одной ветви   ◇ + параллельные действия   → поток управления',40,height-96,1660,35,17)
        self.text('legend2','Голубые задачи — действия посетителя · Светлые — действия системы · Оранжевые — обработка ошибок',40,height-60,1660,35,17)
    def node(self,id,label,x,y,w,h,style='',parent='1'):
        c=SubElement(self.root,'mxCell',{'id':id,'value':label,'style':BASE+style,'vertex':'1','parent':parent})
        SubElement(c,'mxGeometry',{'x':str(x),'y':str(y),'width':str(w),'height':str(h),'as':'geometry'})
        self.pos[id]=(x,y,w,h,parent)
        return c
    def text(self,id,label,x,y,w,h,size=18,bold=False):
        self.node(id,label,x,y,w,h,f'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize={size};fontStyle={1 if bold else 0};')
    def task(self,id,label,cx,y,lane='system',w=270,h=88,error=False,kind=None):
        kind=kind or ('user' if lane=='visitor' else 'service')
        fill='#FFF2DD' if error else ('#E6F0FF' if lane=='visitor' else '#F3F7FA')
        stroke='#B97823' if error else '#54708B'
        off=40 if lane=='visitor' else 570
        self.node(id,label,cx-w/2-off,y-190,w,h,TASK+f'taskMarker={kind};fillColor={fill};strokeColor={stroke};spacingTop=8;spacingLeft=12;spacingRight=12;',lane)
    def event(self,id,label,cx,y,lane='system',end=False,symbol='general',outline=None):
        off=40 if lane=='visitor' else 570
        placement='labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle;spacingRight=14;' if id=='start' else ''
        self.node(id,label,cx-23-off,y-190,46,46,EVENT+f'outline={outline or ("end" if end else "standard")};symbol={symbol};fillColor=#FFFFFF;fontSize=16;spacingTop=6;labelWidth=190;'+placement,lane)
    def gate(self,id,label,cx,y,lane='system',parallel=False):
        off=40 if lane=='visitor' else 570
        self.node(id,label,cx-35-off,y-190,70,70,'shape=mxgraph.bpmn.gateway2;perimeter=rhombusPerimeter;outline=none;symbol=none;gwType='+('parallel' if parallel else 'exclusive')+';verticalLabelPosition=top;verticalAlign=bottom;labelBackgroundColor=#FFFFFF;fillColor=#FFFFFF;fontSize=17;spacingBottom=6;',lane)
    def edge(self,id,src,dst,label='',points=None,style=''):
        c=SubElement(self.root,'mxCell',{'id':id,'value':label,'edge':'1','parent':'1','source':src,'target':dst,'style':BASE+'edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;endFill=1;jettySize=24;fontSize=16;labelBackgroundColor=#FFFFFF;'+style})
        g=SubElement(c,'mxGeometry',{'relative':'1','as':'geometry'})
        if points:
            a=SubElement(g,'Array',{'as':'points'})
            for x,y in points:SubElement(a,'mxPoint',{'x':str(x),'y':str(y)})
    def note(self,id,label,x,y,w,h=100):
        self.node(id,label,x,y,w,h,'shape=note;fillColor=#FFFBEA;strokeColor=#D8C782;align=left;spacing=12;fontSize=17;')
    def save(self,name):
        xml=tostring(self.model,encoding='unicode')
        (OUT/f'{name}.xml').write_text(xml)
        mxfile=Element('mxfile',{'host':'app.diagrams.net','agent':'Codex','version':'31.5.3'})
        page=SubElement(mxfile,'diagram',{'id':name,'name':name});page.append(self.model)
        (OUT/f'{name}.drawio').write_text(tostring(mxfile,encoding='unicode'))
        (OUT/f'{name}-mcp-input.json').write_text(json.dumps({'xml':xml},ensure_ascii=False))

d=Diagram('01 · Запись на демо','Основной сценарий и ошибки E01–E06 · GMT+3 · Продолжительность: 60 минут',2590)
d.event('start','Хочу записаться\nна демо',300,270,'visitor')
d.task('open','Открыть запись\nс общей страницы\nили лендинга аудитории',300,390,'visitor')
d.task('load','Загрузить календарь\nвыбранного события',800,390)
d.gate('calendar','Календарь загружен?',800,570)
d.task('error6','E06 · Календарь недоступен\nПоказать сообщение и кнопки\n«Повторить» / «Открыть страницу записи»',1340,550,w=430,h=105,error=True)
d.task('recover6','Повторить загрузку или открыть\nпубличную страницу того же события',300,550,'visitor',w=360,h=105)
d.task('date','Выбрать сценарий и дату\nЧасовой пояс: GMT+3',300,740,'visitor',w=340)
d.task('slots','Показать свободные\nбудущие интервалы',800,740)
d.gate('has_slots','Есть свободное время?',800,920)
d.task('empty','Нет свободного времени\nПредложить другую дату',1340,910,w=360,error=True)
d.task('new_date','Выбрать другую дату',300,910,'visitor')
d.task('select_slot','Выбрать свободное время',300,1080,'visitor',w=340)
d.task('form','Заполнить контакты и согласие,\nпроверить резюме,\nнажать «Отправить заявку»',300,1230,'visitor',w=360,h=105)
d.task('validate','Проверить имя, email\nи согласие',800,1230)
d.gate('valid','Данные корректны?',800,1420)
d.task('invalid','E01 · Укажите ваше имя\nE02 · Укажите корректный email\nE03 · Подтвердите согласие\nна обработку персональных данных',1340,1395,w=450,h=120,error=True)
d.task('correct','Исправить данные\nили отметить согласие',300,1395,'visitor',w=330,h=100)
d.task('recheck','Повторно проверить\nдоступность интервала',800,1590)
d.gate('free','Интервал ещё свободен?',800,1770)
d.task('occupied','E04 · Время уже занято\nПредложить другой интервал',1340,1755,w=380,h=100,error=True)
d.event('choose_again','ВЫБОР ВРЕМЕНИ',1580,1850,symbol='link',outline='throwing')
d.event('choose_catch','ВЫБОР ВРЕМЕНИ',515,1101,'visitor',symbol='link',outline='catching')
d.root.find("mxCell[@id='choose_catch']").set('style',d.root.find("mxCell[@id='choose_catch']").get('style')+'labelWidth=110;')
d.task('save','Сохранить заявку и занять слот\nдо решения команды\nСтатус: «Ожидает подтверждения»',800,1950,w=350,h=110)
d.event('send_error','',953,2035,symbol='error',outline='catching')
d.task('error5','E05 · Не удалось отправить заявку\nПроверить соединение\nи предложить повторить',1340,1940,w=390,h=110,error=True)
d.event('send_fail','СБОЙ ОТПРАВКИ',1580,2100,symbol='link',outline='throwing')
d.event('send_fail_catch','СБОЙ ОТПРАВКИ',300,1620,'visitor',symbol='link',outline='catching')
d.task('repeat_send','Проверить соединение\nи повторить отправку',300,1740,'visitor',w=330)
d.event('retry','ПОВТОР ОТПРАВКИ',300,1900,'visitor',symbol='link',outline='throwing')
d.event('retry_catch','ПОВТОР ОТПРАВКИ',1090,1610,symbol='link',outline='catching')
d.gate('fork','',800,2145,parallel=True)
d.task('status','Показать: «Заявка на демо\nотправлена» и статус ожидания\n«Посмотреть заявку» / «Вернуться на сайт»',740,2280,w=310,h=105)
d.task('team','Передать заявку\nкоманде',1100,2280,w=270,h=105)
d.task('mail','Запустить письмо\nо получении заявки',1440,2280,w=270,h=105)
d.event('end_status','Статус показан',740,2430,end=True)
d.event('end_team','Заявка передана',1100,2430,end=True)
d.event('end_mail','Письмо запущено',1440,2430,end=True)
# Keep lanes tall enough for all terminal events and legend outside.
d.model.set('pageHeight','2780')
for key in ['pool','visitor','system']:
    geo=d.root.find(f"mxCell[@id='{key}']/mxGeometry")
    geo.set('height',str(int(geo.get('height'))+190))
for key in ['legend','legend2']:
    geo=d.root.find(f"mxCell[@id='{key}']/mxGeometry");geo.set('y',str(int(geo.get('y'))+190))
d.note('boundary','Встреча ещё не подтверждена.\nРешение команды — отдельная история.\nПросмотр, отмена и перенос — на схеме 02.',80,2110,430,150)
d.note('form_fields','Контакты: имя, телефон, email,\nдополнительная информация.\nРезюме: сценарий, дата, время,\nGMT+3, длительность и контакты.',80,2340,430,150)
edges=[('start','open'),('open','load'),('load','calendar'),('calendar','date','Да',[(800,680),(300,680)]),('calendar','error6','Нет'),('error6','recover6','',[(1340,695),(300,695)]),('recover6','load','',[(515,602),(515,434)]),('date','slots'),('slots','has_slots'),('has_slots','select_slot','Да',[(800,1040),(300,1040)]),('has_slots','empty','Нет'),('empty','new_date','',[(1340,1025),(300,1025)]),('new_date','date','',[(85,954),(85,784)]),('select_slot','form'),('form','validate'),('validate','valid'),('valid','recheck','Да'),('valid','invalid','Нет'),('invalid','correct','',[(1340,1540),(300,1540)]),('correct','form','',[(80,1445),(80,1282)]),('recheck','free'),('free','occupied','Нет'),('occupied','choose_again'),('choose_catch','select_slot'),('free','save','Да'),('send_error','error5'),('error5','retry'),('retry_catch','recheck'),('save','fork'),('fork','status','',[(800,2240),(740,2240)]),('fork','team','',[(800,2240),(1100,2240)]),('fork','mail','',[(800,2240),(1440,2240)]),('status','end_status'),('team','end_team'),('mail','end_mail')]
edges=[e if e[:2]!=('error5','retry') else ('error5','send_fail') for e in edges]
edges.extend([('send_fail_catch','repeat_send'),('repeat_send','retry')])
for i,e in enumerate(edges):d.edge('flow'+str(i),*e,style='exitX=0;exitY=0.5;entryX=1;entryY=0.5;' if e[:2]==('choose_catch','select_slot') else '')
d.save('01-zapis-na-demo')

a=Diagram('02 · Просмотр, отмена и перенос заявки','Альтернативные сценарии A01–A03 · Начало: ранее созданная заявка и персональная ссылка',2180)
a.event('start','Заявка существует',300,270,'visitor')
a.task('open','A01 · Открыть карточку\nпо персональной ссылке',300,390,'visitor',w=350)
a.task('card','Показать время, GMT+3,\nдлительность и статус\nДействия: перенос / отмена',820,390,w=390,h=105)
a.event('card_catch','КАРТОЧКА',1350,410,symbol='link',outline='catching')
a.task('choose','Выбрать действие\nв карточке заявки',300,580,'visitor',w=330)
a.gate('action','Какое действие?',300,770,'visitor')
a.event('viewed','Просмотр завершён',130,910,'visitor',end=True)
a.task('request_cancel','A02 · Запросить подтверждение\n«Да, отменить»',820,770,w=390)
a.task('confirm','Подтвердить отмену\nили отказаться',300,1010,'visitor',w=330)
a.gate('confirmed','Отмена подтверждена?',300,1200,'visitor')
a.task('cancel','Отменить заявку\nи показать «Заявка отменена»',820,1200,w=390,h=105)
a.event('cancelled','Заявка отменена',820,1370,end=True)
a.event('card_return','КАРТОЧКА',490,1340,'visitor',symbol='link',outline='throwing')
a.event('transfer_throw','ПЕРЕНОС',480,890,'visitor',symbol='link',outline='throwing')
a.event('transfer_catch','ПЕРЕНОС',300,1430,'visitor',symbol='link',outline='catching')
a.task('new_time','A03 · Выбрать другое время',300,1550,'visitor',w=350)
a.task('transfer','Успешно перенести заявку\nна новый интервал',820,1550,w=350,h=100)
a.task('release','Освободить прежнее время\nпосле успешного переноса',1320,1550,w=350,h=100)
a.task('pending','Установить ожидание\nподтверждения команды\nдля нового интервала',1320,1760,w=350,h=110)
a.event('rescheduled','Новый интервал\nожидает подтверждения',1320,1950,end=True)
a.note('note1','Доступ к карточке — по персональной ссылке.\nКонтакты не публикуются\nв общедоступном URL.',1130,620,430,150)
a.note('note2','A02: без действия «Да, отменить»\nзаявка не отменяется.\nОтказ возвращает к карточке.',1130,1110,430,150)
a.note('note3','A03 описывает успешный перенос.\nПрежнее время освобождается\nтолько после его завершения.\nНовый интервал требует решения команды.',620,1780,440,170)
edges=[('start','open'),('open','card'),('card','choose','',[(820,550),(300,550)]),('card_catch','card'),('choose','action'),('action','viewed','Только просмотр',[(130,805)]),('action','request_cancel','Отменить заявку'),('request_cancel','confirm','',[(820,940),(300,940)]),('confirm','confirmed'),('confirmed','cancel','Да'),('confirmed','card_return','Нет',[(490,1235)]),('cancel','cancelled'),('action','new_time','Выбрать другое время',[(70,805),(70,1600)]),('new_time','transfer'),('transfer','release'),('release','pending'),('pending','rescheduled')]
edges=[e for e in edges if e[:2]!=('action','new_time')]
edges.extend([('action','transfer_throw','Выбрать другое время',[(300,875),(480,875)]),('transfer_catch','new_time')])
for i,e in enumerate(edges):
    style=''
    if e[:2]==('confirmed','card_return'):
        e=('confirmed','card_return','Нет',[(300,1363)])
        style='exitX=0.5;exitY=1;entryX=0;entryY=0.5;'
    if e[:2]==('confirmed','cancel'):style='exitX=1;exitY=0.5;entryX=0;entryY=0.5;'
    a.edge('flow'+str(i),*e,style=style)
a.save('02-alternativnye-scenarii')

book=Element('mxfile',{'host':'app.diagrams.net','agent':'Codex','version':'31.5.3'})
for id,label,diagram in [('main','01 · Запись и ошибки',d),('alternatives','02 · Просмотр, отмена, перенос',a)]:
    page=SubElement(book,'diagram',{'id':id,'name':label});page.append(diagram.model)
(OUT/'PUB.02.01.01-bpmn.drawio').write_text(tostring(book,encoding='unicode'))
print('Created 2 diagrams and editable multi-page draw.io source')
