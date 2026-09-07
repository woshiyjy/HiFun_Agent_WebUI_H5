import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledge, searchKnowledge, knowledgeEvidence } from '../server/knowledge.js';

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
  assert.ok(price.body.length <= 3600);
});
test('无关问题不牵强引用；任意网址和文件路径不能驱动读取', () => {
  assert.deepEqual(searchKnowledge(knowledge, '火星轨道速度'), []);
  assert.deepEqual(searchKnowledge(knowledge, '../../.env https://evil.example'), []);
});


test('模型资料投影只含用户可读状态，并保留短文章完整正文', () => {
  const found = searchKnowledge(knowledge, '宁夏小拱棚越夏茬口');
  assert.equal(found[0].body, knowledge.find(d => d.id === found[0].id).body);
  const serialized = JSON.stringify(knowledgeEvidence(searchKnowledge(knowledge, '灌溉首部')));
  assert.doesNotMatch(serialized, /placeholder|available|糖度高/);
  assert.match(serialized, /正在建设中/);
});

test('长问题中明确品种名称优先命中该品种',()=>{ assert.equal(searchKnowledge(knowledge,'请详细介绍釜山88的品种特点和种植注意事项')[0].title,'釜山88'); });
