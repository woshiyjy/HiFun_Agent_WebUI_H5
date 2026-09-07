import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKnowledge } from '../server/knowledge.js';

const checkout = process.argv[2];
if (!checkout || !path.isAbsolute(checkout)) throw new Error('Provide an absolute path to a reviewed OSS_Docs checkout');
const target = fileURLToPath(new URL('../knowledge/', import.meta.url));
const stage = path.join(target, `stage-${Date.now()}`);
const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await mkdir(stage);
await cp(path.join(checkout, 'docs'), stage, { recursive: true, filter: async p => {
  const { lstat } = await import('node:fs/promises'); const stat = await lstat(p);
  return !stat.isSymbolicLink() && !path.relative(path.join(checkout, 'docs'), p).split(path.sep).some(x => x.startsWith('.')) && (stat.isDirectory() || p.endsWith('.md'));
} });
const docs = await loadKnowledge(stage);
if (!docs.length) throw new Error('No valid knowledge concepts');
const backup = path.join(target, `previous-${Date.now()}`);
await rename(path.join(target, 'source'), backup);
try { await rename(stage, path.join(target, 'source')); } catch (e) { await rename(backup, path.join(target, 'source')); throw e; }
await writeFile(path.join(target, 'snapshot.json'), JSON.stringify({ commit, syncedAt: new Date().toISOString(), concepts: docs.length, available: docs.filter(d => d.status === 'available').length }, null, 2));
console.log(`Synced ${docs.length} concepts at ${commit}; previous snapshot retained at ${backup}`);
