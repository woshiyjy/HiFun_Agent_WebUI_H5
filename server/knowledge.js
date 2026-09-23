import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const source = fileURLToPath(new URL('../knowledge/source/', import.meta.url));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stop = new Set(['的', '了', '是', '我', '你', '什么', '怎么', '如何', '一下', '请', '请问', '有', '吗', '哪些', '以及', '相关', '大致', '番茄', '小番茄', '口感']);
const defaultSearchLimit = 12;
const maxSearchLimit = 12;
const maxExcerptChars = 900;

function terms(text) {
  const normalized = String(text).toLowerCase();
  const expanded = normalized
    .replaceAll('采摘', '采收')
    .replaceAll('降温', '预冷')
    .replaceAll('存放', '贮藏')
    .replaceAll('保存', '贮藏')
    .replaceAll('浇水', '灌溉');
  return [...new Set([...segmenter.segment(expanded)].filter(x => x.isWordLike && !stop.has(x.segment)).map(x => x.segment))];
}

function expandedTerms(query) {
  const text = String(query).toLowerCase();
  const result = new Set();
  if (/采后|采收后/u.test(text) && /流程|步骤|环节|处理/u.test(text)) {
    for (const term of ['采收计划', '田间采收', '到货验收', '分选', '清洗', '预冷', '贮藏', '包装', '成品入库', '装车', '运输']) result.add(term);
  }
  if (/预清洗|预洗/u.test(text)) result.add('清洗');
  if (/清洗/u.test(text) && /消毒|杀菌|微生物/u.test(text)) result.add('微生物控制');
  if (/冷链/u.test(text)) for (const term of ['预冷', '贮藏', '运输']) result.add(term);
  if (/采摘/u.test(text)) result.add('采收');
  return [...result];
}

function excerptFor(doc, queryTerms, extraTerms, maxChars = maxExcerptChars) {
  if (doc.body.length <= maxChars) return doc.body;
  const sections = doc.body.split(/(?=^#{1,4}\s)/m).filter(Boolean);
  const ranked = sections.map((body, index) => {
    const lower = body.toLowerCase();
    const score = queryTerms.reduce((sum, term) => sum + (lower.includes(term) ? 3 : 0), 0)
      + extraTerms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    return { body, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.filter(section => section.score > 0).slice(0, 2);
  if (!selected.length) selected.push(ranked[0] || { body: doc.body, index: 0 });
  selected.sort((a, b) => a.index - b.index);
  const budget = selected.length > 1 ? Math.floor(maxChars / selected.length) : maxChars;
  return selected.map(({ body }) => {
    const trimmed = body.trim();
    if (trimmed.length <= budget) return trimmed;
    const heading = trimmed.match(/^#{1,4}\s[^\n]+/)?.[0] || '';
    const start = heading ? heading.length : 0;
    const room = Math.max(0, budget - heading.length - 2);
    return `${heading}${heading ? '\n' : ''}${trimmed.slice(start, start + room).trimEnd()}…`;
  }).join('\n[…]\n').slice(0, maxChars);
}
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
export function searchKnowledge(docs, query, limit = defaultSearchLimit) {
  const normalizedQuery = String(query).slice(0, 1000).toLowerCase();
  const words = terms(normalizedQuery);
  if (!words.length) return [];
  const extra = expandedTerms(normalizedQuery).filter(term => !words.includes(term));
  const safeLimit = Number.isInteger(limit) ? Math.min(maxSearchLimit, Math.max(1, limit)) : defaultSearchLimit;
  return docs.map(doc => {
    const title = String(doc.title).toLowerCase();
    const description = String(doc.description || '').toLowerCase();
    const tags = (doc.tags || []).join(' ').toLowerCase();
    const body = doc.status === 'available' ? doc.body.toLowerCase() : '';
    const exactTitle = title.length >= 2 && normalizedQuery.includes(title);
    let score = exactTitle ? 36 : 0;
    const titleMatches = words.filter(word => title.includes(word)).length;
    score += Math.max(0, titleMatches - 1) * 6;
    let metadataMatches = 0;
    let bodyMatches = 0;
    for (const word of words) {
      if (title.includes(word)) { score += 8; metadataMatches++; }
      else if (tags.includes(word)) { score += 6; metadataMatches++; }
      else if (description.includes(word)) { score += 4; metadataMatches++; }
      if (body.includes(word)) { score += 1.5; bodyMatches++; }
    }
    for (const word of extra) {
      if (title.includes(word)) score += 3;
      else if (tags.includes(word)) score += 2.5;
      else if (description.includes(word)) score += 1.5;
      else if (body.includes(word)) score += 0.5;
    }
    const excerpt = doc.status === 'placeholder' ? '' : excerptFor(doc, words, extra);
    return {
      ...doc,
      description: doc.status === 'placeholder' ? '' : doc.description,
      score,
      body: doc.status === 'placeholder' ? '该条目正文正在建设中，不能据其标题或简介推导业务结论。' : excerpt,
      metadataMatches,
      bodyMatches,
    };
  })
    .filter(doc => doc.score >= 2 && (doc.metadataMatches > 0 || doc.bodyMatches > 1 || doc.score >= 36))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, safeLimit)
    .map(({ metadataMatches, bodyMatches, ...doc }) => doc);
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

export function knowledgeEvidence(results) { return results.map(d => ({ 标题: d.title, 资料类型: d.type, 简介: d.description, 正文状态: d.status === "placeholder" ? "正在建设中" : "已提供正文，未独立核验", 资料标注日期: d.date, 原文链接: d.url, 参考正文: d.body })); }
