import {createServer} from 'node:http';
export const simulatorInn='9709128511';
export const simulatorBoxId='11111111-1111-4111-8111-111111111111';
export const simulatorScenarios=['ok','blocked','unknown_block','certificate_only','other_inn','multiple','malformed','redirect','http401','http402','http403','http404','http409','http500'] as const;
export async function startDiadocSimulator(){
 let scenario:string='ok';const requests:{method:string;path:string;authorization:string}[]=[];
 const server=createServer((req,res)=>{
  requests.push({method:req.method??'',path:req.url??'',authorization:req.headers.authorization??''});
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'||req.headers.authorization!=='Bearer synthetic-token'){res.writeHead(401).end('{}');return}
  if(/^http\d+$/.test(scenario)){res.writeHead(Number(scenario.slice(4))).end('{"secret":"DO_NOT_EXPOSE"}');return}
  if(scenario==='redirect'){res.writeHead(302,{Location:'https://evil.example'}).end();return}
  if(req.url==='/GetMyOrganizations?autoRegister=false'){
   const item={OrgId:'22222222-2222-4222-8222-222222222222',Inn:scenario==='other_inn'?'500100732259':simulatorInn,Kpp:'770901001',FullName:'Тестовая компания',Ogrn:'1234567890123',
    IsEmployee:scenario!=='certificate_only',Boxes:[{BoxId:simulatorBoxId.replaceAll('-','')+'@diadoc.ru',BoxIdGuid:simulatorBoxId,Title:'Тестовая компания'}]};
   if(scenario==='malformed'){res.end('{');return}
   res.end(JSON.stringify({Organizations:scenario==='multiple'?[item,{...item,Kpp:'770901002'}]:[item]}));return;
  }
  if(req.url==='/GetMyEmployee?boxId='+simulatorBoxId){
   res.end(JSON.stringify({User:{UserId:'33333333-3333-4333-8333-333333333333',IsRegistered:true,Login:'private@example.test'},
    Permissions:{IsAdministrator:true,DocumentAccessLevel:'AllDocuments',Actions:[{Name:'SignDocuments',IsAllowed:true}],
     ...(scenario==='unknown_block'?{}:{AuthorizationPermission:{IsBlocked:scenario==='blocked'}})}}));return;
  }
  res.writeHead(404).end('{}');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,url:'http://127.0.0.1:'+(server.address() as {port:number}).port,requests,
  setScenario(value:string){if(!(simulatorScenarios as readonly string[]).includes(value))throw new Error('Unknown simulator scenario');scenario=value},
  async close(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}};
}
