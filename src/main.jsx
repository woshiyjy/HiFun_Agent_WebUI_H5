import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import { useConversationScroll } from './useConversationScroll.js';
import { MessageThread } from './components/MessageThread.jsx';
import { Composer } from './components/Composer.jsx';
import { WelcomePanel } from './components/WelcomePanel.jsx';
import { ProcessPanel } from './components/ProcessPanel.jsx';
import { ConversationNotices } from './components/ConversationNotices.jsx';
import './style.css';
import './theme.css';
import './tailwind.css';
import './assistant-ui.css';

const STORAGE = 'tomato-conversation-v1';
const HEADERS = { 'X-Tomato-Client': '1' };
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...HEADERS, ...options.headers } });
  if (!response.ok) { const data = await response.json(); const error = new Error(data.message || '请求未完成'); error.code = data.code; throw error; }
  return response;
}
function readSaved() { try { return JSON.parse(localStorage.getItem(STORAGE)); } catch { return null; } }
function Icon({ name, ...props }) {
  const paths = { upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v5h16v-5"/></>, arrow: <><path d="m5 12 7-7 7 7M12 5v15"/></>, close: <path d="m6 6 12 12M6 18 18 6"/>, leaf: <><path d="M19 4C8 3 3 9 7 15s13 1 12-11Z"/><path d="m5 20 9-10"/></>, image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, moon: <path d="M20.9 13.1A8.9 8.9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z"/>, sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></> };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
function initialTheme() { try { return localStorage.getItem('hifun-theme') || 'system'; } catch { return 'system'; } }
function convertAssistantMessage(message) {
  const content = [];
  if (message.text) content.push({ type: 'text', text: message.text });
  if (message.imageId) content.push({ type: 'image', image: `/api/images/${message.imageId}` });
  return { id: message.id, role: message.role, content: content.length ? content : [{ type: 'text', text: '' }] };
}
function App() {
  const [theme, setTheme] = useState(initialTheme), [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const value = theme === 'system' ? media.matches : theme === 'dark'; setDark(value); document.documentElement.dataset.theme = value ? 'dark' : 'light'; document.querySelector('meta[name="theme-color"]').content = value ? '#0f172a' : '#f8fafc'; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [theme]);
  function toggleTheme() { const next = dark ? 'light' : 'dark'; setTheme(next); try { localStorage.setItem('hifun-theme', next); } catch {} }

  const [session, setSession] = useState(null), [messages, setMessages] = useState([]);
  const [text, setText] = useState(''), [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState(null), [storageError, setStorageError] = useState(false);
  const input = useRef(), sessionRef = useRef(null), busyRef = useRef(false);
  const [processSteps, setProcessSteps] = useState([]);
  const { viewport, content, paused, resume } = useConversationScroll([messages, phase, busy, error, preview]);
  const adapter = useMemo(() => ({ messages, convertMessage: convertAssistantMessage, isRunning: busy }), [messages, busy]);
  const runtime = useExternalStoreRuntime(adapter);
  function status(value) { setPhase(value); setProcessSteps(steps => steps.at(-1) === value ? steps : [...steps, value].slice(-12)); }
  function save(s, list, request = null) {
    try {
      const value = JSON.stringify({ sid: s.sid, expiresAt: s.expiresAt, messages: list, pending: request });
      if (localStorage.getItem(STORAGE) !== value) localStorage.setItem(STORAGE, value);
      setStorageError(false);
    }
    catch { setStorageError(true); }
  }
  async function restore() {
    const data = await (await api('/api/session', { method: 'POST' })).json();
    const saved = readSaved();
    const same = data.restored && saved?.sid === data.sid;
    const list = same && Array.isArray(saved.messages) ? saved.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && typeof m.id === 'string') : [];
    sessionRef.current = data; setSession(data); setMessages(list); setPending(same ? saved.pending : null);
    save(data, list, same ? saved.pending : null);
  }
  useEffect(() => { restore().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(context.registerTool({
      name: 'stage_tomato_question', title: '填写番茄问题草稿',
      description: '把问题填写到可见输入框，不上传图片、不发送消息；用户可继续编辑后发送。',
      inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['text'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ text: value }) => {
        if (busyRef.current || typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('当前无法填写或问题长度不正确');
        setText(value); await new Promise(resolve => requestAnimationFrame(resolve)); return { staged: true, sent: false };
      },
    }, { signal: controller.signal })).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = sessionRef.current;
      if (current && Date.now() >= current.expiresAt && !busyRef.current) {
        setMessages([]); setPending(null); setError('两小时没有交互，对话已失效。可以直接开始新的提问。');
        restore().catch(e => setError(e.message));
      }
    }, 15000);
    const sync = event => { if (event.key === STORAGE && !busyRef.current) restore().catch(() => {}); };
    // Focus checks server time and expiry; it does not renew the session.
    const focus = () => { if (!busyRef.current) restore().catch(() => {}); };
    window.addEventListener('storage', sync); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  function selectFile(event) {
    const chosen = event.target.files?.[0]; event.target.value = '';
    if (!chosen) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) || chosen.size > 8 * 1024 * 1024) return setError('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片。');
    setFile(chosen); setError('');
  }
  async function recover() {
    if (!pending) return;
    setError('');
    try {
      const r = await (await api(`/api/requests/${pending}`)).json();
      if (r.state === 'running') return setError('这次回答仍在处理中，稍后可再次恢复。');
      if (r.state === 'unknown') {
        setPending(null); save(sessionRef.current, messages);
        return setError('上一条处理结果暂时无法确认，系统不会自动重复诊断。你可以继续其他问题。');
      }
      const list = messages.filter(m => m.id !== `${pending}-reply`);
      if (r.state === 'done') list.push({ id: `${pending}-reply`, role: 'assistant', text: r.text, route: r.route });
      else { if (r.text) list.push({id:`${pending}-reply`,role:'assistant',text:r.text,incomplete:true}); setError(r.message || '这次处理未完成，你可以重新提问。'); }
      setMessages(list); setPending(null); save(sessionRef.current, list);
    } catch (e) {
      setError(e.message);
      if (e.code === 'SESSION_EXPIRED') await restore();
      if (e.code === 'NOT_FOUND') { setPending(null); save(sessionRef.current, messages); setError('未找到上一条请求的结果，系统没有自动重发。可以继续提问。'); }
    }
  }
  async function send(event) {
    event.preventDefault(); if (busy || pending || (!text.trim() && !file) || !session) return;
    setBusy(true); busyRef.current = true; setError(''); setProcessSteps([]); resume();
    const question = text.trim(); let next = messages; let current = sessionRef.current; let submitted = false;
    const id = crypto.randomUUID();
    try {
      let imageId;
      if (file) {
        status('正在检查图片'); const form = new FormData(); form.append('image', file);
        const result = await (await api('/api/image', { method: 'POST', body: form })).json();
        imageId = result.imageId; current = { ...current, expiresAt: result.expiresAt };
      }
      const user = { id, role: 'user', text: question, imageId };
      next = [...messages, user]; setMessages(next); setText(''); setFile(null); status('正在准备回答');
      sessionRef.current = current; setSession(current); setPending(id); save(current, next, id);
      submitted = true;
      const response = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id, text: question, imageId, history: messages.filter(m => !m.incomplete && (m.text || m.imageId)).slice(-30).map(({ role, text, imageId }) => ({ role, text, imageId })) }) });
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', answer = '', finished = false;
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const frames = buffer.split('\n\n'); buffer = frames.pop();
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          const data = JSON.parse(frame.slice(6));
          if (data.expiresAt) { current = { ...current, expiresAt: data.expiresAt }; sessionRef.current = current; setSession(current); }
          if (data.type === 'status') status(data.text);
          if (data.type === 'delta') {
            answer += data.text; next = [...next.filter(m => m.id !== `${id}-reply`), { id: `${id}-reply`, role: 'assistant', text: answer, incomplete: true }];
            setMessages(next);
          }
          if (data.type === 'done') {
            finished = true; next = next.map(m => m.id === `${id}-reply` ? { ...m, route: data.route, incomplete: false } : m);
            setMessages(next); setPending(null); save(current, next);
          }
          if (data.type === 'error') { finished = true; setPending(null); save(current, next); setError(data.message); }
        }
        if (chunk.done) break;
      }
      if (!finished) { save(current, next, id); setError('连接中断，已显示内容尚未完整。可以恢复这次回答，系统不会自动重复提交。'); }
    } catch (e) {
      setError(e.message);
      if (submitted && !e.code) save(current, next, id);
      if (e.code === 'SESSION_EXPIRED') { await restore(); setText(question); }
      else if (e.code && !['REQUEST_PENDING', 'REQUEST_CONFLICT'].includes(e.code)) { setPending(null); save(current, next); }
      else if (!submitted) { setPending(null); }
    } finally { setBusy(false); busyRef.current = false; setPhase(''); }
  }
  return <AssistantRuntimeProvider runtime={runtime}><div className="app-shell">
    <header className="header"><a className="brand" href="/" aria-label="嗨番小智首页"><img className="brand-mascot" src="/xiaozhi-user.png" alt=""/><span>嗨番小智<small>嗨番集团 · 口感番茄产业助手</small></span></a><div className="header-tools"><a href="https://docs.wehifun.cn/" target="_blank" rel="noopener noreferrer" className="knowledge-link">知识库 ↗</a><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={dark ? '切换到亮色模式' : '切换到深色模式'} title={dark ? '切换到亮色模式' : '切换到深色模式'}><Icon name={dark ? 'sun' : 'moon'}/></button></div></header>
    <main className="main">
      {session?.mode === 'demo' && <div className="demo-banner"><span>本地演示</span>当前用于体验对话、知识查询和图片内容理解。</div>}
      <div className="conversation" ref={viewport} tabIndex={0} aria-label="对话内容"><div ref={content}>
        {messages.length === 0 ? <WelcomePanel onSuggestion={question => { setText(question); document.getElementById('question')?.focus(); }} /> : <MessageThread />}
        <ProcessPanel busy={busy} phase={phase} steps={processSteps} />
        </div>
      </div>
      <div className="composer-area">
        <ConversationNotices paused={paused} busy={busy} onResume={resume} error={error} storageError={storageError} pending={pending} onRecover={recover} />
        <Composer input={input} file={file} preview={preview} text={text} busy={busy} pending={pending} session={session} onTextChange={event => setText(event.target.value)} onFileChange={selectFile} onRemoveFile={() => setFile(null)} onSubmit={send} />
        <p className="privacy"><Icon name="clock"/>两小时无交互后失效；有效期内可在此浏览器恢复。<span>图片理解仅供参考。</span></p>
      </div>
    </main>
    <footer>嗨番小智 · 嗨番集团</footer>
  </div></AssistantRuntimeProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
