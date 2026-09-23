import React from 'react';

export function WelcomePanel({ onSuggestion }) {
  const suggestions = ['你能帮我做什么？', '帮我看看这张番茄图片里有什么？', '帮我查查高俪红的品种特点和种植注意事项。'];
  return <section className="welcome">
    <img className="welcome-mascot" src="/hifun-agent-avatar.png" alt="嗨番Agent头像"/>
    <span className="eyebrow">你好，我是嗨番Agent</span>
    <h1>关于口感番茄，<br/>我们一起聊聊。</h1>
    <p>可以问种植与产业知识，也可以上传图片，<br className="desktop-break"/>一起梳理问题、补充情况，继续追问。</p>
    <div className="suggestions">{suggestions.map(question => <button type="button" key={question} onClick={() => onSuggestion(question)}>{question}<span>↗</span></button>)}</div>
    <p className="company-intro">嗨番集团是一家专注于口感番茄的产业运营商。</p>
  </section>;
}
