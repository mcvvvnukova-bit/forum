require('/opt/outline/build/server/storage/database');
const {Document}=require('/opt/outline/build/server/models');
(async()=>{const ds=await Document.findAll({where:{deletedAt:null}});process.stdout.write(JSON.stringify(ds.map(d=>({id:d.id,title:d.title,text:d.text,content:d.content,urlId:d.urlId,parentDocumentId:d.parentDocumentId,updatedAt:d.updatedAt})),null,2),()=>process.exit());})().catch(e=>{console.error(e);process.exit(1)});
