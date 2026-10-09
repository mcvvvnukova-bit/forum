import assert from 'node:assert/strict'

// Matrix jobs contribute their aggregate result. Only a successful selection
// job can justify a skipped prerequisite; failures and cancellations always fail.
const required = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database', 'profile', 'operational', 'web-release']
const results = JSON.parse(process.env.QUALITY_RESULTS ?? '{}')
assert.deepEqual(Object.keys(results).sort(), ['changes', ...required].sort(), 'Required quality jobs changed or missing')
assert.equal(results.changes.result, 'success', 'Change selection must succeed')
const selection = JSON.parse(results.changes.outputs?.selection ?? '{}')
assert.deepEqual(Object.keys(selection).sort(), [...required].sort(), 'Incomplete change selection')
assert.equal(selection.layout, true, 'Layout must always run')
for (const job of required) {
  assert.equal(typeof selection[job], 'boolean', `Invalid selection: ${job}`)
  assert(['success', 'skipped'].includes(results[job]?.result), `${job} failed, was cancelled or has no result`)
  if (selection[job]) assert.equal(results[job].result, 'success', `${job} must succeed`)
}
console.log('All selected quality jobs succeeded')
