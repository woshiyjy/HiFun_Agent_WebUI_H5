import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { AppError } from './store.js';

export function modelSettings(env = {}, mode = 'live') {
  const thinking = env.BAILIAN_ENABLE_THINKING || 'false';
  if (!['true', 'false'].includes(thinking)) throw new AppError('MODEL_CONFIG', '思考模式配置必须为 true 或 false。', 503);
  return {
    thinking: thinking === 'true',
    model: { id: mode === 'demo' ? 'local-demo' : env.BAILIAN_MODEL || 'qwen3.7-plus', name: '嗨番小智', api: 'openai-completions', provider: 'bailian', baseUrl: env.BAILIAN_BASE_URL || 'http://127.0.0.1', reasoning: true, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 2048, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', thinkingFormat: 'qwen' } },
  };
}

export function modelStream(env, thinking) {
  return (model, context, options) => streamSimple(model, context, {
    ...options, apiKey: env.BAILIAN_API_KEY, maxTokens: 2048,
    // Explicit wire setting; model.reasoning describes capability, not this request's mode.
    onPayload: payload => ({ ...payload, enable_thinking: thinking }),
  });
}

// Strip model-authored URLs even when the protocol splits their prefix across chunks.
// Source links are appended separately from server-verified tool results.
export function streamTextFilter(write) {
  let pending = '', skipping = false;
  const prefixes = ['https://', 'http://', 'www.'];
  function drain(final) {
    let out = '';
    while (pending) {
      if (skipping) {
        if (!/[\s)<>]/.test(pending[0])) { pending = pending.slice(1); continue; }
        skipping = false;
      }
      const lower = pending.toLowerCase();
      const prefix = prefixes.find(p => lower.startsWith(p));
      if (prefix) { pending = pending.slice(prefix.length); skipping = true; continue; }
      if (!final && prefixes.some(p => p.startsWith(lower))) break;
      out += pending[0]; pending = pending.slice(1);
    }
    if (out) write(out);
  }
  return { push(text) { pending += text; drain(false); }, end() { drain(true); } };
}
