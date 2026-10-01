require 'json'
Rails.logger.level=Logger::ERROR
user=User.find(6)
rows=[[182,'2027-03-29','2027-03-30'],[183,'2027-03-31','2027-03-31'],[184,'2027-04-01','2027-04-01'],[185,'2027-04-02','2027-04-02']]
WorkPackage.transaction do
 rows.each do |id,start,finish|
  r=WorkPackages::UpdateService.new(user:user,model:WorkPackage.find(id)).call(start_date:start,due_date:finish,schedule_manually:true,send_notifications:false)
  raise r.errors.full_messages.join('; ') unless r.success?
 end
end
puts WorkPackage.where(id:[66,182,183,184,185]).map{|w|w.attributes.slice('id','identifier','subject','parent_id','assigned_to_id','responsible_id','estimated_hours','derived_estimated_hours','description','start_date','due_date')}.to_json
