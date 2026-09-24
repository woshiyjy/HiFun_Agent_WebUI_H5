import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createResponder } from '../server/responder.js';

function scripted(steps, finalText = '完成', observeContext = () => {}) {
  let index = 0;
  return (model, context) => {
    observeContext(context);
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
  const secondUrl = 'https://docs.wehifun.cn/采后处理/预冷.html';
  const respond = createResponder({
    mode: 'live',
    search: () => [
      { id: '采后处理/流程', title: '采后处理流程', url, status: 'available', body: '分拣后进行预冷。', date: '2026-09-21' },
      { id: '采后处理/预冷', title: '首次预冷', url: secondUrl, status: 'available', body: '首次预冷目标约10℃。', date: '2026-09-21' },
    ],
    streamFn: scripted([
      { tools: [{ name: 'search_knowledge', args: { query: '采后处理流程' } }] },
      { tools: [{ name: 'complete_answer', args: { kind: 'knowledge', sourceIds: ['S1', 'S2'] } }] },
    ], '资料记载了分拣和预冷环节。'),
  });
  const result = await respond({ text: '采后处理流程是什么？', emit: event => events.push(event) });
  const text = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(text, /分拣和预冷环节/);
  assert.match(text, /资料来源：\n\n- \[采后处理流程\]\(https:\/\/docs\.wehifun\.cn\/采后处理\/流程\.html\)\n- \[首次预冷\]\(https:\/\/docs\.wehifun\.cn\/采后处理\/预冷\.html\)/);
  assert.equal((text.match(/资料来源：/g) || []).length, 1);
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

test('Agent 仅暴露只读知识工具和回答核验工具，不提供系统操作能力', async () => {
  let exposedTools = [], initialPrompt = '', searchDescription = '', readDescription = '';
  const respond = createResponder({
    mode: 'live',
    streamFn: scripted([{ tools: [{ name: 'complete_answer', args: { kind: 'conversation', sourceIds: [] } }] }], '你好。', context => {
      if (context.tools?.length) {
        exposedTools = context.tools.map(tool => tool.name);
        initialPrompt = context.systemPrompt;
        searchDescription = context.tools[0].description;
        readDescription = context.tools[1].description;
      }
    }),
  });
  await respond({ text: '你好', emit: () => {} });
  assert.deepEqual(exposedTools, ['search_knowledge', 'read_knowledge', 'complete_answer']);
  assert.match(initialPrompt, /回答结构与 Markdown/);
  assert.match(initialPrompt, /每个已确认的独立环节各占一个有序列表项/);
  assert.doesNotMatch(searchDescription, /每个已确认的独立环节/);
  assert.match(readDescription, /完整步骤时.*必须先阅读相关流程正文/);
});

test('read_knowledge 只能打开本轮检索已经返回的文档', async () => {
  const events = [];
  const respond = createResponder({
    mode: 'live',
    search: () => [{ id: 'knowledge/allowed', title: '公开资料', type: '知识', url: 'https://docs.wehifun.cn/allowed.html', status: 'available', body: '公开正文' }],
    streamFn: scripted([
      { tools: [{ name: 'search_knowledge', args: { query: '公开资料' } }] },
      { tools: [{ name: 'read_knowledge', args: { id: '../../.env' } }] },
      { tools: [{ name: 'complete_answer', args: { kind: 'conversation', sourceIds: [] } }] },
    ], '你好。'),
  });
  const result = await respond({ text: '你好', emit: event => events.push(event) });
  assert.match(events.filter(event => event.type === 'delta').map(event => event.text).join(''), /你好/);
  assert.equal(result.evidence.some(item => item.tool === 'read_knowledge'), false);
});

test('一般农业知识可在检索后明确标注为一般参考', async () => {
  const events = [];
  let finalPrompt = '';
  const respond = createResponder({
    mode: 'live', search: () => [],
    streamFn: scripted([
      { tools: [{ name: 'search_knowledge', args: { query: '提高番茄坐果率' } }] },
      { tools: [{ name: 'complete_answer', args: { kind: 'general_reference', sourceIds: [] } }] },
    ], '一般参考（非嗨番知识库结论）：可先关注花期环境、水分稳定和植株营养平衡。', context => {
      if (!context.tools?.length) finalPrompt = context.systemPrompt;
    }),
  });
  await respond({ text: '一般有哪些方法可以提高番茄坐果率？', emit: event => events.push(event) });
  const answer = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(answer, /^一般参考（非嗨番知识库结论）/);
  assert.match(finalPrompt, /一般参考.*分开标注/);
});

test('具体品种没有对应资料时不能降级为一般参考', async () => {
  const events = [];
  const respond = createResponder({ mode: 'live', search: () => [], streamFn: scripted([
    { tools: [{ name: 'search_knowledge', args: { query: '高俪红品种参数' } }] },
    { tools: [{ name: 'complete_answer', args: { kind: 'general_reference', sourceIds: [] } }] },
  ], '一般参考：高俪红可能具有以下参数……') });
  await respond({ text: '高俪红的品种特点和种植注意事项是什么？', emit: event => events.push(event) });
  const answer = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(answer, /没有找到可以支持这个问题的正文资料/);
  assert.doesNotMatch(answer, /可能具有以下参数/);
});

test('文件和图表制作请求固定返回文字能力边界', async () => {
  const events = [];
  const respond = createResponder({ mode: 'live', streamFn: scripted([
    { tools: [{ name: 'complete_answer', args: { kind: 'knowledge', sourceIds: [] } }] },
  ], '这段模型草稿不能发布。') });
  await respond({ text: '请生成一份采后流程 PDF 报告并画个图表', emit: event => events.push(event) });
  const answer = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(answer, /只提供聊天中的流式文字回答/);
  assert.doesNotMatch(answer, /模型草稿/);
});

test('文字预览请求不会误拦截用户上传图片的理解', async () => {
  const events = [];
  const respond = createResponder({ mode: 'live', streamFn: scripted([
    { tools: [{ name: 'complete_answer', args: { kind: 'image_description', sourceIds: [] } }] },
  ], '这张图片里是一株番茄。') });
  await respond({ text: '给我看看这张图片', image: { id: 'image-one', buffer: Buffer.from('test'), mime: 'image/jpeg' }, emit: event => events.push(event) });
  const answer = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.match(answer, /这张图片里是一株番茄/);
  assert.doesNotMatch(answer, /不生成报告或文件/);
});
