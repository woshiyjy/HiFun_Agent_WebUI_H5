import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './store.js';
import { assertChengbiao } from './diagnosis.js';

const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function createCloud(env, root, fetcher = fetch) {
  const jobFile = id => path.join(root, `${id}.json`);
  async function save(job) { await mkdir(root, { recursive: true, mode: 0o700 }); await writeFile(jobFile(job.id), JSON.stringify(job), { mode: 0o600 }); }
  async function request(method, key, body, versionId) {
    await assertChengbiao(env, fetcher);
    const date = new Date().toUTCString(), type = body ? 'image/jpeg' : '';
    const canonical = `/${env.CT_OSS_BUCKET}/${key}${versionId ? `?versionId=${versionId}` : ''}`;
    const signature = createHmac('sha1', env.CT_OSS_ACCESS_KEY_SECRET).update(`${method}\n\n${type}\n${date}\n${canonical}`).digest('base64');
    const headers = { Date: date, Authorization: `OSS ${env.CT_OSS_ACCESS_KEY_ID}:${signature}` };
    if (type) headers['Content-Type'] = type;
    const url = `https://${env.CT_OSS_BUCKET}.${env.CT_OSS_REGION}.aliyuncs.com/${key.split('/').map(encode).join('/')}${versionId ? `?versionId=${encode(versionId)}` : ''}`;
    const response = await fetcher(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (response.status === 404 && ['HEAD', 'DELETE'].includes(method)) return response;
    if (!response.ok) throw new AppError('OSS_FAILED', '图片或诊断结果暂时无法存取。', 502);
    return response;
  }
  function validateJob(job) {
    const suffix = `h5-${job.id}`;
    if (!/^[a-f0-9-]{36}$/.test(job.id) || !new RegExp(`^h5-temp/\\d{4}/\\d{2}/\\d{2}/${suffix}\\.jpg$`).test(job.inputKey) || !new RegExp(`^diagnosis-output/\\d{4}/\\d{2}/\\d{2}/${suffix}_envelope\\.json$`).test(job.outputKey)) throw new Error('Invalid local cleanup manifest');
  }
  async function cleanup(job) {
    validateJob(job);
    for (const key of [job.outputKey, job.inputKey]) {
      const head = await request('HEAD', key);
      if (head.status === 404) continue;
      const version = head.headers.get('x-oss-version-id');
      // The known bucket is versioned: delete the exact version, never just add a delete marker.
      if (!version) throw new AppError('CLEANUP_VERSION', '临时对象版本无法确认，清理任务已保留待重试。', 503);
      await request('DELETE', key, undefined, version);
      const remaining = await request('HEAD', key);
      if (remaining.status !== 404) throw new AppError('CLEANUP_PENDING', '临时对象仍有版本，清理任务已保留。', 503);
    }
    await unlink(jobFile(job.id));
  }
  async function sweep() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    let pending = 0;
    for (const name of await readdir(root)) {
      if (!name.endsWith('.json')) continue;
      const job = JSON.parse(await readFile(path.join(root, name), 'utf8'));
      if (job.cleanAfter > Date.now()) { pending++; continue; }
      try { await cleanup(job); } catch { pending++; }
    }
    return pending;
  }
  async function begin() {
    const id = randomUUID();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '/');
    const job = { id, inputKey: `h5-temp/${day}/h5-${id}.jpg`, outputKey: `diagnosis-output/${day}/h5-${id}_envelope.json`, cleanAfter: Date.now() + 10 * 60000 };
    await save(job); return job;
  }
  return { request, cleanup, sweep, begin };
}
