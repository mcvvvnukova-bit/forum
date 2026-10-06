import assert from 'node:assert/strict'

// Matrix jobs contribute their aggregate result. A missing, skipped or canceled
// prerequisite must fail this stable required check as well as a failed job.
const required = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database']
const results = JSON.parse(process.env.QUALITY_RESULTS ?? '{}')
assert.deepEqual(Object.keys(results).sort(), [...required].sort(), 'Required quality jobs changed or missing')
for (const job of required) assert.equal(results[job].result, 'success', `${job} must succeed`)
console.log('All required quality jobs succeeded')
