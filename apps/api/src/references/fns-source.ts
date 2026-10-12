import {normalizeSnapshot,type OkvedSnapshot} from './okved-model.js';

export const FNS_BASE='https://service.nalog.ru/okved/api/v1/reference/';
const MAX_BYTES=8*1024*1024;

async function download(name:'groups'|'okveds',fetcher:typeof fetch,signal:AbortSignal):Promise<unknown> {
  const response=await fetcher(FNS_BASE+name,{signal,redirect:'error',headers:{accept:'application/json'}});
  if (!response.ok) throw new Error(`FNS HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('FNS JSON response required');
  if (Number(response.headers.get('content-length'))>MAX_BYTES) {await response.body?.cancel();throw new Error('FNS response too large');}
  if (!response.body) throw new Error('Empty FNS response');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES) {await reader.cancel();throw new Error('FNS response too large');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new Error('Invalid FNS JSON');}
}

export async function loadFnsSnapshot(fetcher:typeof fetch=fetch):Promise<OkvedSnapshot> {
  const controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]);
  try {
    const [codes,groups]=await Promise.all([download('okveds',fetcher,signal),download('groups',fetcher,signal)]);
    return normalizeSnapshot(codes,groups);
  } finally {controller.abort();}
}
