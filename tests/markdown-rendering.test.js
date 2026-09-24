import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from '../src/components/AssistantMarkdown.js';

function render(text) {
  return renderToStaticMarkup(React.createElement(AssistantMarkdown, { text }));
}

test('Markdown保留标题、自然段、独立流程步骤和GFM表格结构', () => {
  const html = render([
    '## 采后流程',
    '',
    '这是流程前的说明。',
    '',
    '第一段补充说明。',
    '',
    '1. **采收计划**：按订单和库容制定计划。',
    '2. **田间采收**：及时遮阴并轻拿轻放。',
    '',
    '| 环节 | 要点 |',
    '| --- | --- |',
    '| 首次预冷 | 约 10℃ |',
  ].join('\n'));

  assert.match(html, /<h2>采后流程<\/h2>/);
  assert.match(html, /<p>这是流程前的说明。<\/p>\s*<p>第一段补充说明。<\/p>/);
  assert.match(html, /<ol>\s*<li><strong>采收计划<\/strong>：按订单和库容制定计划。<\/li>\s*<li><strong>田间采收<\/strong>：及时遮阴并轻拿轻放。<\/li>\s*<\/ol>/);
  assert.match(html, /<table>/);
});

test('代码围栏显示语言、复制按钮和转义后的代码内容', () => {
  const html = render('```js\nconst message = "<script>";\n```');

  assert.match(html, /class="message-code-language">js<\/span>/);
  assert.match(html, /aria-label="复制代码块"/);
  assert.match(html, /class="message-code-pre"><code class="language-js">const message = &quot;&lt;script&gt;&quot;;/);
  assert.doesNotMatch(html, /<script>/);
});

test('仅允许知识库来源域名作为链接，且不渲染原始HTML或图片', () => {
  const html = render([
    '[知识来源](https://docs.wehifun.cn/topic/source.html)',
    '',
    '[外部链接](https://example.com/)',
    '',
    '<img src="https://example.com/image.png" onerror="alert(1)">',
  ].join('\n'));

  assert.match(html, /<a href="https:\/\/docs\.wehifun\.cn\/topic\/source\.html" target="_blank" rel="noopener noreferrer">知识来源<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/example\.com\//);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img /);
});
