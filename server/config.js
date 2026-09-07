// Runtime configuration comes only from this project's .env (loaded by index.js)
// or explicitly supplied process environment. Never discover credentials in parent folders.
export async function loadConfig(env = process.env) {
  if (env.USE_CONTAINER_CREDENTIALS === 'true') throw new Error('Parent-directory credentials are retired; configure this project explicitly.');
  return { ...env };
}
