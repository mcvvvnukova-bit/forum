import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrateManagedReferences} from './managed-migrate.js';
const file=process.env.DATABASE_URL_FILE;
const connectionString=file?(await readFile(file,'utf8')).trim():process.env.DATABASE_URL;
if(process.argv[2]!=='migrate'||!connectionString)throw new Error('Use managed-cli migrate with a database connection');
const pool=new Pool({connectionString});
try{await migrateManagedReferences(pool);process.stdout.write('Managed reference migration complete\n')}
finally{await pool.end()}
