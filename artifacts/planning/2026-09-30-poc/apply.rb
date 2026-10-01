require 'json'
plan=JSON.parse(File.read('/tmp/astforum-poc-plan.json'))
user=User.find(6)
project=Project.find_by!(identifier:'PROJ')
field=WorkPackageCustomField.find_by!(name:'Модуль')
version=project.versions.find_by!(name:'PoC')
sprint=Sprint.find_by!(project_id:project.id,name:'Спринт 1')
result=[]
ActiveRecord::Base.transaction do
  raise 'Project work package set changed' unless project.work_packages.pluck(:id).sort==plan['work_packages'].map{|r|r['id']}.sort
  plan['work_packages'].each do |r|
    w=project.work_packages.find(r['id'])
    raise "Concurrent edit #{r['identifier']}" unless w.lock_version==r['lock_version']
  end
  option_ids={}
  aliases={'IAM'=>'Авторизация','PRC'=>'Заказы и лоты'}
  plan['modules'].each_with_index do |m,i|
    opt=field.custom_options.find_by(value:m['name'])
    opt ||= field.custom_options.find_by(value:aliases[m['code']]) if aliases[m['code']]
    opt ||= field.custom_options.build
    opt.assign_attributes(value:m['name'],position:i+1)
    opt.save!
    option_ids[m['code']]=opt.id
  end
  plan['work_packages'].each do |r|
    wp=project.work_packages.find(r['id'])
    attrs={description:r['url'],target_version_ids:[version.id],"custom_field_#{field.id}"=>[option_ids.fetch(r['module']).to_s],send_notifications:false}
    attrs[:sprint_id]=sprint.id if r['sprint1']
    service=WorkPackages::UpdateService.new(user:user,model:wp).call(attrs)
    raise "#{r['identifier']}: #{service.errors.full_messages.join('; ')}" unless service.success?
    wp.reload
    raise 'Description mismatch' unless wp.description==r['url']
    raise 'Version mismatch' unless wp.target_versions.pluck(:id)==[version.id]
    raise 'Module mismatch' unless wp.custom_values.where(custom_field_id:field.id).pluck(:value)==[option_ids.fetch(r['module']).to_s]
    raise 'Sprint mismatch' if r['sprint1'] && wp.sprint_id!=sprint.id
    result << {id:wp.id,identifier:wp.identifier,description:wp.description,module:r['module'],target_version_ids:wp.target_versions.pluck(:id),sprint_id:wp.sprint_id}
  end
end
puts JSON.pretty_generate({count:result.size,module_options:field.custom_options.reload.map(&:attributes),work_packages:result})
