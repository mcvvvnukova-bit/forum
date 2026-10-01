require 'json'
User.current = User.find(6)
project = Project.find_by!(identifier: 'PROJ')
plan = project.work_packages.order(:id).filter_map do |wp|
  next unless wp.subject.include?("—")
  {id: wp.id, before: wp.subject, after: wp.subject.gsub(/\s*—\s*/, ': ')}
end
File.write('/tmp/title-colons-before.json', JSON.pretty_generate(plan))
changed = []
plan.each do |item|
  wp = WorkPackage.find(item[:id])
  raise "Concurrent subject change #{wp.id}" unless wp.subject == item[:before]
  result = WorkPackages::UpdateService.new(user: User.current, model: wp).call(subject: item[:after], send_notifications: false)
  raise "Update failed #{wp.id}: #{result.errors.full_messages.join(', ')}" unless result.success?
  raise "Verification failed #{wp.id}" unless wp.reload.subject == item[:after]
  changed << {id: wp.id, subject: wp.subject}
end
remaining = project.work_packages.where("subject LIKE ?", '%—%').pluck(:id, :subject)
raise "Remaining em dashes: #{remaining.inspect}" unless remaining.empty?
File.write('/tmp/title-colons-result.json', JSON.pretty_generate({changed_count: changed.length, changed: changed, remaining: remaining}))
puts "Verified #{changed.length} changed titles; no em dashes remain"
