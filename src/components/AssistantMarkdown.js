import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const h = React.createElement;

function SourceLink({ href, children }) {
  try {
    const url = new URL(href);
    if (url.origin === 'https://docs.wehifun.cn' && !url.username && !url.password) {
      return h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, children);
    }
  } catch {}
  return h('span', null, children);
}

function codeText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  return React.isValidElement(node) ? codeText(node.props.children) : '';
}

function CodeBlock({ children }) {
  const [copyState, setCopyState] = useState('复制');
  const codeNode = React.Children.toArray(children).find(child => React.isValidElement(child) && child.type === 'code');
  const className = typeof codeNode?.props?.className === 'string' ? codeNode.props.className : '';
  const language = className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '';
  const text = codeText(codeNode?.props?.children ?? children);

  async function copyCode() {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(text);
      setCopyState('已复制');
    } catch {
      setCopyState('复制失败');
    }
    setTimeout(() => setCopyState('复制'), 1600);
  }

  return h('div', { className: 'message-code-block' },
    h('div', { className: 'message-code-header' },
      h('span', { className: 'message-code-language' }, language || '文本'),
      h('button', { type: 'button', className: 'message-code-copy', onClick: copyCode, 'aria-label': '复制代码块' }, copyState)),
    h('pre', { className: 'message-code-pre' }, codeNode || children));
}

export function AssistantMarkdown({ text = '' }) {
  return h('div', { className: 'message-text' }, h(Markdown, {
    remarkPlugins: [remarkGfm],
    components: { a: SourceLink, img: () => null, pre: CodeBlock },
    children: text,
  }));
}
