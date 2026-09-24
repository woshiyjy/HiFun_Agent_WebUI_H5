import { randomUUID } from 'node:crypto';
import { AppError } from './store.js';

export const DEFAULT_TOKEN_LIMIT = 10_000_000;
export const quotaError = () => new AppError('SESSION_QUOTA', '本次会话的可用额度不足，暂时无法继续回答。停止交互两小时、会话过期后，额度会重置。', 429);

// Pi usage includes cached input in totalTokens. Never count cost or capsule usage.
export function reportedTokens(message) {
  const n = message?.usage?.totalTokens;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function meteredStream(stream, quota, onError = () => {}) {
  return (model, context, options) => {
    let source;
    return {
      async *[Symbol.asyncIterator]() {
        // Conservative preflight, refunded using provider usage. Text bytes and encoded
        // images deliberately overestimate normal tokenization; include protocol overhead.
        const reserve = Buffer.byteLength(JSON.stringify(context), 'utf8') + 4096 + model.maxTokens;
        const id = randomUUID();
        try {
          await quota.reserve(id, reserve);
          source = await stream(model, context, options);
          for await (const event of source) {
            if (event.type === 'done' || event.type === 'error') {
              await quota.settle(id, reportedTokens(event.message || event.error));
            }
            yield event;
          }
        } catch (error) { onError(error); throw error; }
        // No terminal usage (disconnect/crash): keep the durable reservation.
      },
      result() { return source.result(); },
    };
  };
}
