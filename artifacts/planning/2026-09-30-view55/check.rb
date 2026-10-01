User.current = User.find(6)
Query::Results
Queries::WorkPackages::Selects::CustomFieldSelect
Costs::QueryCurrencySelect
load '/tmp/view55-sums-fixed.rb' if ENV['VIEW55_TEST_PATCH'] == '1'
load '/tmp/view55-custom-fixed.rb' if ENV['VIEW55_TEST_PATCH'] == '1'
load '/tmp/view55-currency-fixed.rb' if ENV['VIEW55_TEST_PATCH'] == '1'
query = Query.find(55)
ActiveSupport::Notifications.subscribe('sql.active_record') do |event|
  File.write('/tmp/view55-failed.sql', event.payload[:sql]) if event.payload[:exception]
end
begin
  raise 'Expected sprint grouping' unless query.group_by == 'sprint'
  raise 'Expected sums enabled' unless query.display_sums?
  groups = query.results.all_group_sums
  totals = query.results.all_total_sums
  expected = WorkPackage.where(project_id: 3).group(:sprint_id).sum(:estimated_hours)
  actual = groups.to_h { |sprint, values| [sprint&.id, values.find { |column, _| column.name.to_s == 'estimated_hours' || column.name.to_s == 'estimatedTime' }&.last] }
  puts "GROUPS #{groups.inspect}"
  puts "EXPECTED #{expected.inspect}"
  puts "ACTUAL #{actual.inspect}"
  puts "TOTALS #{totals.inspect}"
  raise "Unexpected group sums #{actual}" unless actual == expected
  puts 'PASS: all sprint estimates match direct database sums'
  File.write('/tmp/view55-check-result.txt', "PASS #{actual.inspect}\nTOTALS #{totals.inspect}")
rescue => e
  File.write('/tmp/view55-check-result.txt', "FAIL: #{e.class}: #{e.message}\n#{e.backtrace.first(20).join("\n")}")
  warn "FAIL: #{e.class}: #{e.message}"
  exit 1
end
