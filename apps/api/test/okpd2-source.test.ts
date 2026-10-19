import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('official DOCX parser rejects malformed, duplicate and unsafe source payloads',()=>{
 const r=spawnSync('python3',['-I','resources/test_rosstat_okpd2.py'],{encoding:'utf8',timeout:15000,maxBuffer:65536});assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 7 tests/);
});
