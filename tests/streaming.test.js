import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createResponder } from '../server/responder.js';
import { modelSettings, modelStream, streamTextFilter } from '../server/model.js';

function message(model, content, stopReason = 'stop') {
  return {role:'assistant', api:model.api, provider:model.provider, model:model.id, timestamp:Date.now(), content, stopReason, usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
function gate(model) {
  const s = new AssistantMessageEventStream();
  const m = message(model,[{type:'toolCall',id:'approve',name:'complete_answer',arguments:{kind:'conversation',sourceIds:[]}}],'toolUse');
  queueMicrotask(()=>{s.push({type:'done',reason:'toolUse',message:m});s.end(m)});return s;
}
test('正文完成前已产生增量；思考和工具草稿不发布',async()=>{
  const output=[];let released=false;
  const respond=createResponder({mode:'live',streamFn:(m,c)=>{
    if(c.tools.length) return gate(m);
    assert.equal(c.tools.length,0);
    const s=new AssistantMessageEventStream();const msg=message(m,[{type:'text',text:'你好，嗨番。'}]);
    queueMicrotask(async()=>{
      s.push({type:'thinking_delta',delta:'PRIVATE_REASONING'});
      s.push({type:'text_delta',delta:'你好，'});
      await new Promise(r=>setTimeout(r,10));
      released=output.some(e=>e.type==='delta' && e.text==='你好，');
      s.push({type:'text_delta',delta:'嗨番。'});s.push({type:'done',reason:'stop',message:msg});s.end(msg);
    });return s;
  }});
  await respond({text:'你好',emit:e=>output.push(e)});
  assert.equal(released,true);assert.equal(output.filter(e=>e.type==='delta').map(e=>e.text).join(''),'你好，嗨番。');
});
for (const reason of ['length','toolUse','error','aborted']) test(`正文${reason}不可报告成功`,async()=>{
  const respond=createResponder({mode:'live',streamFn:(m,c)=>{
    if(c.tools.length)return gate(m);
    const s=new AssistantMessageEventStream();const msg=message(m,[],reason);
    queueMicrotask(()=>{s.push({type:'text_delta',delta:'不完整'});s.push({type:'done',reason,message:msg});s.end(msg)});return s;
  }});
  await assert.rejects(respond({text:'你好',emit:()=>{}}),/未完整/);
});
test('正文阶段共用超时，已输出片段不冒充完成',async()=>{
  const respond=createResponder({mode:'live',timeoutMs:25,streamFn:(m,c,o)=>{
    if(c.tools.length)return gate(m);
    const s=new AssistantMessageEventStream();o.signal.addEventListener('abort',()=>{const msg=message(m,[],'aborted');s.push({type:'done',reason:'aborted',message:msg});s.end(msg)});return s;
  }});
  await assert.rejects(respond({text:'你好',emit:()=>{}}),/耗时/);
});
test('模型请求显式设置Plus、max_tokens及思考开关',async()=>{
  for(const thinking of [false,true]) {
    const env={BAILIAN_API_KEY:'test-key',BAILIAN_BASE_URL:'https://example.aliyuncs.com/v1',BAILIAN_ENABLE_THINKING:String(thinking)};
    const {model}=modelSettings(env);let payload;
    const s=modelStream(env,thinking)(model,{messages:[{role:'user',content:'hello',timestamp:0}],systemPrompt:'test',tools:[]},{fetch:async(_url,init)=>{
      payload=JSON.parse(init.body);
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    }});
    for await(const e of s) assert.notEqual(e.type,'error');
    assert.equal(payload.model,'qwen3.7-plus');assert.equal(payload.enable_thinking,thinking);assert.equal(payload.max_tokens,2048);assert.equal(payload.max_completion_tokens,undefined);
  }
});
test('分块网址不会绕过服务端来源控制',()=>{
  let out='';const f=streamTextFilter(s=>out+=s);
  for(const part of ['正文 [假链接](ht','tps:/','/docs.wehifun.cn/fake.html)\n','尾部'])f.push(part);
  f.end();assert.doesNotMatch(out,/https|fake.html/);assert.match(out,/正文/);assert.match(out,/尾部/);
});
