import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { AppError, validId } from './store.js';

export function createApp({ store, responder, mode = 'demo', origin = 'http://127.0.0.1:1842', production = false }) {
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: production ? { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } : false, strictTransportSecurity: production }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ code: 'ORIGIN', message: '此请求来源不受支持。' });
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers['x-tomato-client'] !== '1') return res.status(403).json({ code: 'ORIGIN', message: '请从诊断页面发送请求。' });
    next();
  });
  const rates = new Map();
  app.use('/api', (req, res, next) => {
    const key = production ? req.ip : req.socket.remoteAddress;
    const time = store.now();
    for (const [k, v] of rates) if (v.until < time) rates.delete(k);
    const rate = rates.get(key) || { until: time + 60000, count: 0 };
    rates.set(key, rate);
    if (++rate.count > 100) return res.status(429).json({ code: 'RATE_LIMIT', message: '操作有些频繁，请稍后再试。' });
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1 } });
  function token(req) { return req.headers.cookie?.split('; ').find(c => c.startsWith('tomato_session='))?.slice(15); }
  function cookie(res, s) {
    res.cookie('tomato_session', store.sign(s), { httpOnly: true, sameSite: 'strict', secure: production, maxAge: Math.max(0, s.exp - store.now()), path: '/' });
  }
  function requireSession(req, res, next) {
    const s = store.session(token(req));
    if (!s || s.mode !== mode) return res.status(401).json({ code: 'SESSION_EXPIRED', message: '临时会话已过期或服务模式已切换，请重新发送你的问题。' });
    req.session = s; next();
  }
  app.get('/api/health', (req, res) => res.json({ ok: true, mode }));
  app.post('/api/session', (req, res) => {
    const candidate = store.session(token(req));
    const previous = candidate?.mode === mode ? candidate : null;
    const s = previous || { ...store.createSession(), mode };
    if (!previous) cookie(res, s);
    res.json({ sid: s.sid, expiresAt: s.exp, restored: !!previous, mode });
  });
  app.post('/api/image', requireSession, upload.single('image'), async (req, res) => {
    if (!req.file) throw new AppError('IMAGE_REQUIRED', '请选择一张图片。');
    const image = await store.saveImage(req.session.sid, req.file.buffer);
    const s = store.renew(req.session); cookie(res, s);
    res.json({ imageId: image.id, expiresAt: s.exp, imageExpiresAt: image.expiresAt });
  });
  app.get('/api/images/:id', requireSession, async (req, res) => {
    const image = await store.getImage(req.session.sid, req.params.id);
    res.type(image.mime).send(image.buffer);
  });
  app.get('/api/requests/:id', requireSession, async (req, res) => {
    const result = await store.getRequest(req.session.sid, req.params.id);
    if (!result) throw new AppError('NOT_FOUND', '没有找到这次请求。', 404);
    // A persisted running receipt after restart is unknown, never replay cloud calls.
    res.json({ id: result.id, state: result.state === 'running' && !active.has(result.id) ? 'unknown' : result.state, text: result.text, message: result.message, route: result.route });
  });
  const active = new Map(); const busy = new Set();
  app.post('/api/chat', requireSession, async (req, res) => {
    const { requestId, text = '', imageId, history = [] } = req.body || {};
    if (!validId(requestId) || typeof text !== 'string' || text.length > 4000 || (!text.trim() && !imageId)) throw new AppError('INPUT', '请输入 4000 字以内的问题，或上传一张图片。');
    if (!Array.isArray(history) || history.length > 100 || history.some(m => !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || m.text.length > 12000)) throw new AppError('HISTORY', '对话内容过长或格式不正确。');
    const fingerprint = createHash('sha256').update(JSON.stringify({ text, imageId: imageId || null })).digest('hex');
    const previous = await store.getRequest(req.session.sid, requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new AppError('REQUEST_CONFLICT', '同一请求不能替换内容。', 409);
      if (previous.state !== 'done') throw new AppError('REQUEST_PENDING', '这次请求已接收，请等待或恢复结果，不要重复提交。', 409);
      res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify({ type: 'delta', text: previous.text })}\n\n`);
      return res.end(`data: ${JSON.stringify({ type: 'done', requestId, route: previous.route, expiresAt: req.session.exp })}\n\n`);
    }
    if (busy.has(req.session.sid)) throw new AppError('SESSION_BUSY', '当前对话正在回答，请稍等。', 409);
    // Claim the session before any await: different tabs may submit together.
    busy.add(req.session.sid);
    let image; let referenceImage; const trustedHistory = [];
    const receipt = { id: requestId, sid: req.session.sid, fingerprint, state: 'running', expiresAt: store.now() + store.imageTtl };
    try {
      image = imageId ? await store.getImage(req.session.sid, imageId) : null;
      for (const id of [...new Set(history.map(m => m.imageId).filter(Boolean))].slice(-8)) trustedHistory.push(await store.getEvidence(req.session.sid, id));
      const lastImage = trustedHistory.filter(item => !item.expired).at(-1);
      if (!image && lastImage) referenceImage = await store.getImage(req.session.sid, lastImage.imageId);
      await store.putRequest(receipt, true);
    } catch (e) {
      busy.delete(req.session.sid);
      if (e.code === 'EEXIST') throw new AppError('REQUEST_PENDING', '这次请求已接收，请恢复结果。', 409);
      throw e;
    }
    active.set(requestId, true);
    const s = store.renew(req.session); cookie(res, s);
    res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    const emit = data => { if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`); };
    emit({ type: 'accepted', requestId, expiresAt: s.exp });
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
    let answer = '';
    try {
      const result = await responder({ text, image, referenceImage, trustedHistory, history: history.slice(-30), sid: s.sid, requestId, runDiagnosis: (selected, execute) => store.diagnoseOnce(s.sid, selected.id, execute), emit: data => {
        if (data.type === 'delta') answer += data.text;
        emit(data);
      } });
      await store.putRequest({ ...receipt, state: 'done', text: answer, route: result?.route || null, evidence: result?.evidence || [] });
      emit({ type: 'done', requestId, route: result?.route, expiresAt: s.exp });
    } catch (error) {
      const message = error instanceof AppError ? error.message : '本次处理未完成，请稍后再试。';
      await store.putRequest({ ...receipt, state: error.code === 'DIAGNOSIS_UNKNOWN' ? 'unknown' : 'failed', message });
      emit({ type: 'error', code: error.code || 'PROCESSING', message });
    } finally { clearInterval(heartbeat); active.delete(requestId); busy.delete(s.sid); res.end(); }
  });
  app.use('/api', (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在。' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const known = err instanceof AppError;
    const tooLarge = err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large';
    res.status(known ? err.status : tooLarge ? 413 : 400).json({ code: known ? err.code : 'INVALID_REQUEST', message: known ? err.message : tooLarge ? '内容过大，图片须小于 8 MB。' : '请求无法处理，请检查输入或图片数量。' });
  });
  return app;
}
