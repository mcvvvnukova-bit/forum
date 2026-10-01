require 'json'
p=Project.find_by!(identifier:'PROJ')
data={project:p.attributes,users:User.where(id:6).map{|u|u.attributes.slice('id','login','firstname','lastname')},fields:CustomField.where(name:'Модуль').map{|f|{attributes:f.attributes,options:f.custom_options.map(&:attributes)}},versions:p.versions.map(&:attributes),sprints:Sprint.all.map(&:attributes),work_packages:p.work_packages.order(:id).map{|w|{attributes:w.attributes,custom_values:w.custom_values.map(&:attributes),target_versions:w.target_versions.map{|v|{id:v.id,name:v.name}}}}}
puts JSON.pretty_generate(data)
