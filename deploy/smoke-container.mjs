import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const child=spawn('node',['server/index.js'],{stdio:'inherit'});
try {
 let ready=false;
 for(let i=0;i<30;i++){try{ready=(await fetch('http://127.0.0.1:1842/api/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready,'server must start');
 const base='http://127.0.0.1:1842';
 const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/theme-init.js/);
 assert.equal((await fetch(base+'/xiaozhi-user.png')).status,200);
 const r=await fetch(base+'/api/session',{method:'POST',headers:{'X-Tomato-Client':'1',Origin:'https://www.wehifun.cn'}});
 assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Secure/);
 JSON.parse(readFileSync('knowledge/snapshot.json','utf8'));
 for(const p of ['.env','knowledge/previous-1788756445736','项目记忆'])assert.equal(existsSync(p),false);
 console.log('PASS: isolated production container startup, assets, Secure Cookie and knowledge manifest; no credentials or project memory.');
}finally{child.kill('SIGTERM');}
