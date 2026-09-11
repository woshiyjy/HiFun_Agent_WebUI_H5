import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { createStore, SESSION_TTL, IMAGE_TTL } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createDiagnosis, validateEnvelope, assertChengbiao } from '../server/diagnosis.js';
import { createResponder, conversationEvidence } from '../server/responder.js';

const picture = () => sharp({ create: { width: 32, height: 40, channels: 3, background: '#c34834' } }).png().toBuffer();
async function fixture(t, responder, storeOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'tomato-h5-test-'));
  let time = Date.now();
  const store = await createStore(root, { ...storeOptions, now: () => time });
  const app = createApp({ store, responder: responder || createResponder({ diagnose: createDiagnosis() }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const request = (url, { cookie, body, method = 'GET', ...options } = {}) => fetch(base + url, { method, ...options, headers: { 'X-Tomato-Client': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const session = async () => { const r = await request('/api/session', { method: 'POST' }); return { cookie: r.headers.get('set-cookie').split(';')[0], ...await r.json() }; };
  return { store, root, request, session, advance: ms => time += ms };
}

test('会话恢复不续期；有效交互滑动续期；过期及伪造凭证被拒绝', async t => {
  const f = await fixture(t); const s = await f.session();
  f.advance(40 * 60000);
  const restored = await (await f.request('/api/session', { method: 'POST', cookie: s.cookie })).json();
  assert.equal(restored.expiresAt, s.expiresAt); assert.equal(restored.sid, s.sid);
  const chat = await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body: { requestId: randomUUID(), text: '你好' } });
  const renewedCookie = chat.headers.get('set-cookie').split(';')[0];
  const stream = await chat.text(); assert.match(stream, /"type":"done"/);
  const resumed = await (await f.request('/api/session', { method: 'POST', cookie: renewedCookie })).json();
  assert.equal(resumed.expiresAt, s.expiresAt + 40 * 60000);
  f.advance(SESSION_TTL + 1);
  assert.equal((await f.request('/api/chat', { method: 'POST', cookie: renewedCookie, body: { requestId: randomUUID(), text: '继续' } })).status, 401);
  assert.equal((await f.request('/api/chat', { method: 'POST', cookie: 'tomato_session=forged', body: { requestId: randomUUID(), text: '继续' } })).status, 401);
  const fresh = await (await f.request('/api/session', { method: 'POST', cookie: renewedCookie })).json(); assert.notEqual(fresh.sid, s.sid);
});

test('单图校验、会话归属、一天清理独立于会话', async t => {
  const f = await fixture(t); const a = await f.session(), b = await f.session();
  const form = new FormData(); form.append('image', new Blob([await picture()], { type: 'image/png' }), 'same.png');
  const r = await f.request('/api/image', { method: 'POST', cookie: a.cookie, body: form }); assert.equal(r.status, 200);
  const image = await r.json();
  assert.equal((await f.request(`/api/images/${image.imageId}`, { cookie: a.cookie })).status, 200);
  assert.equal((await f.request(`/api/images/${image.imageId}`, { cookie: b.cookie })).status, 404);
  const fake = new FormData(); fake.append('image', new Blob(['not-image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await f.request('/api/image', { method: 'POST', cookie: a.cookie, body: fake })).status, 400);
  const batch = new FormData(); batch.append('image', new Blob([await picture()]), '1.png'); batch.append('image', new Blob([await picture()]), '2.png');
  assert.equal((await f.request('/api/image', { method: 'POST', cookie: a.cookie, body: batch })).status, 400);
  f.advance(IMAGE_TTL + 1);
  await assert.rejects(f.store.getImage(a.sid, image.imageId), /过期/);
  await f.store.sweep(); await assert.rejects(f.store.getImage(a.sid, image.imageId), /不存在/);
});

test('同名图片获得不同 ID；签名密钥及图片可跨进程重启恢复', async t => {
  const f = await fixture(t); const s = await f.session();
  const a = await f.store.saveImage(s.sid, await picture()), b = await f.store.saveImage(s.sid, await picture());
  assert.notEqual(a.id, b.id);
  const restarted = await createStore(f.root);
  assert.equal(restarted.session(s.cookie.slice(15)).sid, s.sid);
  assert.equal((await restarted.getImage(s.sid, a.id)).mime, 'image/jpeg');
});

test('重复请求回放已完成回答，不二次执行也不续期；内容变更冲突', async t => {
  let calls = 0;
  const f = await fixture(t, async ({ emit }) => { calls++; emit({ type: 'delta', text: '完成' }); return { route: 'standard' }; });
  const s = await f.session(); const body = { requestId: randomUUID(), text: '看看' };
  const first = await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body }); await first.text();
  f.advance(30000);
  const second = await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body }); assert.match(await second.text(), /完成/); assert.equal(second.headers.get('set-cookie'), null); assert.equal(calls, 1);
  assert.equal((await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body: { ...body, text: 'different' } })).status, 409);
  const b = await f.session(); assert.equal((await f.request(`/api/requests/${body.requestId}`, { cookie: b.cookie })).status, 404);
});

test('跨标签并发只执行一次；接受的请求不被会话计时中断', async t => {
  let release; const gate = new Promise(resolve => release = resolve); let calls = 0;
  const f = await fixture(t, async ({ emit }) => { calls++; await gate; emit({ type: 'delta', text: '继续完成' }); });
  const s = await f.session(); const body = { requestId: randomUUID(), text: 'first' };
  const first = await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body });
  const second = await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body: { requestId: randomUUID(), text: 'second' } }); assert.equal(second.status, 409);
  f.advance(SESSION_TTL + 1); release(); assert.match(await first.text(), /继续完成/); assert.equal(calls, 1);
});

test('进程重启后的在途回执返回 unknown，不自动重跑', async t => {
  const f = await fixture(t); const s = await f.session(), id = randomUUID();
  await f.store.putRequest({ id, sid: s.sid, state: 'running', fingerprint: 'placeholder', expiresAt: Date.now() + IMAGE_TTL });
  const result = await (await f.request(`/api/requests/${id}`, { cookie: s.cookie })).json(); assert.equal(result.state, 'unknown');
});

test('跨站请求、缺少客户端标头、超大正文与图片被拒绝', async t => {
  const f = await fixture(t), s = await f.session();
  assert.equal((await f.request('/api/session', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/session', { method: 'POST', headers: { 'X-Tomato-Client': '' } })).status, 403);
  assert.equal((await f.request('/api/chat', { method: 'POST', cookie: s.cookie, body: { text: 'a'.repeat(300000) } })).status, 413);
  await assert.rejects(f.store.saveImage(s.sid, Buffer.alloc(8 * 1024 * 1024 + 1)), /8 MB/);
});

test('Pi 真实 Runtime 执行演示 Tool，并输出明确演示标记', async () => {
  let calls = 0; const events = [];
  const responder = createResponder({ diagnose: async () => { calls++; return { output_route: 'human_machine', payload: { demo: true } }; } });
  const result = await responder({ text: '叶子怎么了', image: { id: randomUUID(), buffer: await picture() }, history: [], emit: e => events.push(e) });
  assert.equal(calls, 1); assert.equal(result.route, 'human_machine');
  assert.ok(events.some(e => e.type === 'status' && e.text.includes('分析图片')));
  assert.match(events.filter(e => e.type === 'delta').map(e => e.text).join(''), /没有对这张图片做病害识别/);
});

test('两份合成信封通过 Schema，摘要或损坏结果不能冒充信封', async () => {
  for (const name of ['standard-1', 'standard-2']) {
    const file = new URL(`./fixtures/${name}.json`, import.meta.url);
    const data = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(validateEnvelope(data).output_route, 'standard');
  }
  assert.throws(() => validateEnvelope({ status: 'success' }), /格式/);
  assert.throws(() => validateEnvelope({ final_output: {} }), /格式/);
});

test('真实模式未就绪不调用云；非 chengbiao 身份拒绝', async () => {
  let calls = 0; const fakeFetch = async () => { calls++; return Response.json({ AccountId: 'other', Arn: 'other' }); };
  await assert.rejects(createDiagnosis({ mode: 'live', env: {}, fetcher: fakeFetch })({}), /尚未完成验收/); assert.equal(calls, 0);
  await assert.rejects(assertChengbiao({ CT_OSS_ACCESS_KEY_ID: 'PLACEHOLDER', CT_OSS_ACCESS_KEY_SECRET: 'PLACEHOLDER' }, fakeFetch), /账户身份/);
});

test('真实适配器契约：独立路径、一次 FC、输出校验、精确版本清理（模拟网络）', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tomato-cloud-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const envelope = JSON.parse(await readFile(new URL('./fixtures/standard-1.json', import.meta.url), 'utf8'));
  const objects = new Map(); const calls = [];
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), method = options.method || 'GET'; calls.push({ method, path: u.pathname });
    if (u.hostname.startsWith('sts.')) return Response.json({ AccountId: '1012872702497938', Arn: 'acs:ram::1012872702497938:user/chengbiao' });
    if (u.hostname.endsWith('fcapp.run')) {
      const body = JSON.parse(options.body); assert.ok(body.key.startsWith('h5-temp/'));
      const output = body.key.replace('h5-temp/', 'diagnosis-output/').replace('.jpg', '_envelope.json');
      objects.set('/' + output, 'output-version'); return Response.json({ status: 'success', output_key: output });
    }
    if (method === 'PUT') { objects.set(u.pathname, 'input-version'); return new Response(null, { headers: { 'x-oss-version-id': 'input-version' } }); }
    if (method === 'GET') return Response.json(envelope);
    if (method === 'HEAD') return objects.has(u.pathname) ? new Response(null, { headers: { 'x-oss-version-id': objects.get(u.pathname) } }) : new Response(null, { status: 404 });
    if (method === 'DELETE') { assert.equal(u.searchParams.get('versionId'), objects.get(u.pathname)); objects.delete(u.pathname); return new Response(null, { status: 204 }); }
    throw new Error('Unexpected operation');
  };
  const env = { CT_OSS_ACCESS_KEY_ID: 'PLACEHOLDER', CT_OSS_ACCESS_KEY_SECRET: 'PLACEHOLDER', CT_OSS_BUCKET: 'hifun-agri-assets-2026', CT_OSS_REGION: 'oss-cn-beijing', FC_DIAGNOSE_URL: 'https://cherry-iagnosis-xksiisjnvx.cn-beijing.fcapp.run', LIVE_INTEGRATION_APPROVED: 'true' };
  const diagnose = createDiagnosis({ mode: 'live', env, fetcher, journalDir: root });
  assert.equal((await diagnose({ id: randomUUID(), buffer: await picture() })).output_route, 'standard');
  assert.equal(calls.filter(c => c.path === '/diagnose').length, 1); assert.equal(objects.size, 0); assert.equal(await diagnose.sweep(), 0);
});

test('后端历史证据按图片归属校验；过期图返回过期标记', async t => {
  const f = await fixture(t); const a = await f.session(), b = await f.session();
  const image = await f.store.saveImage(a.sid, await picture());
  await f.store.setEvidence(a.sid, image.id, { output_route: 'standard', payload: { marker: 'trusted' } });
  assert.equal((await f.store.getEvidence(a.sid, image.id)).diagnosis.payload.marker, 'trusted');
  await assert.rejects(f.store.getEvidence(b.sid, image.id), /不属于/);
  f.advance(IMAGE_TTL + 1); assert.equal((await f.store.getEvidence(a.sid, image.id)).expired, true);
});

test('面向对话的证据不携带内部提示词、输出指令和图片标识', () => {
  const projected = conversationEvidence({ output_route: 'standard', payload: { prompt_text: 'UNTRUSTED_PROMPT', task_book: { task_book_id: 'INTERNAL_ID', output_requirements: { diagnostic_rules: 'INTERNAL_RULE' }, diagnostic_scope: { primary_scale: 'Me', primary_organ: '果实', growth_phase: '生殖期' } } } });
  const content = JSON.stringify(projected);
  assert.ok(!/UNTRUSTED_PROMPT|INTERNAL_ID|INTERNAL_RULE|primary_scale/.test(content));
  assert.equal(projected.scopeInference.organ, '果实');
});

test('演示会话不能直接沿用到真实模式', async t => {
  const f = await fixture(t), old = await f.session();
  const app = createApp({ store: f.store, mode: 'live', responder: async () => {} });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Tomato-Client': '1', Cookie: old.cookie };
  const reject = await fetch(base + '/api/chat', { method: 'POST', headers }); assert.equal(reject.status, 401);
  const fresh = await (await fetch(base + '/api/session', { method: 'POST', headers })).json();
  assert.equal(fresh.mode, 'live'); assert.notEqual(fresh.sid, old.sid); assert.equal(fresh.restored, false);
});


test('同一图片诊断跨请求和重启复用，未完成执行不重跑', async t => {
 const f = await fixture(t); const sid = randomUUID(); const im = await f.store.saveImage(sid, await picture()); let calls = 0;
 const execute = async () => { calls++; return { output_route: 'standard' }; };
 await f.store.diagnoseOnce(sid, im.id, execute);
 const restarted = await createStore(f.root);
 await restarted.diagnoseOnce(sid, im.id, execute);
 assert.equal(calls, 1);
 await assert.rejects(f.store.diagnoseOnce(randomUUID(), im.id, execute), /不属于/);
 const bad = await f.store.saveImage(sid, await picture());
 await assert.rejects(f.store.diagnoseOnce(sid, bad.id, async () => { throw new Error('network'); }), /network/);
 await assert.rejects(f.store.diagnoseOnce(sid, bad.id, execute), /不会自动重复/);
 assert.equal(calls, 1);
});

test('流式失败保留未完成片段，恢复不标记成功或重复执行',async t=>{
  let calls=0;
  const f=await fixture(t,async({emit})=>{calls++;emit({type:'delta',text:'未完成片段'});throw new Error('generation interrupted')});
  const session=await f.session();const requestId=randomUUID();
  const r=await f.request('/api/chat',{method:'POST',headers:{Cookie:session.cookie,'Content-Type':'application/json'},body:{requestId,text:'问题'}});
  const body=await r.text();assert.match(body,/未完成片段/);assert.match(body,/"type":"error"/);assert.doesNotMatch(body,/"type":"done"/);
  const saved=await (await f.request(`/api/requests/${requestId}`,{headers:{Cookie:session.cookie}})).json();
  assert.equal(saved.state,'failed');assert.equal(saved.text,'未完成片段');assert.equal(calls,1);
});


test('HTTP额度耗尽提示、请求重放不重复计费、恢复不重置及过期重置',async t=>{
 let executions=0;
 const f=await fixture(t,async({quota,emit})=>{
   await quota.reserve('call',60);executions++;await quota.settle('call',50);
   emit({type:'delta',text:'完成'});return {};
 },{tokenLimit:100});
 const s=await f.session(),id=randomUUID();
 const request=async(requestId,cookie=s.cookie)=>await (await f.request('/api/chat',{method:'POST',cookie,body:{requestId,text:'你好'}})).text();
 assert.match(await request(id),/"type":"done"/);
 assert.match(await request(id),/"type":"done"/);assert.equal(executions,1);
 const restored=await (await f.request('/api/session',{method:'POST',cookie:s.cookie})).json();assert.equal(restored.sid,s.sid);
 assert.match(await request(randomUUID()),/SESSION_QUOTA/);assert.equal(executions,1);
 f.advance(SESSION_TTL+1);
 const fresh=await f.session();assert.match(await request(randomUUID(),fresh.cookie),/"type":"done"/);assert.equal(executions,2);
});

test('持续上传图片维持会话时，旧主模型用量不会提前清理',async t=>{
 const f=await fixture(t,undefined,{imageTtl:1000,sessionTtl:SESSION_TTL});const s=await f.session();
 await f.store.quota(s.sid).reserve('used',100);await f.store.quota(s.sid).settle('used',90);
 let cookie=s.cookie;
 for(let i=0;i<3;i++){
   f.advance(60*60000);const body=new FormData();body.append('image',new Blob([await picture()],{type:'image/png'}),'test.png');
   const r=await f.request('/api/image',{method:'POST',cookie,body});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
   await f.store.sweep();
 }
 assert.equal(f.store.session(cookie.slice(15)).sid,s.sid);assert.equal((await f.store.quota(s.sid).snapshot()).used,90);
});
