require 'json'
user=User.find(6)
parent=WorkPackage.find(66)
rows=JSON.parse(%q![{"code": "PUB.01.01.01", "subject": "PUB.01.01.01 — Общая страница", "outline_id": "5659387b-08d7-4182-adc3-dd533e4a5ffd", "url": "https://docs.astforum.ru/doc/pub010101-obshaya-stranica-8RLs4d4lgh", "hours": 16}, {"code": "PUB.01.01.02", "subject": "PUB.01.01.02 — Страница для заказчиков", "outline_id": "881f3a16-d76c-48cb-8cef-e3e74c364e44", "url": "https://docs.astforum.ru/doc/pub010102-stranica-dlya-zakazchikov-hLDC3VXqu6", "hours": 8}, {"code": "PUB.01.01.03", "subject": "PUB.01.01.03 — Страница для поставщиков и подрядчиков", "outline_id": "8314ecd8-1935-4388-8e14-460561eac9db", "url": "https://docs.astforum.ru/doc/pub010103-stranica-dlya-postavshikov-i-podryadchikov-e2y4p3OOQ9", "hours": 8}, {"code": "PUB.01.01.04", "subject": "PUB.01.01.04 — Страница для физических лиц — работа и подработка", "outline_id": "0354efde-351e-43b3-b477-586a97eba515", "url": "https://docs.astforum.ru/doc/pub010104-stranica-dlya-fizicheskih-lic-rabota-i-podrabotka-gXxA2IgKvD", "hours": 8}]!)
result=[]
WorkPackage.transaction do
 rows.each do |row|
  existing=WorkPackage.where(project_id:3).where('subject LIKE ?', row['code']+'%').to_a
  raise "Duplicate code #{row['code']}" if existing.size>1
  wp=existing.first
  description="Требования и критерии приёмки: #{row['url']}

Фича: https://docs.astforum.ru/doc/pub0101-glavnaya-stranica-i-scenarii-raboty-nL3XeqEBBB
Родительская задача: https://roadmap.astforum.ru/work_packages/PROJ-29/activity

Реализовать адаптивный лендинг по структуре, текстам, действиям и критериям приёмки из Outline. Проверить переходы для нового и вошедшего пользователя.

Предварительная оценка: #{row['hours']} ч. Включает страницу, переходы и проверку; последующие рабочие процессы регистрации, закупок и найма оцениваются в своих фичах."
  attrs={subject:row['subject'],description:description,type_id:6,assigned_to_id:6,responsible_id:6,estimated_hours:row['hours'],schedule_manually:true}
  if wp
   raise 'Wrong parent' unless wp.parent_id==66
   service=WorkPackages::UpdateService.new(user:user,model:wp).call(attrs.merge(send_notifications:false))
  else
   service=WorkPackages::CreateService.new(user:user).call(attrs.merge(project_id:3,status_id:1,priority_id:8,send_notifications:false))
  end
  raise service.errors.full_messages.join('; ') unless service.success?
  wp=service.result
  service=WorkPackages::UpdateService.new(user:user,model:wp).call(parent_id:66,send_notifications:false)
  raise service.errors.full_messages.join('; ') unless service.success?
  result << row.merge('id'=>wp.id,'identifier'=>wp.reload.identifier,'parent_id'=>wp.parent_id)
 end
 # Перенос оценки на US: не учитывать одни и те же 40 часов дважды.
 service=WorkPackages::UpdateService.new(user:user,model:parent.reload).call(estimated_hours:nil,send_notifications:false)
 raise service.errors.full_messages.join('; ') unless service.success?
end
puts JSON.pretty_generate(result)
