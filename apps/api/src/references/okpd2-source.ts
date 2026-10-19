import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {normalizeSnapshot,type OkpdSnapshot} from './okpd2-model.js';
export async function loadRosstatSnapshot():Promise<OkpdSnapshot>{
 const {stdout}=await promisify(execFile)('python3',['-I',fileURLToPath(new URL('../../resources/rosstat_okpd2.py',import.meta.url))],
  {timeout:150000,maxBuffer:32*1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
 return normalizeSnapshot(JSON.parse(stdout));
}
