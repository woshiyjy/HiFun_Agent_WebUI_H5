import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore,SESSION_TTL} from '../server/store.js';
import {meteredStream,reportedTokens} from '../server/quota.js';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai';
import {createResponder} from '../server/responder.js';

async function fixture(t,limit=100000){
 const root=await mkdtemp(path.join(tmpdir(),'hifun-quota-'));let time=Date.now();
 t.after(()=>rm(root,{recursive:true,force:true}));
 const options={tokenLimit:limit,now:()=>time};
 const store=await createStore(root,options);
 return {store,restart:()=>createStore(root,options),advance:n=>time+=n};
}
test('额度原子预留，同会话并发不能超额；按实际结算且重复结算不重复计费',async t=>{
 const {store}=await fixture(t,100);const q=store.quota(store.createSession().sid);
 const results=await Promise.allSettled([q.reserve('a',60),q.reserve('b',60)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results[1].reason.code,'SESSION_QUOTA');
 await q.settle('a',20);await q.settle('a',20);await q.reserve('b',80);
 assert.deepEqual(await q.snapshot(),{limit:100,used:20,reserved:80});
});
test('重启与Cookie恢复不清零；两小时过期新会话重置；旧sid保留原用量',async t=>{
 const f=await fixture(t,100);const s=f.store.createSession(),cookie=f.store.sign(s);
 await f.store.quota(s.sid).reserve('a',80);await f.store.quota(s.sid).settle('a',70);
 const restored=await f.restart();assert.equal(restored.session(cookie).sid,s.sid);
 assert.equal((await restored.quota(s.sid).snapshot()).used,70);
 f.advance(SESSION_TTL+1);assert.equal(restored.session(cookie),null);
 assert.equal((await restored.quota(restored.createSession().sid).snapshot()).used,0);
 assert.equal((await restored.quota(s.sid).snapshot()).used,70);
});
test('中断缺失用量保留预留并跨重启；后续请求被阻止',async t=>{
 const f=await fixture(t,40000),sid=f.store.createSession().sid;
 const stream=meteredStream(()=>{throw new Error('disconnect')},f.store.quota(sid));
 await assert.rejects(async()=>{for await(const e of stream({contextWindow:32768,maxTokens:2048},{messages:[]})){}},/disconnect/);
 const q=(await f.restart()).quota(sid);
 assert.equal((await q.snapshot()).reserved,34816);
 await assert.rejects(q.reserve('next',34816),{code:'SESSION_QUOTA'});
});
function response(model,content,reason,tokens){
 const stream=new AssistantMessageEventStream();
 const m={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content,stopReason:reason,usage:{input:tokens-10,output:10,cacheRead:0,cacheWrite:0,totalTokens:tokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
 queueMicrotask(()=>{for(const c of content)if(c.type==='text')stream.push({type:'text_delta',delta:c.text});stream.push({type:'done',reason,message:m});stream.end(m)});return stream;
}
test('决策与正文每次调用都结算；主模型决策与正文无遗漏',async t=>{
 const {store}=await fixture(t),q=store.quota(randomUUID());let calls=0;
 const responder=createResponder({mode:'live',streamFn:(m,c)=>{calls++;return c.tools.length?response(m,[{type:'toolCall',id:'a',name:'complete_answer',arguments:{kind:'conversation',sourceIds:[]}}],'toolUse',200):response(m,[{type:'text',text:'你好'}],'stop',100);}});
 await responder({text:'你好',quota:q,emit:()=>{}});
 assert.equal(calls,2);assert.deepEqual(await q.snapshot(),{limit:100000,used:300,reserved:0});
});
test('额度不足在模型调用前拒绝并保留可识别错误',async t=>{
 const {store}=await fixture(t,100);let calls=0;
 const responder=createResponder({mode:'live',streamFn:()=>{calls++;throw Error('unexpected')}});
 await assert.rejects(responder({text:'你好',quota:store.quota(randomUUID()),emit:()=>{}}),{code:'SESSION_QUOTA'});
 assert.equal(calls,0);
});
test('范围外提交固定拒答，不生成正文、不调用技能',async()=>{
 let calls=0;const events=[];
 const responder=createResponder({mode:'live',diagnose:()=>{throw Error('unexpected')},search:()=>{throw Error('unexpected')},streamFn:(m)=>{calls++;return response(m,[{type:'toolCall',id:'r',name:'complete_answer',arguments:{kind:'out_of_scope',sourceIds:[]}}],'toolUse',80)}});
 await responder({text:'写一个Python爬虫',emit:e=>events.push(e)});
 assert.equal(calls,1);assert.match(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),/不在我的工作范围/);
});
test('用量包含缓存，不从费用换算；无用量不是零消耗',()=>{
 assert.equal(reportedTokens({usage:{input:20,output:10,cacheRead:70,totalTokens:100}}),100);
 assert.equal(reportedTokens({usage:{totalTokens:0}}),null);
});

test('有用量的失败请求照常结算；预留不足时不会再次发起模型调用',async t=>{
 const {store}=await fixture(t,40000),q=store.quota(randomUUID());let calls=0;
 const respond=createResponder({mode:'live',streamFn:(m,c)=>{calls++;return response(m,[{type:'text',text:'unfinished'}],'error',10000)}});
 await assert.rejects(respond({text:'你好',quota:q,emit:()=>{}}));
 assert.equal((await q.snapshot()).used,10000);
 await assert.rejects(respond({text:'你好',quota:q,emit:()=>{}}),{code:'SESSION_QUOTA'});
 assert.equal(calls,1);
});

test('诊断胶囊内部用量不计入会话，主Agent工具往返仍逐次计入',async t=>{
 const {store}=await fixture(t),quota=store.quota(randomUUID());let calls=0,capsules=0;
 const respond=createResponder({mode:'live',diagnose:async()=>{capsules++;return {output_route:'standard',usage:{totalTokens:999999999}}},streamFn:(m,c)=>{
   calls++;
   if(calls===1)return response(m,[{type:'toolCall',id:'d',name:'diagnose_image',arguments:{target:'current'}}],'toolUse',50);
   if(calls===2)return response(m,[{type:'toolCall',id:'a',name:'complete_answer',arguments:{kind:'diagnosis',sourceIds:[]}}],'toolUse',60);
   return response(m,[{type:'text',text:'根据图片与诊断证据，请补充发生时间。'}],'stop',70);
 }});
 await respond({text:'请诊断果实',image:{id:'synthetic',buffer:Buffer.from('synthetic'),mime:'image/jpeg'},quota,emit:()=>{}});
 assert.equal(capsules,1);assert.equal(calls,3);assert.equal((await quota.snapshot()).used,180);
});
