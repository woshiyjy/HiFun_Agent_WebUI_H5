import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createResponder } from '../server/responder.js';
import { modelSettings, modelStream, streamTextFilter, isValidModelEndpoint } from '../server/model.js';

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
test('旧百炼配置仍可显式回退并保留其请求格式',async()=>{
  assert.equal(modelSettings({BAILIAN_MODEL:'qwen3.7-plus'}).model.provider,'bailian');
  for(const thinking of [false,true]) {
    const env={MODEL_PROVIDER:'bailian',BAILIAN_API_KEY:'test-key',BAILIAN_BASE_URL:'https://example.aliyuncs.com/v1',BAILIAN_ENABLE_THINKING:String(thinking)};
    const {model}=modelSettings(env);let payload;
    const s=modelStream(env,thinking)(model,{messages:[{role:'user',content:'hello',timestamp:0}],systemPrompt:'test',tools:[]},{fetch:async(_url,init)=>{
      payload=JSON.parse(init.body);
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    }});
    for await(const e of s) assert.notEqual(e.type,'error');
    assert.equal(payload.model,'qwen3.7-plus');assert.equal(payload.enable_thinking,thinking);assert.equal(payload.max_tokens,2048);assert.equal(payload.max_completion_tokens,undefined);
  }
});
test('DeepSeek V4.1 Flash 使用官方模型名、视觉/工具协议和显式思考参数',async()=>{
  const env={MODEL_API_KEY:'test-key'};
  const {model,thinking}=modelSettings(env);let payload,url;
  assert.equal(model.id,'deepseek-flash');assert.equal(model.provider,'deepseek');assert.deepEqual(model.input,['text','image']);
  assert.equal(thinking,true);assert.equal(model.maxTokens,4096);assert.equal(model.compat.thinkingFormat,'deepseek');
  const s=modelStream(env,thinking)(model,{messages:[{role:'user',content:[{type:'text',text:'hello'},{type:'image',mimeType:'image/png',data:'aGVsbG8='}],timestamp:0}],systemPrompt:'test',tools:[]},{fetch:async(request,init)=>{
    url=String(request);payload=JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});
  for await(const e of s) assert.notEqual(e.type,'error');
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  assert.equal(payload.model,'deepseek-flash');assert.equal(payload.max_tokens,4096);
  assert.deepEqual(payload.thinking,{type:'enabled'});assert.equal(payload.reasoning_effort,'high');
  assert.equal(payload.enable_thinking,undefined);
  assert.deepEqual(payload.messages[1].content[1],{type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8='}});
});
test('DeepSeek 思考模式下工具往返会保留 reasoning_content',async()=>{
  const env={MODEL_API_KEY:'test-key'};
  const {model,thinking}=modelSettings(env);const bodies=[];let call=0;
  const fetch=async(_request,init)=>{
    bodies.push(JSON.parse(init.body));
    const events=call++===0
      ? [
          {choices:[{delta:{role:'assistant'},finish_reason:null}]},
          {choices:[{delta:{reasoning_content:'PRIVATE_PLAN'},finish_reason:null}]},
          {choices:[{delta:{tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'search_knowledge',arguments:'{"query":"采后"}'}}]},finish_reason:null}]},
          {choices:[{delta:{},finish_reason:'tool_calls'}]},
        ]
      : [{choices:[{delta:{role:'assistant'},finish_reason:null}]},{choices:[{delta:{content:'已完成'},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}]}];
    return new Response(`${events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  };
  const tools=[{name:'search_knowledge',description:'read only',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}];
  const user={role:'user',content:'采后流程',timestamp:1};
  const first=modelStream(env,thinking)(model,{systemPrompt:'sys',messages:[user],tools},{fetch});
  let assistant;
  for await(const event of first) if(event.type==='done') assistant=event.message;
  assert.equal(assistant.stopReason,'toolUse');
  const followup=modelStream(env,thinking)(model,{systemPrompt:'sys',messages:[user,assistant,{role:'toolResult',toolCallId:'call-1',toolName:'search_knowledge',content:[{type:'text',text:'资料片段'}],isError:false,timestamp:2}],tools},{fetch});
  for await(const _event of followup) {}
  const assistantRequest=bodies[1].messages.find(message=>message.role==='assistant');
  assert.equal(assistantRequest.reasoning_content,'PRIVATE_PLAN');
  assert.equal(assistantRequest.tool_calls[0].id,'call-1');
  assert.equal(bodies[1].messages.find(message=>message.role==='tool').content,'资料片段');
});
test('模型地址校验只接受 DeepSeek 官方 HTTPS API 或现有百炼域名',()=>{
  assert.equal(isValidModelEndpoint('deepseek','https://api.deepseek.com'),true);
  assert.equal(isValidModelEndpoint('deepseek','http://api.deepseek.com'),false);
  assert.equal(isValidModelEndpoint('deepseek','https://api.deepseek.com.attacker.invalid'),false);
  assert.equal(isValidModelEndpoint('bailian','https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),true);
  assert.equal(isValidModelEndpoint('bailian','https://example.invalid/compatible-mode/v1'),false);
});
test('分块网址不会绕过服务端来源控制',()=>{
  let out='';const f=streamTextFilter(s=>out+=s);
  for(const part of ['正文 [假链接](ht','tps:/','/docs.wehifun.cn/fake.html)\n','尾部'])f.push(part);
  f.end();assert.doesNotMatch(out,/https|fake.html/);assert.match(out,/正文/);assert.match(out,/尾部/);
});
