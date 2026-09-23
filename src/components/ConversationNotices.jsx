import React from 'react';

export function ConversationNotices({ paused, busy, onResume, error, storageError, pending, onRecover }) {
  return <>
    {paused && <button type="button" className="latest" onClick={onResume}>{busy ? '正在回答 · 回到最新 ↓' : '回到最新 ↓'}</button>}
    {error && <div className="error" role="alert">{error}</div>}
    {storageError && <div className="error" role="alert">浏览器未能保存对话。刷新或关闭后可能无法恢复。</div>}
    {pending && !busy && <button className="recover" onClick={onRecover}>恢复上一条回答</button>}
  </>;
}
