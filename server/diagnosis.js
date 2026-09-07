import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AppError } from './store.js';
import { createCloud } from './cloud.js';

const schema = JSON.parse(await readFile(new URL('../contracts/output.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
const validate = ajv.compile(schema);
export function validateEnvelope(envelope) {
  if (!envelope || !validate(envelope.final_output) || envelope.output_route !== envelope.final_output.output_route)
    throw new AppError('DIAGNOSIS_SCHEMA', '诊断结果格式不完整，暂时不能生成回答。', 502);
  return envelope.final_output;
}
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// No credentials are discovered from default CLI profiles or unrelated files.
export async function assertChengbiao(env, fetcher = fetch) {
  const id = env.CT_OSS_ACCESS_KEY_ID, secret = env.CT_OSS_ACCESS_KEY_SECRET;
  if (!id || !secret) throw new AppError('CONFIG', '真实诊断的服务端凭证尚未配置。', 503);
  const params = { AccessKeyId: id, Action: 'GetCallerIdentity', Format: 'JSON', SignatureMethod: 'HMAC-SHA1', SignatureNonce: randomUUID(), SignatureVersion: '1.0', Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2015-04-01' };
  const canonical = Object.keys(params).sort().map(k => `${encode(k)}=${encode(params[k])}`).join('&');
  const signature = createHmac('sha1', `${secret}&`).update(`GET&%2F&${encode(canonical)}`).digest('base64');
  const response = await fetcher(`https://sts.cn-beijing.aliyuncs.com/?${canonical}&Signature=${encode(signature)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new AppError('IDENTITY', '无法核验部署账户，已停止真实诊断。', 503);
  const identity = await response.json();
  if (String(identity.AccountId) !== '1012872702497938' || identity.Arn !== 'acs:ram::1012872702497938:user/chengbiao') throw new AppError('IDENTITY', '账户身份不符合本项目要求，已停止调用。', 403);
}
export function createDiagnosis({ mode = 'demo', env = process.env, fetcher = fetch, journalDir } = {}) {
  const cloud = mode === 'live' && journalDir ? createCloud(env, journalDir, fetcher) : null;
  const diagnose = async image => {
    if (mode === 'demo') return { output_route: 'human_machine', routing_reason: '本地演示，不执行图像识别', payload: { demo: true, width: image.width, height: image.height } };
    if (env.LIVE_INTEGRATION_APPROVED !== 'true') throw new AppError('LIVE_NOT_READY', '真实诊断接入尚未完成验收，目前不能调用云端。', 503);
    if (env.CT_OSS_BUCKET !== 'hifun-agri-assets-2026' || env.CT_OSS_REGION !== 'oss-cn-beijing') throw new AppError('CONFIG', 'OSS 资源范围尚未正确配置。', 503);
    const endpoint = new URL(env.FC_DIAGNOSE_URL || 'https://invalid.local');
    if (endpoint.origin !== 'https://cherry-iagnosis-xksiisjnvx.cn-beijing.fcapp.run') throw new AppError('CONFIG', '诊断服务地址不符合已记录资源。', 503);
    if (!cloud) throw new AppError('CONFIG', '本地临时对象清理尚未配置。', 503);
    const job = await cloud.begin();
    const key = job.inputKey, outputKey = job.outputKey;
    await cloud.request('PUT', key, image.buffer);
    await assertChengbiao(env, fetcher);
    let response;
    try { response = await fetcher(`${endpoint.origin}/diagnose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucket: env.CT_OSS_BUCKET, key }), signal: AbortSignal.timeout(130000), redirect: 'error' }); }
    catch { throw new AppError('DIAGNOSIS_UNKNOWN', '诊断请求已发出，但结果暂时无法确认，请勿重复提交。', 504); }
    if (!response.ok) throw new AppError('DIAGNOSIS_FAILED', '诊断服务暂时未能完成处理。', 502);
    let summary = await response.json();
    if (summary.body) summary = typeof summary.body === 'string' ? JSON.parse(summary.body) : summary.body;
    if (summary.status !== 'success' || summary.output_key !== outputKey) throw new AppError('RESULT_NOT_SAVED', '诊断结果尚未可靠保存，不能生成回答。', 502);
    const result = await cloud.request('GET', outputKey);
    const envelope = await result.json();
    const finalOutput = validateEnvelope(envelope);
    // Only objects created for this exact request are removed. Local image stays for one day.
    try { await cloud.cleanup(job); } catch { /* Manifest remains for the bounded cleanup worker. */ }
    return finalOutput;
  };
  diagnose.sweep = async () => cloud ? cloud.sweep() : 0;
  return diagnose;
}
