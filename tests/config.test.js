import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../server/config.js';
test('独立项目只接受显式配置，拒绝旧父目录凭据发现', async()=>{
 assert.deepEqual(await loadConfig({APP_MODE:'demo'}),{APP_MODE:'demo'});
 await assert.rejects(loadConfig({USE_CONTAINER_CREDENTIALS:'true'}),/Parent-directory/);
});
