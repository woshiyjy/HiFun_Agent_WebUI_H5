import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';

function SourceLink({ href, children }) {
  try {
    const url = new URL(href);
    if (url.origin === 'https://docs.wehifun.cn' && !url.username && !url.password) return <a href={url.href} target="_blank" rel="noopener noreferrer">{children}</a>;
  } catch {}
  return <span>{children}</span>;
}

function TextPart() {
  const part = useAuiState(state => state.part);
  const components = { a: SourceLink, img: () => null };
  return part.type === 'text' ? <div className="message-text"><Markdown remarkPlugins={[remarkGfm]} components={components}>{part.text}</Markdown></div> : null;
}

function ImagePart() {
  const part = useAuiState(state => state.part);
  return part.type === 'image' ? <><img className="message-image" src={part.image} alt="本次上传的图片" onError={event => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false; }} /><p hidden className="expired-image">图片已不可用，需要重新查看时请补传。</p></> : null;
}

function MessageRow() {
  const role = useAuiState(state => state.message.role);
  const user = role === 'user';
  return <MessagePrimitive.Root className={`message flex w-full items-start gap-3 ${role}`}>
    <div className={`message-avatar${user ? ' user-avatar' : ''}`} aria-hidden="true">{user ? <span>你</span> : <img src="/xiaozhi-user.png" alt=""/>}</div>
    <div className="message-body">{!user && <div className="message-label">嗨番小智</div>}<MessagePrimitive.Parts components={{ Text: TextPart, Image: ImagePart }} /></div>
  </MessagePrimitive.Root>;
}

export function MessageThread() {
  return <ThreadPrimitive.Root className="aui-thread flex w-full flex-col"><div className="aui-thread-viewport flex flex-col gap-5"><ThreadPrimitive.Messages>{() => <MessageRow />}</ThreadPrimitive.Messages></div></ThreadPrimitive.Root>;
}
