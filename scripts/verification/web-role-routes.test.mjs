import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import Ajv from 'ajv/dist/2020.js'
const schema=JSON.parse(readFileSync(new URL('../../deployment/release-manifest.schema.json',import.meta.url)))
const validate=new Ajv({strict:false,validateFormats:false}).compile(schema)
const routes=['/','/customers/','/suppliers/','/work/','/participate/','/login','/cabinet/','/cabinet/work/','/cabinet/settings/','/cabinet/organizations/','/cabinet/users/']
const manifest={schemaVersion:2,recordKind:'build',reconciliationStatus:'build-only',environment:'dev',sourceSha:'a'.repeat(40),sourceTree:'b'.repeat(40),buildMode:'vite',routes,toolchain:{node:'test',npm:'test',vite:'test'},sourceFingerprint:'c'.repeat(64),configFingerprint:'c'.repeat(64),lockFingerprint:'c'.repeat(64),installedDependencyFingerprint:'c'.repeat(64),artifactFingerprint:'c'.repeat(64),inputs:{'apps/web/src/home/RoleManagementSection.tsx':'c'.repeat(64)},files:{'index.html':'c'.repeat(64)},config:{VITE_FORUM_SESSION:'true',VITE_LOGIN_URL:'/login',VITE_START_URL:'/login'}}
test('current dev user route receipt validates while historical receipts remain accepted',()=>{
 assert.equal(validate(manifest),true,JSON.stringify(validate.errors))
 for(const historical of [[...routes.slice(0,-1),'/cabinet/roles/'],routes.slice(0,-1),routes.slice(0,-2),routes.slice(0,8),routes.slice(0,6),[...routes.slice(0,6),'/register']])assert.equal(validate({...manifest,routes:historical}),true,JSON.stringify(validate.errors))
})
test('unknown dev routes and user route in production fail closed',()=>{
 assert.equal(validate({...manifest,routes:[...routes,'/cabinet/unknown/']}),false)
 assert.equal(validate({...manifest,environment:'production',buildMode:'static-copy',config:{},routes:['/','/cabinet/users/']}),false)
 assert.equal(validate({...manifest,environment:'production',buildMode:'static-copy',config:{},routes:['/']}),true,JSON.stringify(validate.errors))
})
