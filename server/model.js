import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { AppError } from './store.js';

function modelConfigError(message) {
  throw new AppError('MODEL_CONFIG', message, 503);
}

export function modelSettings(env = {}, mode = 'live') {
  const provider = String(env.MODEL_PROVIDER || (env.BAILIAN_MODEL || env.BAILIAN_API_KEY ? 'bailian' : 'deepseek')).trim().toLowerCase();
  if (!['deepseek', 'bailian'].includes(provider)) modelConfigError('模型服务商配置不受支持。');
  const isDeepSeek = provider === 'deepseek';
  const thinking = (isDeepSeek ? env.MODEL_ENABLE_THINKING : env.BAILIAN_ENABLE_THINKING) || (isDeepSeek ? 'true' : 'false');
  if (!['true', 'false'].includes(thinking)) throw new AppError('MODEL_CONFIG', '思考模式配置必须为 true 或 false。', 503);
  const maxTokens = isDeepSeek ? Number(env.MODEL_MAX_TOKENS || 32768) : 2048;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 32768) modelConfigError('模型输出上限配置不正确。');
  const reasoningEffort = String(env.MODEL_REASONING_EFFORT || 'high').trim().toLowerCase();
  if (isDeepSeek && !['low', 'high', 'max'].includes(reasoningEffort)) modelConfigError('DeepSeek 推理强度配置不正确。');
  return {
    thinking: thinking === 'true',
    model: isDeepSeek
      ? { id: mode === 'demo' ? 'local-demo' : env.MODEL_NAME || 'deepseek-flash', name: 'DeepSeek V4.1 Flash', api: 'openai-completions', provider, baseUrl: env.MODEL_BASE_URL || 'https://api.deepseek.com', apiKeyEnv: 'MODEL_API_KEY', reasoning: true, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_048_576, maxTokens, reasoningEffort, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true } }
      : { id: mode === 'demo' ? 'local-demo' : env.BAILIAN_MODEL || 'qwen3.7-plus', name: '嗨番Agent', api: 'openai-completions', provider, baseUrl: env.BAILIAN_BASE_URL || 'http://127.0.0.1', apiKeyEnv: 'BAILIAN_API_KEY', reasoning: true, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', thinkingFormat: 'qwen' } },
  };
}

export function modelStream(env, thinking) {
  return (model, context, options) => streamSimple(model, context, {
    ...options, apiKey: env[model.apiKeyEnv], maxTokens: model.maxTokens,
    // Provider-specific thinking fields are explicit; reasoning deltas remain separate
    // from user-visible text and are retained by pi-ai for DeepSeek tool round-trips.
    onPayload: payload => model.provider === 'deepseek'
      ? { ...payload, thinking: { type: thinking ? 'enabled' : 'disabled' }, reasoning_effort: thinking ? model.reasoningEffort : 'none' }
      : { ...payload, enable_thinking: thinking },
  });
}

export function isValidModelEndpoint(provider, baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    if (provider === 'deepseek') return url.hostname === 'api.deepseek.com' && ['', '/'].includes(url.pathname);
    if (provider === 'bailian') return /^https:\/\/[a-z0-9.-]+\.aliyuncs\.com\//.test(baseUrl);
    return false;
  } catch {
    return false;
  }
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
