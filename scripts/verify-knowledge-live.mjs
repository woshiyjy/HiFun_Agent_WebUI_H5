import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:1842';
const records = [];
for (const question of ['你是谁，嗨番集团是做什么的？', '根据嗨番知识库，宁夏小拱棚越夏茬口怎么安排？请附上原文链接。', '根据嗨番知识库，釜山88有哪些特点和种植注意事项？请附来源。']) {
  const s = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: base, 'X-Tomato-Client': '1' } });
  const cookie = s.headers.get('set-cookie').split(';')[0];
  const started = Date.now(); const requestId = randomUUID();
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { Origin: base, 'X-Tomato-Client': '1', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, text: question, history: [] }) });
  assert.equal(response.status, 200);
  const frames = (await response.text()).split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  assert.ok(frames.some(x => x.type === 'done')); assert.ok(!frames.some(x => x.type === 'error'));
  const answer = frames.filter(x => x.type === 'delta').map(x => x.text).join('');
  const receipt = JSON.parse(await readFile(new URL(`../.runtime/requests/${requestId}.json`, import.meta.url), 'utf8'));
  if (records.length > 0) assert.ok(receipt.evidence.some(e => e.tool === 'search_knowledge'));
  assert.ok(receipt.evidence.some(e => e.tool === 'complete_answer' && e.accepted));
  records.push({ question, answer, evidence: receipt.evidence, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(records.at(-1)));
}
assert.match(records[0].answer, /嗨番小智/);
assert.doesNotMatch(records[0].answer, /业务覆盖|品牌营销|渠道建设/);
for (const r of records) assert.doesNotMatch(r.answer, /available|placeholder/);
assert.match(records[1].answer, /https:\/\/docs\.wehifun\.cn\//);
assert.match(records[2].answer, /釜山88/);
assert.ok(records[2].answer.includes('https://docs.wehifun.cn/'));
await writeFile(new URL('../验证记录/回答依据检查_2026-09-07.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), records }, null, 2));
