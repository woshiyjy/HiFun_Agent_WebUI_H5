import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink, rename, link } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const SESSION_TTL = 2 * 60 * 60 * 1000;
export const IMAGE_TTL = 24 * 60 * 60 * 1000;
export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export async function createStore(root, { now = Date.now, sessionTtl = SESSION_TTL, imageTtl = IMAGE_TTL } = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const dir of ['images', 'requests', 'diagnoses']) await mkdir(path.join(root, dir), { recursive: true, mode: 0o700 });
  const secretFile = path.join(root, 'session-key');
  let secret;
  try { secret = await readFile(secretFile); }
  catch (e) { if (e.code !== 'ENOENT') throw e; secret = randomBytes(32); await writeFile(secretFile, secret, { mode: 0o600, flag: 'wx' }); }
  const mac = text => createHmac('sha256', secret).update(text).digest('base64url');
  const sign = data => { const body = Buffer.from(JSON.stringify(data)).toString('base64url'); return `${body}.${mac(body)}`; };
  function verify(token) {
    try {
      const [body, sig] = token.split('.'); const expected = mac(body);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      const data = JSON.parse(Buffer.from(body, 'base64url'));
      return validId(data.sid) && Number.isFinite(data.exp) && data.exp > now() ? data : null;
    } catch { return null; }
  }
  const session = token => verify(token);
  const createSession = () => ({ sid: randomUUID(), exp: now() + sessionTtl });
  const renew = s => ({ ...s, exp: now() + sessionTtl });
  const file = (dir, id) => {
    if (!validId(id)) throw new AppError('NOT_FOUND', '图片或请求不存在。', 404);
    return path.join(root, dir, `${id}.json`);
  };
  async function read(dir, id) {
    try { return JSON.parse(await readFile(file(dir, id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function saveImage(sid, buffer) {
    if (!buffer?.length || buffer.length > 8 * 1024 * 1024) throw new AppError('IMAGE_SIZE', '请选择 8 MB 以内的图片。');
    let metadata;
    try { metadata = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata(); }
    catch { throw new AppError('IMAGE_INVALID', '图片无法读取，或超过 2000 万像素。'); }
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1)
      throw new AppError('IMAGE_FORMAT', '仅支持静态 JPG、PNG、WebP 图片。');
    // Decode all pixels, normalize orientation and strip EXIF before retaining an image.
    let clean;
    try { clean = await sharp(buffer, { limitInputPixels: 20_000_000 }).rotate().jpeg({ quality: 90 }).toBuffer(); }
    catch { throw new AppError('IMAGE_INVALID', '图片不完整，请重新选择。'); }
    const id = randomUUID();
    const record = { id, sid, mime: 'image/jpeg', width: metadata.width, height: metadata.height, expiresAt: now() + imageTtl };
    await writeFile(path.join(root, 'images', `${id}.jpg`), clean, { mode: 0o600 });
    await writeFile(file('images', id), JSON.stringify(record), { mode: 0o600 });
    return record;
  }
  async function getImage(sid, id) {
    const meta = await read('images', id);
    if (!meta || meta.sid !== sid) throw new AppError('NOT_FOUND', '图片不存在或不属于当前会话。', 404);
    if (meta.expiresAt <= now()) throw new AppError('IMAGE_EXPIRED', '这张图片已过期，请重新上传。', 410);
    return { ...meta, buffer: await readFile(path.join(root, 'images', `${id}.jpg`)) };
  }
  async function getEvidence(sid, id) {
    const meta = await read('images', id);
    if (!meta) return { imageId: id, expired: true };
    if (meta.sid !== sid) throw new AppError('NOT_FOUND', '图片不存在或不属于当前会话。', 404);
    if (meta.expiresAt <= now()) return { imageId: id, expired: true };
    return { imageId: id, expiresAt: meta.expiresAt, diagnosis: meta.diagnosis || null };
  }
  async function setEvidence(sid, id, diagnosis) {
    const meta = await read('images', id);
    if (!meta || meta.sid !== sid || meta.expiresAt <= now()) return;
    const dest = file('images', id), temp = `${dest}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ ...meta, diagnosis }), { mode: 0o600 });
    await rename(temp, dest);
  }
  async function diagnoseOnce(sid, id, execute) {
    const image = await getImage(sid, id);
    if (image.diagnosis) return image.diagnosis;
    const dest = file('diagnoses', id);
    const old = await read('diagnoses', id);
    if (old) {
      if (old.sid !== sid) throw new AppError('NOT_FOUND', '图片不存在。', 404);
      if (old.state === 'done') return old.result;
      throw new AppError('DIAGNOSIS_UNKNOWN', '这张图片已有诊断请求，结果暂不能确认，不会自动重复执行。', 409);
    }
    const record = { id, sid, expiresAt: image.expiresAt, state: 'running' };
    try { await writeFile(dest, JSON.stringify(record), { mode: 0o600, flag: 'wx' }); }
    catch (e) { if (e.code === 'EEXIST') throw new AppError('DIAGNOSIS_UNKNOWN', '这张图片已在处理中。', 409); throw e; }
    const result = await execute(image);
    const temp = `${dest}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ ...record, state: 'done', result }), { mode: 0o600 });
    await rename(temp, dest);
    await setEvidence(sid, id, result);
    return result;
  }
  async function getRequest(sid, id) {
    const record = await read('requests', id);
    if (record && record.sid !== sid) throw new AppError('NOT_FOUND', '请求不存在。', 404);
    return record;
  }
  async function putRequest(record, exclusive = false) {
    const destination = file('requests', record.id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    try { if (exclusive) await link(temporary, destination); else await rename(temporary, destination); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async function sweep() {
    for (const dir of ['images', 'requests', 'diagnoses']) {
      for (const name of await readdir(path.join(root, dir))) {
        if (!name.endsWith('.json')) continue;
        let record;
        try { record = JSON.parse(await readFile(path.join(root, dir, name), 'utf8')); } catch { continue; }
        if (record.expiresAt <= now()) {
          await unlink(path.join(root, dir, name)).catch(() => {});
          if (dir === 'images') await unlink(path.join(root, dir, `${record.id}.jpg`)).catch(() => {});
        }
      }
    }
  }
  await sweep();
  return { now, sessionTtl, imageTtl, sign, session, createSession, renew, saveImage, getImage, getEvidence, setEvidence, getRequest, putRequest, diagnoseOnce, sweep };
}
