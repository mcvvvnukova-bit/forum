import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import Ajv from 'ajv/dist/2020.js'
const validate=new Ajv({strict:false,validateFormats:false}).compile(JSON.parse(readFileSync(new URL('../../deployment/release-manifest.schema.json',import.meta.url))))
const routes=['/','/customers/','/suppliers/','/work/','/participate/','/login','/cabinet/','/cabinet/work/','/cabinet/settings/','/cabinet/organizations/','/cabinet/users/','/cabinet/references/okved/']
const manifest={schemaVersion:2,recordKind:'build',reconciliationStatus:'build-only',environment:'dev',sourceSha:'a'.repeat(40),sourceTree:'b'.repeat(40),buildMode:'vite',routes,toolchain:{node:'test',npm:'test',vite:'test'},sourceFingerprint:'c'.repeat(64),configFingerprint:'c'.repeat(64),lockFingerprint:'c'.repeat(64),installedDependencyFingerprint:'c'.repeat(64),artifactFingerprint:'c'.repeat(64),inputs:{'apps/web/src/home/OkvedDirectory.tsx':'c'.repeat(64)},files:{'index.html':'c'.repeat(64)},config:{VITE_FORUM_SESSION:'true',VITE_LOGIN_URL:'/login',VITE_START_URL:'/login'}}
test('OKVED route is included in the exact development artifact contract',()=>assert.equal(validate(manifest),true,JSON.stringify(validate.errors)))
test('OKVED route cannot extend the production surface',()=>assert.equal(validate({...manifest,environment:'production',buildMode:'static-copy',config:{},routes:['/','/cabinet/references/okved/']}),false))
