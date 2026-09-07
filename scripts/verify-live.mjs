// Optional integration command: requires explicit authorization for the selected image.
// Sends it to the local H5, which calls the existing OSS/FC/Bailian services.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:1842';
const approvedImage = process.env.APPROVED_TEST_IMAGE;
if (!approvedImage?.startsWith('/') || process.env.APPROVE_TEST_IMAGE_UPLOAD !== 'true') throw new Error('Set an explicitly authorized absolute APPROVED_TEST_IMAGE and APPROVE_TEST_IMAGE_UPLOAD=true.');
let cookie = '';
async function api(url, body, method = 'POST') {
  const response = await fetch(base + url, { method, headers: { 'X-Tomato-Client': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal(response.status, 200, `HTTP ${url} failed: ${response.status}`);
  return response;
}
async function chat(body) {
  const start = Date.now();
  const response = await api('/api/chat', body);
  const events = (await response.text()).split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)));
  assert.ok(events.some(e => e.type === 'done'), 'No completed reply');
  assert.ok(!events.some(e => e.type === 'error'), 'SSE processing error');
  return { text: events.filter(e => e.type === 'delta').map(e => e.text).join(''), route: events.find(e => e.type === 'done').route, expiresAt: events.find(e => e.type === 'done').expiresAt, elapsedMs: Date.now() - start };
}
const session = await (await api('/api/session')).json(); assert.equal(session.mode, 'live');
const form = new FormData();
form.append('image', new Blob([await readFile(approvedImage)], { type: 'image/jpeg' }), 'authorized-test.jpg');
const image = await (await api('/api/image', form)).json();
console.log('H5 API: image uploaded and session authorized');
const body = { requestId: randomUUID(), text: '请调用图像诊断技能分析这张番茄图片，简短说明可见情况与需要补充的信息。', imageId: image.imageId, history: [] };
const ordinary = await chat({ requestId: randomUUID(), text: '仅描述图中的颜色，不做健康或病害诊断。', imageId: image.imageId, history: [] }); assert.equal(ordinary.route, null);
console.log('普通图片描述未调用诊断');
const first = await chat(body); assert.equal(first.route, 'standard'); assert.ok(first.text.length > 20);
console.log('H5 API: diagnosis reply received', first.route, first.elapsedMs + 'ms');
const restored = await (await api('/api/session')).json(); assert.equal(restored.sid, session.sid); assert.equal(restored.expiresAt, first.expiresAt);
const replay = await chat(body); assert.equal(replay.text, first.text); assert.equal(replay.expiresAt, first.expiresAt);
const followup = await chat({ requestId: randomUUID(), text: '补充说明：这是同一株，目前只有刚才那张图。请告诉我优先补拍哪个部位。', history: [{ role: 'user', text: body.text, imageId: image.imageId }, { role: 'assistant', text: first.text }] });
assert.ok(followup.text.length > 20);
assert.ok(!/Me级|Ma[1-4]|Gate[1-5]|钙流量|图片.{0,3}ID/.test(first.text + followup.text), 'Internal or unsupported technical claims leaked into reply');
console.log('H5 API: follow-up reply received', followup.elapsedMs + 'ms');
const recovered = await (await api(`/api/requests/${body.requestId}`, undefined, 'GET')).json(); assert.equal(recovered.text, first.text);
await api(`/api/images/${image.imageId}`, undefined, 'GET');
const previousCookie = cookie; cookie = '';
await api('/api/session');
const foreign = await fetch(`${base}/api/images/${image.imageId}`, { headers: { Cookie: cookie } }); assert.equal(foreign.status, 404); cookie = previousCookie;
const cleanupPending = (await readdir(new URL('../.runtime/cloud/', import.meta.url))).filter(name => name.endsWith('.json')).length;
assert.equal(cleanupPending, 0);
const result = { checkedAt: new Date().toISOString(), mode: 'live', ordinary, source: 'explicitly authorized test image', first, followup, sessionRestoreNoRenewal: true, duplicateReplay: true, requestRecovery: true, crossSessionDenied: true, cloudCleanupPending: cleanupPending };
await mkdir(new URL('../验证记录/', import.meta.url), { recursive: true });
await writeFile(new URL('../验证记录/Agent主导真实链路_2026-09-07.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
