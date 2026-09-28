import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

const binary = process.env.CODEX_TEST_ROUTED_BINARY;

async function fixture(run) {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-mp-route-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'codex-mp-route-cwd-'));
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, body: body ? JSON.parse(body) : null });
    if (request.method !== 'POST' || !request.url.endsWith('/responses')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { id: 'response-1', model: 'routed-model', output: [], status: 'in_progress' } },
      { type: 'response.completed', response: { id: 'response-1', model: 'routed-model', output: [{ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'routed reply' }] }], status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const configure = ({ provider = 'mock_route', explicitProvider = '', model = 'routed-model', mockOpenAiDefault = false } = {}) => writeFileSync(path.join(home, 'config.toml'), `
model = "${model}"
${explicitProvider ? `model_provider = "${explicitProvider}"` : ''}
${mockOpenAiDefault ? `openai_base_url = "${baseUrl}/default"` : ''}
[model_providers.mock_route]
name = "Mock route"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = false
[model_provider_routes]
routed-model = "${provider}"
`);
  configure();
  try {
    await run({ home, cwd, requests, configure });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const directory of [home, cwd]) {
      assert.ok(directory.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

async function exec(binaryPath, home, cwd) {
  const child = spawn(binaryPath, ['exec', '--skip-git-repo-check', '--json', 'Reply briefly.'], {
    cwd, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: 'sk-test-only', CODEX_API_KEY: 'sk-test-only' }, windowsHide: true,
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 45_000);
  try {
    const [code] = await once(child, 'close');
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function appServer(home, run) {
  const child = spawn(binary, ['app-server'], { env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const pending = new Map();
  let nextId = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.id != null && message.method) {
      child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'unsupported' } })}\n`);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'model-routing-test', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    await run(rpc);
  } finally {
    child.kill();
    await once(child, 'close');
    for (const { reject } of pending.values()) reject(Error(`app-server stopped: ${stderr.slice(-2000)}`));
  }
}

test('app-server routes a selected model and the configured default, but leaves other models on OpenAI', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests }) => appServer(home, async (rpc) => {
    const common = { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true };
    const selected = await rpc('thread/start', { ...common, model: 'routed-model' });
    assert.equal(selected.modelProvider, 'mock_route');
    await rpc('turn/start', { threadId: selected.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
    const deadline = Date.now() + 15_000;
    while (!requests.some((request) => request.url === '/v1/responses' && request.body.model === 'routed-model') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(requests.some((request) => request.url === '/v1/responses' && request.body.model === 'routed-model'), JSON.stringify(requests));
    const defaulted = await rpc('thread/start', common);
    assert.equal(defaulted.modelProvider, 'mock_route');
    const unmapped = await rpc('thread/start', { ...common, model: 'gpt-5.5' });
    assert.equal(unmapped.modelProvider, 'openai');
    await assert.rejects(rpc('thread/start', { ...common, model: 'routed-model', modelProvider: 'openai' }), /routed-model.*mock_route.*openai/);
  }));
});

test('codex exec sends the routed model to the configured mock provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests }) => {
    const result = await exec(binary, home, cwd);
    assert.ok(requests.some((request) => request.url === '/v1/responses' && request.body.model === 'routed-model'), `${JSON.stringify(requests)}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test('codex exec keeps an unmapped model on the configured default provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ model: 'unmapped-model', mockOpenAiDefault: true });
    const result = await exec(binary, home, cwd);
    assert.ok(requests.some((request) => request.url === '/v1/default/responses' && request.body?.model === 'unmapped-model'), `${JSON.stringify(requests)}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test('an unknown route target and an explicitly conflicting provider fail clearly', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, configure }) => {
    configure({ provider: 'missing' });
    const missing = await exec(binary, home, cwd);
    assert.notEqual(missing.code, 0);
    assert.match(`${missing.stdout}\n${missing.stderr}`, /model_provider_routes\.routed-model.*missing/);
    configure({ explicitProvider: 'openai' });
    const conflict = await exec(binary, home, cwd);
    assert.notEqual(conflict.code, 0);
    assert.match(`${conflict.stdout}\n${conflict.stderr}`, /routed-model.*mock_route.*openai/);
  });
});
