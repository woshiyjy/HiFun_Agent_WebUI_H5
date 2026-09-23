import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createResponder } from '../server/responder.js';

function scripted(steps, finalText = '完成') {
  let index = 0;
  return (model, context) => {
    const final = context.tools?.length === 0;
    const item = final ? { text: finalText } : (steps[index++] || { text: '完成' });
    const stream = new AssistantMessageEventStream();
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: item.tools ? item.tools.map((tool, i) => ({ type: 'toolCall', id: `call-${index}-${i}`, name: tool.name, arguments: tool.args })) : [{ type: 'text', text: item.text }], stopReason: item.tools ? 'toolUse' : 'stop' };
    queueMicrotask(() => { if (final) stream.push({ type: 'text_delta', delta: item.text, partial: message, contentIndex: 0 }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message); });
    return stream;
  };
}

test('图片只作为主模型视觉输入，不触发诊断胶囊', async () => {
  let capsuleCalls = 0;
  const events = [];
  const respond = createResponder({ mode: 'live', diagnose: async () => { capsuleCalls++; }, streamFn: scripted([{ tools: [{ name: 'complete_answer', args: { kind: 'image_description', sourceIds: [] } }] }]) });
  await respond({ text: '请描述这张图片', image: { id: 'image-one', buffer: Buffer.from('test'), mime: 'image/jpeg' }, emit: event => events.push(event) });
  assert.equal(capsuleCalls, 0);
  assert.doesNotMatch(events.map(event => event.text || '').join(''), /正在分析图片/);
});

test('知识问题必须先检索，再允许正文阶段回答', async () => {
  let searches = 0;
  const respond = createResponder({ mode: 'live', search: () => { searches++; return [{ id: 'knowledge/a', title: '测试知识', url: 'https://docs.wehifun.cn/a.html', status: 'available', body: '完整事实', date: '2026-09-21' }]; }, streamFn: scripted([{ tools: [{ name: 'search_knowledge', args: { query: '测试知识' } }] }, { tools: [{ name: 'complete_answer', args: { kind: 'knowledge', sourceIds: ['S1'] } }] }]) });
  await respond({ text: '测试知识', emit: () => {} });
  assert.equal(searches, 1);
});

test('正文回答只能附加本轮检索返回的来源', async () => {
  const events = [];
  const url = 'https://docs.wehifun.cn/采后处理/流程.html';
  const respond = createResponder({
    mode: 'live',
    search: () => [{ id: '采后处理/流程', title: '采后处理流程', url, status: 'available', body: '分拣后进行预冷。', date: '2026-09-21' }],
    streamFn: scripted([
      { tools: [{ name: 'search_knowledge', args: { query: '采后处理流程' } }] },
      { tools: [{ name: 'complete_answer', args: { kind: 'knowledge', sourceIds: ['S1'] } }] },
    ], '资料记载了分拣和预冷环节。'),
  });
  const result = await respond({ text: '采后处理流程是什么？', emit: event => events.push(event) });
  const text = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(text, /分拣和预冷环节/);
  assert.match(text, /\[采后处理流程\]\(https:\/\/docs\.wehifun\.cn/);
  assert.doesNotMatch(text, /fake\.html/);
  assert.equal(result.evidence.at(-1).accepted, true);
});

test('检索只有占位或无正文时不生成知识结论', async () => {
  const events = [];
  const respond = createResponder({ mode: 'live', search: () => [], streamFn: scripted([
    { tools: [{ name: 'search_knowledge', args: { query: '无资料的问题' } }] },
    { tools: [{ name: 'complete_answer', args: { kind: 'knowledge', sourceIds: [] } }] },
  ]) });
  await respond({ text: '请提供无资料问题的专业结论', emit: event => events.push(event) });
  const text = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(text, /没有找到可以支持这个问题的正文资料/);
  assert.doesNotMatch(text, /完成/);
});

test('暂未接入病害诊断时，返回清楚的能力边界说明', async () => {
  const events = [];
  const respond = createResponder({ mode: 'live', streamFn: scripted([{ tools: [{ name: 'complete_answer', args: { kind: 'diagnosis', sourceIds: [] } }] }]) });
  await respond({ text: '请诊断图片', image: { id: 'image-one', buffer: Buffer.from('test'), mime: 'image/jpeg' }, emit: event => events.push(event) });
  assert.match(events.filter(event => event.type === 'delta').map(event => event.text).join(''), /暂不提供番茄病害诊断/);
});
