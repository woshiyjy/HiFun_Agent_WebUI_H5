import React, { useLayoutEffect, useRef } from 'react';
import { ArrowUp, ImagePlus, X } from 'lucide-react';

export function Composer({ input, file, preview, text, busy, pending, session, onTextChange, onFileChange, onRemoveFile, onSubmit }) {
  const composing = useRef(false);
  const textarea = useRef(null);
  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [text]);
  function keyDown(event) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && window.innerWidth > 700) {
      event.preventDefault();
      if (!event.repeat) event.currentTarget.form.requestSubmit();
    }
  }
  return <form className="composer" onSubmit={onSubmit}>
    {file && <div className="attachment">{preview && <img src={preview} alt="待上传图片预览"/>}<span>{file.name}</span><button type="button" onClick={onRemoveFile} aria-label="移除待上传图片"><X size={18}/></button></div>}
    <label className="sr-only" htmlFor="question">向嗨番Agent提问</label>
    <textarea ref={textarea} id="question" placeholder="问问口感番茄的事，或上传图片聊聊…" value={text} maxLength={4000} onChange={onTextChange} onKeyDown={keyDown} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }} disabled={busy} rows={1}/>
    <div className="composer-tools"><input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} tabIndex={-1}/><button type="button" className="upload" onClick={() => input.current?.click()} disabled={busy || !!pending}><ImagePlus size={16}/><span>添加图片</span></button><span className="file-hint">JPG、PNG 或 WebP · 8 MB 内</span><button type="submit" className="send" disabled={busy || !!pending || !session || (!text.trim() && !file)} aria-label="发送消息" title="发送消息"><ArrowUp size={16}/></button></div>
  </form>;
}
