require('/opt/outline/build/server/storage/database');
const {Document}=require('/opt/outline/build/server/models');
const {Op}=require('/opt/outline/node_modules/sequelize');
(async()=>{const ds=await Document.findAll({where:{title:{[Op.like]:'PUB.01.01%'},deletedAt:null}});process.stdout.write(JSON.stringify(ds.map(d=>({id:d.id,title:d.title,text:d.text,content:d.content,urlId:d.urlId,updatedAt:d.updatedAt})),null,2),()=>process.exit());})().catch(e=>{console.error(e);process.exit(1)});
