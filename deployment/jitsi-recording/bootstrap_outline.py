"""Run on the VPS: back up Outline, provision Kuzmina, verify identity, save private config."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

from vks_common import read, request_json, save

BASE = Path('/opt/jitsi-recording')


def main():
    secret_path = BASE / 'secrets/outline.private.json'
    secret = read(secret_path)
    if secret is None:
        backup = BASE / 'backups' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (backup / 'outline-before-kuzmina.sql').open('wb') as output:
            subprocess.run(['docker','exec','outline-mvpspace-postgres-1','sh','-c',
                'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'], stdout=output, check=True, timeout=120)
        (backup / 'outline-before-kuzmina.sql').chmod(0o600)
        script = r'''
require('reflect-metadata');
require('./build/server/storage/database');
const {User, Team, ApiKey, Document, Collection}=require('./build/server/models');
const crypto=require('crypto');
(async()=>{
 const teams=await Team.findAll();if(teams.length!==1)throw Error('Unexpected team count');
 const team=teams[0];
 const docs=await Document.findAll({order:[['id','ASC']]});
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(docs.map(d=>[d.id,d.title,d.data,d.updatedAt]))).digest('hex');
 const owner=await User.findOne({where:{email:'mc.vvvnukova@gmail.com',teamId:team.id}});
 if(!owner)throw Error('Expected existing owner missing');
 let user=await User.findOne({where:{email:'kuzmina@astforum.ru',teamId:team.id}});
 if(!user)user=await User.create({name:'Кузьмина',email:'kuzmina@astforum.ru',teamId:team.id,role:'admin',lastActiveAt:new Date(),lastSignedInAt:new Date()});
 if(user.name!=='Кузьмина')throw Error('Unexpected assistant identity');
 const routes=['auth.info','collections.list','collections.info','collections.create','collections.add_user','collections.memberships',
  'documents.create','documents.info','documents.update','documents.list','attachments.create','attachments.list','attachments.redirect','files.create'];
 const key=await ApiKey.create({userId:user.id,name:'VKS recording pipeline',scope:routes.map(r=>'/api/'+r)});
 console.log(JSON.stringify({url:'https://outline.mvpspace.ru',userId:user.id,name:user.name,email:user.email,apiKey:key.value,apiKeyId:key.id,ownerId:owner.id,
  baseline:{documentCount:docs.length,documentFingerprint:fingerprint,collectionCount:await Collection.count()}}));
})().then(()=>process.exit(0)).catch(e=>{console.error(e.name);process.exit(1)});
'''
        result = subprocess.run(['docker','exec','-i','outline-mvpspace-outline-1','node'], input=script,
            text=True, capture_output=True, check=True, timeout=90)
        secret = json.loads(result.stdout.strip().splitlines()[-1])
        save(secret_path, secret)
        save(backup / 'baseline.json', secret['baseline'])

    def api(method, payload):
        return request_json(secret['url'] + '/api/' + method, secret['apiKey'], payload)['data']

    user = api('auth.info', {})['user']
    if user['id'] != secret['userId'] or user['name'] != 'Кузьмина' or user['email'] != 'kuzmina@astforum.ru':
        raise RuntimeError('Outline identity verification failed')
    if not secret.get('collectionId'):
        collections = api('collections.list', {'limit':100})
        collection = next((item for item in collections if item['name'] == 'Встречи ВКС'), None)
        if collection is None:
            collection = api('collections.create', {'name':'Встречи ВКС', 'permission':None,
                'sharing':False, 'description':'Записи, расшифровки и AI-протоколы встреч vks.mvpspace.ru.'})
        if collection.get('permission') is not None or collection.get('sharing') is not False:
            raise RuntimeError('Meeting collection must be private with public sharing disabled')
        secret['collectionId'] = collection['id']
        save(secret_path, secret)
    api('collections.add_user', {'id':secret['collectionId'], 'userId':secret['ownerId'], 'permission':'admin'})
    if not (BASE / 'secrets/pipeline.private.json').exists():
        save(BASE / 'secrets/pipeline.private.json', {'notBefore':time.time()})
    print(json.dumps({'identity':user['name'], 'email':user['email'], 'userId':user['id'],
        'collectionId':secret['collectionId'], 'target':secret['url']}, ensure_ascii=False))


if __name__ == '__main__':
    os.umask(0o077)
    main()
