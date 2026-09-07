import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';

test('生产代理：Secure Cookie、CSP、来源检查及独立客户端限流', async t => {
 const root = await mkdtemp(path.join(tmpdir(), 'hifun-production-'));
 const app = createApp({store: await createStore(root), production: true, origin:'https://www.wehifun.cn'});
 const server = app.listen(0,'127.0.0.1');
 await new Promise(resolve => server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(root,{recursive:true,force:true});});
 const base = `http://127.0.0.1:${server.address().port}`;
 const headers={'X-Tomato-Client':'1',Origin:'https://www.wehifun.cn','X-Forwarded-For':'192.0.2.1'};
 const r=await fetch(base+'/api/session',{method:'POST',headers});
 assert.equal(r.status,200);
 assert.match(r.headers.get('set-cookie'),/Secure/);
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
 assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
 assert.match(r.headers.get('content-security-policy'),/img-src 'self' data: blob:/);
 assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{...headers,Origin:'https://invalid.example'}})).status,403);
 for(let i=0;i<99;i++) assert.equal((await fetch(base+'/api/health',{headers})).status,200);
 assert.equal((await fetch(base+'/api/health',{headers})).status,429);
 assert.equal((await fetch(base+'/api/health',{headers:{...headers,'X-Forwarded-For':'192.0.2.2'}})).status,200);
});
