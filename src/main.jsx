import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './style.css';
import './theme.css';

const STORAGE = 'tomato-conversation-v1';
const HEADERS = { 'X-Tomato-Client': '1' };
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...HEADERS, ...options.headers } });
  if (!response.ok) { const data = await response.json(); const error = new Error(data.message || '请求未完成'); error.code = data.code; throw error; }
  return response;
}
function readSaved() { try { return JSON.parse(localStorage.getItem(STORAGE)); } catch { return null; } }
function Icon({ name, ...props }) {
  const paths = { upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v5h16v-5"/></>, arrow: <><path d="m5 12 7-7 7 7M12 5v15"/></>, close: <path d="m6 6 12 12M6 18 18 6"/>, leaf: <><path d="M19 4C8 3 3 9 7 15s13 1 12-11Z"/><path d="m5 20 9-10"/></>, image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></> };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
function initialTheme() { try { return localStorage.getItem('hifun-theme') || 'system'; } catch { return 'system'; } }
function SourceLink({ href, children }) {
  try { const url = new URL(href); if (url.origin === 'https://docs.wehifun.cn' && !url.username && !url.password) return <a href={url.href} target="_blank" rel="noopener noreferrer">{children}</a>; } catch {}
  return <span>{children}</span>;
}
function App() {
  const [theme, setTheme] = useState(initialTheme), [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const value = theme === 'system' ? media.matches : theme === 'dark'; setDark(value); document.documentElement.dataset.theme = value ? 'dark' : 'light'; document.querySelector('meta[name="theme-color"]').content = value ? '#14251e' : '#f4f6f5'; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [theme]);
  function toggleTheme() { const next = dark ? 'light' : 'dark'; setTheme(next); try { localStorage.setItem('hifun-theme', next); } catch {} }

  const [session, setSession] = useState(null), [messages, setMessages] = useState([]);
  const [text, setText] = useState(''), [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState(null), [storageError, setStorageError] = useState(false);
  const bottom = useRef(), input = useRef(), sessionRef = useRef(null), busyRef = useRef(false);
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
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: busy ? 'instant' : 'smooth', block: 'end' }); }, [messages, phase]);
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
      else setError(r.message || '这次处理未完成，你可以重新提问。');
      setMessages(list); setPending(null); save(sessionRef.current, list);
    } catch (e) {
      setError(e.message);
      if (e.code === 'SESSION_EXPIRED') await restore();
      if (e.code === 'NOT_FOUND') { setPending(null); save(sessionRef.current, messages); setError('未找到上一条请求的结果，系统没有自动重发。可以继续提问。'); }
    }
  }
  async function send(event) {
    event.preventDefault(); if (busy || pending || (!text.trim() && !file) || !session) return;
    setBusy(true); busyRef.current = true; setError('');
    const question = text.trim(); let next = messages; let current = sessionRef.current; let submitted = false;
    const id = crypto.randomUUID();
    try {
      let imageId;
      if (file) {
        setPhase('正在检查图片'); const form = new FormData(); form.append('image', file);
        const result = await (await api('/api/image', { method: 'POST', body: form })).json();
        imageId = result.imageId; current = { ...current, expiresAt: result.expiresAt };
      }
      const user = { id, role: 'user', text: question, imageId };
      next = [...messages, user]; setMessages(next); setText(''); setFile(null); setPhase('正在准备回答');
      sessionRef.current = current; setSession(current); setPending(id); save(current, next, id);
      submitted = true;
      const response = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id, text: question, imageId, history: messages.filter(m => m.text || m.imageId).slice(-30).map(({ role, text, imageId }) => ({ role, text, imageId })) }) });
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', answer = '', finished = false;
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const frames = buffer.split('\n\n'); buffer = frames.pop();
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          const data = JSON.parse(frame.slice(6));
          if (data.expiresAt) { current = { ...current, expiresAt: data.expiresAt }; sessionRef.current = current; setSession(current); }
          if (data.type === 'status') setPhase(data.text);
          if (data.type === 'delta') {
            answer += data.text; next = [...next.filter(m => m.id !== `${id}-reply`), { id: `${id}-reply`, role: 'assistant', text: answer }];
            setMessages(next); save(current, next, id);
          }
          if (data.type === 'done') {
            finished = true; next = next.map(m => m.id === `${id}-reply` ? { ...m, route: data.route } : m);
            setMessages(next); setPending(null); save(current, next);
          }
          if (data.type === 'error') { finished = true; setPending(null); save(current, next); setError(data.message); }
        }
        if (chunk.done) break;
      }
      if (!finished) setError('连接中断。可以恢复这次回答，系统不会自动重复提交。');
    } catch (e) {
      setError(e.message);
      if (e.code === 'SESSION_EXPIRED') { await restore(); setText(question); }
      else if (e.code && !['REQUEST_PENDING', 'REQUEST_CONFLICT'].includes(e.code)) { setPending(null); save(current, next); }
      else if (!submitted) { setPending(null); }
    } finally { setBusy(false); busyRef.current = false; setPhase(''); }
  }
  return <div className="app-shell">
    <header className="header"><a className="brand" href="/" aria-label="嗨番小智首页"><img className="brand-mascot" src="/xiaozhi-user.png" alt=""/><span>嗨番小智<small>嗨番集团 · 口感番茄产业助手</small></span></a><div className="header-tools"><a href="https://docs.wehifun.cn/" target="_blank" rel="noopener noreferrer" className="knowledge-link">知识库 ↗</a><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={dark ? '切换到亮色模式' : '切换到深色模式'} title={dark ? '切换到亮色模式' : '切换到深色模式'}>{dark ? '☀' : '☾'}</button></div></header>
    <main className="main">
      {session?.mode === 'demo' && <div className="demo-banner"><span>本地演示</span>当前用于体验对话和补图流程，尚未接入真实病害诊断。</div>}
      <div className="conversation">
        {messages.length === 0 ? <section className="welcome"><img className="welcome-mascot" src="/xiaozhi-user.png" alt="挥手打招呼的嗨番小智"/><span className="eyebrow">你好，我是嗨番小智</span><h1>关于口感番茄，<br/>我们一起聊聊。</h1><p>可以问种植与产业知识，也可以上传图片，<br className="desktop-break"/>一起梳理问题、补充情况，继续追问。</p><div className="suggestions">{['你能帮我做什么？', '我想诊断番茄图片，需要怎么拍、补充哪些情况？', '帮我查查釜山88的品种特点和种植注意事项。'].map(q => <button type="button" key={q} onClick={() => { setText(q); document.getElementById('question')?.focus(); }}>{q}<span>↗</span></button>)}</div><p className="company-intro">嗨番集团是一家专注于口感番茄的产业运营商。</p></section> : <section className="message-list" aria-label="与嗨番小智对话">{messages.map(m => <article className={`message ${m.role}`} key={m.id}><div className="message-label">{m.role === 'user' ? '你' : '嗨番小智'}{m.route && <span className="route-tag">{{ standard: '分析参考', human_machine: '需要补充', block: '暂无法判断' }[m.route]}</span>}</div>{m.imageId && <img className="message-image" src={`/api/images/${m.imageId}`} alt="本次上传的番茄图片" onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.hidden = false; }}/ >}{m.imageId && <p hidden className="expired-image">图片已不可用，需要重新查看时请补传。</p>}{m.text && <div className="message-text">{m.role === 'assistant' ? <Markdown remarkPlugins={[remarkGfm]} components={{ a: SourceLink, img: () => null }}>{m.text}</Markdown> : m.text}</div>}</article>)}</section>}
        {busy && <div className="progress" role="status"><span className="pulse"/>{phase || '正在回答'}</div>}
        <div ref={bottom}/>
      </div>
      <div className="composer-area">
        {error && <div className="error" role="alert">{error}</div>}
        {storageError && <div className="error" role="alert">浏览器未能保存对话。刷新或关闭后可能无法恢复。</div>}
        {pending && !busy && <button className="recover" onClick={recover}>恢复上一条回答</button>}
        <form className="composer" onSubmit={send}>
          {file && <div className="attachment">{preview && <img src={preview} alt="待上传图片预览"/>}<span>{file.name}</span><button type="button" onClick={() => setFile(null)} aria-label="移除待上传图片"><Icon name="close"/></button></div>}
          <label className="sr-only" htmlFor="question">向嗨番小智提问</label><textarea id="question" placeholder="问问口感番茄的事，或上传图片聊聊…" value={text} maxLength={4000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth > 700) { e.preventDefault(); send(e); } }} disabled={busy} rows={2}/>
          <div className="composer-tools"><input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} tabIndex={-1}/><button type="button" className="upload" onClick={() => input.current.click()} disabled={busy || !!pending}><Icon name="upload"/>添加图片</button><span className="file-hint">每次 1 张 · 最大 8 MB</span><button type="submit" className="send" disabled={busy || !!pending || !session || (!text.trim() && !file)} aria-label="发送消息"><Icon name="arrow"/></button></div>
        </form>
        <p className="privacy"><Icon name="clock"/>两小时无交互后失效；有效期内可在此浏览器恢复。<span>图片判断仅供参考。</span></p>
      </div>
    </main>
    <footer>嗨番小智 · 嗨番集团</footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
