import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledge, searchKnowledge, readKnowledge, knowledgeEvidence } from '../server/knowledge.js';

test('知识源保留内容状态，不把占位标题当事实正文', () => {
  assert.equal(knowledge.length, 79);
  assert.equal(knowledge.filter(d => d.status === 'available').length, 66);
  const found = searchKnowledge(knowledge, '灌溉首部');
  assert.equal(found[0].status, 'placeholder');
  assert.match(found[0].body, /正在建设中/);
  assert.doesNotMatch(found[0].body, /糖度高/);
});
test('具体设施查询命中正确文章且保留来源，价格不冒充实时数据', () => {
  const found = searchKnowledge(knowledge, '宁夏小拱棚越夏茬口怎么安排？');
  assert.match(found[0].title, /宁夏产区小拱棚越夏/);
  assert.equal(found[0].status, 'available');
  assert.equal(new URL(found[0].url).origin, 'https://docs.wehifun.cn');
  assert.ok(found[0].url.endsWith('.html'));
  const price = searchKnowledge(knowledge, '全年产销价格趋势')[0];
  assert.match(price.date, /2026-06-24/);
  assert.ok(price.body.length <= 900);
});
test('无关问题不牵强引用；任意网址和文件路径不能驱动读取', () => {
  assert.deepEqual(searchKnowledge(knowledge, '火星轨道速度'), []);
  assert.deepEqual(searchKnowledge(knowledge, '../../.env https://evil.example'), []);
});


test('检索摘要长度受限且资料投影只含用户可读状态', () => {
  const found = searchKnowledge(knowledge, '宁夏小拱棚越夏茬口');
  assert.ok(found[0].body.length <= 900);
  assert.match(found[0].body, /宁夏|越夏|茬口/);
  const serialized = JSON.stringify(knowledgeEvidence(searchKnowledge(knowledge, '灌溉首部')));
  assert.doesNotMatch(serialized, /placeholder|available|糖度高/);
  assert.match(serialized, /正在建设中/);
});

test('检索默认覆盖更多候选，点名品种优先且摘要受长度限制', () => {
  const process = searchKnowledge(knowledge, '小番茄采后处理全流程步骤');
  assert.equal(process.length, 12);
  assert.ok(process.some(doc => /预冷/.test(doc.title)));
  assert.ok(process.some(doc => /分选|分拣/.test(doc.title)));
  assert.ok(process.every(doc => doc.body.length <= 900));
  assert.equal(searchKnowledge(knowledge, '采后流程', 100).length, 12);
  assert.equal(searchKnowledge(knowledge, '高俪红的品种特点和种植注意事项')[0].title, '高俪红');
});

test('长问题中明确品种名称优先命中该品种',()=>{ assert.equal(searchKnowledge(knowledge,'请详细介绍釜山88的品种特点和种植注意事项')[0].title,'釜山88'); });
test('知识库只能只读继续阅读，长文支持偏移和章节', () => {
  const hit = searchKnowledge(knowledge, '釜山88')[0];
  const first = readKnowledge(knowledge, hit.id, { maxChars: 500 });
  assert.equal(first.id, hit.id);
  assert.ok(first.body.length <= 500);
  if (first.nextOffset !== null) {
    const next = readKnowledge(knowledge, hit.id, { offset: first.nextOffset, maxChars: 500 });
    assert.equal(next.offset, first.nextOffset);
  }
  assert.equal(readKnowledge(knowledge, '../.env'), null);
});
