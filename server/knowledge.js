import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const source = fileURLToPath(new URL('../knowledge/source/', import.meta.url));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stop = new Set(['的', '了', '是', '我', '你', '什么', '怎么', '如何', '一下', '请', '番茄', '口感']);
function terms(text) { for (const [from, to] of [['采摘','采收'],['降温','预冷'],['存放','贮藏'],['保存','贮藏'],['浇水','灌溉']]) if (text.includes(from)) text += ` ${to}`; return [...new Set([...segmenter.segment(text.toLowerCase())].filter(x => x.isWordLike && !stop.has(x.segment)).map(x => x.segment))]; }
export async function loadKnowledge(root = source) {
  const docs = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md') || ['index.md', 'log.md'].includes(entry.name)) continue;
      const raw = await readFile(file, 'utf8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`Missing knowledge frontmatter: ${entry.name}`);
      const meta = parse(match[1], { maxAliasCount: 0 });
      if (typeof meta?.type !== 'string' || !meta.type.trim()) throw new Error('Knowledge type is required');
      const relative = path.relative(root, file).split(path.sep).join('/');
      docs.push({ id: relative.slice(0, -3), title: String(meta.title || entry.name.slice(0, -3)), description: meta.description || '', type: meta.type, tags: meta.tags || [], date: String(meta.updated || meta.timestamp || ''), status: /内容正在建设中/.test(match[2]) ? 'placeholder' : 'available', body: match[2].trim(), url: `https://docs.wehifun.cn/${relative.slice(0, -3).split('/').map(encodeURIComponent).join('/')}.html` });
    }
  }
  await walk(root);
  return docs;
}
export function searchKnowledge(docs, query, limit = 3) {
  const words = terms(String(query).slice(0, 1000));
  if (!words.length) return [];
  return docs.map(doc => {
    const title = `${doc.title} ${doc.description} ${doc.tags.join(' ')}`.toLowerCase();
    const exact = String(query).includes(doc.title) && (doc.title.length >= String(query).length * 0.5 || /[0-9]/.test(doc.title)) ? 16 : 0;
    const score = exact + words.reduce((sum, word) => sum + (title.includes(word) ? 4 : 0) + (doc.status === 'available' && doc.body.includes(word) ? 1 : 0), 0);
    const sections = doc.body.split(/(?=^##? )/m).flatMap(s => s.match(/[\s\S]{1,1800}/g) || []);
    const excerpt = sections.map((body, index) => ({ body, index, score: words.filter(w => body.includes(w)).length })).sort((a,b) => b.score-a.score || a.index-b.index).slice(0,2).sort((a,b) => a.index-b.index).map(x => x.body).join('\n');
    return { ...doc, description: doc.status === 'placeholder' ? '' : doc.description, score, body: doc.status === 'placeholder' ? '该条目正文正在建设中，不能据其标题或简介推导业务结论。' : (doc.body.length <= 3600 ? doc.body : excerpt.slice(0, 3600)) };
  }).filter(d => d.score >= 4).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0, Math.min(5, Math.max(1, limit)));
}
export function readKnowledge(docs, id, { section = null, offset = 0, maxChars = 7200 } = {}) {
  const doc = docs.find(item => item.id === id);
  if (!doc) return null;
  const body = doc.body;
  const sections = body.split(/(?=^##? )/m).filter(Boolean);
  const selected = section ? sections.find(value => value.match(/^##?\s+(.+)$/m)?.[1]?.trim() === section || value.includes(section)) : null;
  const source = selected || body;
  const start = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const text = source.slice(start, start + Math.min(12000, Math.max(500, maxChars)));
  return { ...doc, body: doc.status === 'placeholder' ? '该条目正文正在建设中，不能据其标题或简介推导业务结论。' : text, section: selected ? section : null, offset: start, nextOffset: start + text.length < source.length ? start + text.length : null, totalChars: source.length };
}
export const knowledge = await loadKnowledge();

export function knowledgeEvidence(results) { return results.map(d => ({ 标题: d.title, 正文状态: d.status === "placeholder" ? "正在建设中" : "已提供正文，未独立核验", 资料标注日期: d.date, 原文链接: d.url, 参考正文: d.body })); }
