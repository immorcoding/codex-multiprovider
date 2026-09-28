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
  let respond = () => [{ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'routed reply' }] }];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const requestBody = body ? JSON.parse(body) : null;
    requests.push({ url: request.url, body: requestBody });
    if (request.method !== 'POST' || !request.url.endsWith('/responses')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const output = respond(requestBody);
    for (const event of [
      { type: 'response.created', response: { id: 'response-1', model: 'routed-model', output: [], status: 'in_progress' } },
      ...output.filter((item) => item.type === 'function_call').map((item) => ({ type: 'response.output_item.done', item })),
      { type: 'response.completed', response: { id: 'response-1', model: requestBody?.model ?? 'routed-model', output, status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const configure = ({ provider = 'mock_route', sameProvider = 'mock_route', explicitProvider = '', model = 'routed-model', mockOpenAiDefault = false } = {}) => writeFileSync(path.join(home, 'config.toml'), `
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
same-provider-model = "${sameProvider}"
other-provider-model = "openai"
`);
  configure();
  try {
    await run({ home, cwd, requests, configure, baseUrl, setResponder: (callback) => { respond = callback; } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const directory of [home, cwd]) {
      assert.ok(directory.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

function configureSubagentFixture(home, baseUrl, target) {
  writeFileSync(path.join(home, 'config.toml'), `
model = "gpt-5.5"
[features]
multi_agent_v2 = true
[model_providers.mock_route]
name = "Mock route"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = false
[model_provider_routes]
"gpt-5.5" = "mock_route"
"gpt-5.6-terra" = "${target}"
`);
}

function subagentResponse(body, waitForChild = false) {
  const toolOutputs = body.input?.filter((item) => item.type === 'function_call_output') ?? [];
  if (body.model === 'gpt-5.5' && toolOutputs.length === 0) {
    return [{ id: 'spawn-1', type: 'function_call', namespace: 'collaboration', name: 'spawn_agent', call_id: 'spawn-call', arguments: JSON.stringify({
      task_name: 'worker', message: 'Reply briefly.', model: 'gpt-5.6-terra', fork_turns: 'none',
    }), status: 'completed' }];
  }
  if (body.model === 'gpt-5.5' && waitForChild && !toolOutputs.some((item) => item.call_id === 'wait-call')) {
    return [{ id: 'wait-1', type: 'function_call', namespace: 'collaboration', name: 'wait_agent', call_id: 'wait-call', arguments: JSON.stringify({ timeout_ms: 15000 }), status: 'completed' }];
  }
  return [{ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }];
}

async function exec(binaryPath, home, cwd, args = ['exec', '--skip-git-repo-check', '--json', 'Reply briefly.']) {
  const child = spawn(binaryPath, args, {
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
  const notifications = [];
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
    } else if (message.method) {
      notifications.push(message);
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
    return await run(rpc, notifications);
  } finally {
    child.kill();
    await once(child, 'close');
    for (const { reject } of pending.values()) reject(Error(`app-server stopped: ${stderr.slice(-2000)}`));
  }
}

async function expectNotification(notifications, method) {
  const deadline = Date.now() + 15_000;
  while (!notifications.some((message) => message.method === method) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(notifications.some((message) => message.method === method), JSON.stringify(notifications));
}

async function expectRequest(requests, url, model) {
  const matches = (request) => request.url === url && request.body?.model === model;
  const deadline = Date.now() + 15_000;
  while (!requests.some(matches) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(requests.some(matches), JSON.stringify(requests));
}

test('app-server sends a selected mapped model to its provider and rejects an explicit conflict', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests }) => appServer(home, async (rpc) => {
    const common = { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true };
    const selected = await rpc('thread/start', { ...common, model: 'routed-model' });
    assert.equal(selected.modelProvider, 'mock_route');
    await rpc('turn/start', { threadId: selected.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
    await expectRequest(requests, '/v1/responses', 'routed-model');
    await assert.rejects(rpc('thread/start', { ...common, model: 'routed-model', modelProvider: 'openai' }), /routed-model.*mock_route.*openai/);
  }));
});

test('CLI subagent requests use the parent provider and reject a cross-provider model without substitution', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, baseUrl, setResponder }) => {
    // Keep the root turn alive until the child's request/notification has run. A CLI root can
    // otherwise finish and exit before its independently scheduled child sends HTTP.
    setResponder((body) => subagentResponse(body, true));
    configureSubagentFixture(home, baseUrl, 'mock_route');
    const same = await exec(binary, home, cwd, ['exec', '--skip-git-repo-check', '--json', 'Spawn worker.']);
    assert.equal(same.code, 0, `${same.stdout}\n${same.stderr}`);
    assert.ok(requests.some((request) => request.body?.model === 'gpt-5.6-terra' && request.url === '/v1/responses'), `${requests.map(({ url, body }) => `${url}: ${body?.model}`).join(', ')}\n${same.stdout}\n${same.stderr}`);

    requests.length = 0;
    configureSubagentFixture(home, baseUrl, 'openai');
    setResponder(subagentResponse);
    const cross = await exec(binary, home, cwd, ['exec', '--skip-git-repo-check', '--json', 'Spawn worker.']);
    assert.match(`${cross.stdout}\n${cross.stderr}`, /gpt-5\.6-terra.*openai.*mock_route/);
    assert.equal(requests.filter((request) => request.body?.model === 'gpt-5.6-terra').length, 0);
  });
});

test('app-server subagent tool calls preserve the parent provider and surface cross-provider rejection', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, baseUrl, setResponder }) => {
    setResponder(subagentResponse);
    const runTurn = (expectChild) => appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'gpt-5.5', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      assert.equal(started.modelProvider, 'mock_route');
      await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'Spawn worker.', text_elements: [] }] });
      if (expectChild) await expectRequest(requests, '/v1/responses', 'gpt-5.6-terra');
      await expectNotification(notifications, 'turn/completed');
    });
    configureSubagentFixture(home, baseUrl, 'mock_route');
    await runTurn(true);
    requests.length = 0;
    configureSubagentFixture(home, baseUrl, 'openai');
    await runTurn(false);
    assert.equal(requests.filter((request) => request.body?.model === 'gpt-5.6-terra').length, 0);
    assert.match(JSON.stringify(requests.map((request) => request.body?.input)), /gpt-5\.6-terra.*openai.*mock_route/);
  });
});

test('app-server sends the configured mapped model to its route and an unmapped model to the default provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ mockOpenAiDefault: true });
    await appServer(home, async (rpc) => {
      const common = { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true };
      const defaulted = await rpc('thread/start', common);
      assert.equal(defaulted.modelProvider, 'mock_route');
      await rpc('turn/start', { threadId: defaulted.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'routed-model');

      const unmapped = await rpc('thread/start', { ...common, model: 'unmapped-model' });
      assert.equal(unmapped.modelProvider, 'openai');
      await rpc('turn/start', { threadId: unmapped.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/default/responses', 'unmapped-model');
    });
  });
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

test('turn/start keeps the session provider while allowing a model on the same provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ mockOpenAiDefault: true });
    await appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('turn/start', { threadId: started.thread.id, model: 'same-provider-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'same-provider-model');
      await expectNotification(notifications, 'turn/completed');
      await assert.rejects(
        rpc('turn/start', { threadId: started.thread.id, model: 'other-provider-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] }),
        /other-provider-model.*openai.*mock_route/,
      );
      await assert.rejects(
        rpc('turn/start', { threadId: started.thread.id, model: 'unmapped-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] }),
        /unmapped-model.*openai.*mock_route/,
      );
      assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
    });
  });
});

test('thread/settings/update accepts same-provider model and rejects cross-provider model', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ mockOpenAiDefault: true });
    await appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('thread/settings/update', { threadId: started.thread.id, model: 'same-provider-model' });
      await expectNotification(notifications, 'thread/settings/updated');
      await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'same-provider-model');
      await expectNotification(notifications, 'turn/completed');
      await assert.rejects(
        rpc('thread/settings/update', { threadId: started.thread.id, model: 'other-provider-model' }),
        /other-provider-model.*openai.*mock_route/,
      );
      assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
    });
  });
});

test('an unmapped model update resolves to the configured default even after an explicit start', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ model: 'unmapped-model', mockOpenAiDefault: true });
    await appServer(home, async (rpc) => {
      const started = await rpc('thread/start', { cwd, model: 'unmapped-model', modelProvider: 'mock_route', approvalPolicy: 'never', sandbox: 'read-only' });
      await assert.rejects(
        rpc('turn/start', { threadId: started.thread.id, model: 'another-unmapped-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] }),
        /another-unmapped-model.*openai.*mock_route/,
      );
      assert.equal(requests.length, 0);
    });
  });
});

test('cold resume retains historical provider across changed defaults and rejects changed routing', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    const threadId = await appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'routed-model');
      await expectNotification(notifications, 'turn/completed');
      return started.thread.id;
    });
    configure({ model: 'other-provider-model', mockOpenAiDefault: true });
    await appServer(home, async (rpc) => {
      const resumed = await rpc('thread/resume', { threadId, modelProvider: 'mock_route' });
      assert.equal(resumed.modelProvider, 'mock_route');
      assert.equal(resumed.model, 'routed-model');
      await assert.rejects(
        rpc('turn/start', { threadId, model: 'unmapped-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] }),
        /unmapped-model.*openai.*mock_route/,
      );
    });
    await appServer(home, async (rpc, notifications) => {
      await assert.rejects(
        rpc('thread/resume', { threadId, model: 'other-provider-model' }),
        /other-provider-model.*openai.*mock_route/,
      );
      const resumed = await rpc('thread/resume', { threadId, model: 'same-provider-model' });
      assert.equal(resumed.modelProvider, 'mock_route');
      assert.equal(resumed.model, 'same-provider-model');
      await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'same-provider-model');
      await expectNotification(notifications, 'turn/completed');
      await assert.rejects(
        rpc('turn/start', { threadId, model: 'unmapped-model', input: [{ type: 'text', text: 'ping', text_elements: [] }] }),
        /unmapped-model.*openai.*mock_route/,
      );
    });
    configure({ sameProvider: 'openai', model: 'routed-model', mockOpenAiDefault: true });
    await appServer(home, async (rpc) => {
      await assert.rejects(rpc('thread/resume', { threadId }), /same-provider-model.*openai.*mock_route/);
    });
  });
});

test('resuming a loaded thread rejects a model routed away from its bound provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, configure, requests }) => {
    configure({ mockOpenAiDefault: true });
    await appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'routed-model');
      await expectNotification(notifications, 'turn/completed');
      await assert.rejects(
        rpc('thread/resume', { threadId: started.thread.id, model: 'other-provider-model' }),
        /other-provider-model.*openai.*mock_route/,
      );
      await assert.rejects(
        rpc('thread/resume', { threadId: started.thread.id, modelProvider: 'openai' }),
        /routed-model.*openai.*mock_route/,
      );
    });
  });
});

test('codex exec resume keeps the historical provider when the configured default changes', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    const started = await exec(binary, home, cwd);
    assert.equal(started.code, 0, `${started.stdout}\n${started.stderr}`);
    const event = started.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.type === 'thread.started');
    assert.ok(event?.thread_id, started.stdout);
    configure({ model: 'other-provider-model', mockOpenAiDefault: true });
    const resumed = await exec(binary, home, cwd, ['exec', 'resume', '--skip-git-repo-check', '--json', event.thread_id, 'Reply briefly.']);
    assert.equal(resumed.code, 0, `${resumed.stdout}\n${resumed.stderr}`);
    assert.equal(requests.filter((request) => request.url === '/v1/responses' && request.body?.model === 'routed-model').length, 2, JSON.stringify(requests));
    assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0, JSON.stringify(requests));
    const sameProvider = await exec(binary, home, cwd, ['exec', 'resume', '--skip-git-repo-check', '--json', '-m', 'same-provider-model', event.thread_id, 'Reply briefly.']);
    assert.equal(sameProvider.code, 0, `${sameProvider.stdout}\n${sameProvider.stderr}`);
    await expectRequest(requests, '/v1/responses', 'same-provider-model');
    const otherProvider = await exec(binary, home, cwd, ['exec', 'resume', '--skip-git-repo-check', '--json', '-m', 'other-provider-model', event.thread_id, 'Reply briefly.']);
    assert.notEqual(otherProvider.code, 0);
    assert.match(`${otherProvider.stdout}\n${otherProvider.stderr}`, /other-provider-model.*openai.*mock_route/);
    assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0, JSON.stringify(requests));
  });
});

test('app-server fork inherits the source provider across changed defaults and resumes on that provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    const sourceId = await appServer(home, async (rpc, notifications) => {
      const started = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectNotification(notifications, 'turn/completed');
      return started.thread.id;
    });
    configure({ model: 'other-provider-model', mockOpenAiDefault: true });
    const forkId = await appServer(home, async (rpc, notifications) => {
      const forked = await rpc('thread/fork', { threadId: sourceId });
      assert.equal(forked.modelProvider, 'mock_route');
      assert.equal(forked.model, 'routed-model');
      await rpc('turn/start', { threadId: forked.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectNotification(notifications, 'turn/completed');
      return forked.thread.id;
    });
    await appServer(home, async (rpc, notifications) => {
      const resumed = await rpc('thread/resume', { threadId: forkId });
      assert.equal(resumed.modelProvider, 'mock_route');
      await rpc('turn/start', { threadId: forkId, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectNotification(notifications, 'turn/completed');
    });
    assert.equal(requests.filter((request) => request.url === '/v1/responses' && request.body?.model === 'routed-model').length, 3);
    assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
  });
});

test('codex exec fork inherits the source provider instead of the changed CLI default', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    const started = await exec(binary, home, cwd);
    assert.equal(started.code, 0, `${started.stdout}\n${started.stderr}`);
    const sourceId = started.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.type === 'thread.started')?.thread_id;
    assert.ok(sourceId, started.stdout);
    configure({ model: 'other-provider-model', mockOpenAiDefault: true });
    const forked = await exec(binary, home, cwd, ['exec', 'fork', '--skip-git-repo-check', '--json', sourceId, 'Reply briefly.']);
    assert.equal(forked.code, 0, `${forked.stdout}\n${forked.stderr}`);
    const forkId = forked.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.type === 'thread.started')?.thread_id;
    assert.ok(forkId && forkId !== sourceId, forked.stdout);
    const resumed = await exec(binary, home, cwd, ['exec', 'resume', '--skip-git-repo-check', '--json', forkId, 'Reply briefly.']);
    assert.equal(resumed.code, 0, `${resumed.stdout}\n${resumed.stderr}`);
    assert.equal(requests.filter((request) => request.url === '/v1/responses' && request.body?.model === 'routed-model').length, 3);
    assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
  });
});

test('app-server fork accepts a same-provider model and rejects cross-provider selections', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ mockOpenAiDefault: true });
    await appServer(home, async (rpc, notifications) => {
      const source = await rpc('thread/start', { cwd, model: 'routed-model', approvalPolicy: 'never', sandbox: 'read-only' });
      await rpc('turn/start', { threadId: source.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectNotification(notifications, 'turn/completed');
      const sameProvider = await rpc('thread/fork', { threadId: source.thread.id, model: 'same-provider-model' });
      assert.equal(sameProvider.modelProvider, 'mock_route');
      assert.equal(sameProvider.model, 'same-provider-model');
      await rpc('turn/start', { threadId: sameProvider.thread.id, input: [{ type: 'text', text: 'ping', text_elements: [] }] });
      await expectRequest(requests, '/v1/responses', 'same-provider-model');
      await assert.rejects(rpc('thread/fork', { threadId: source.thread.id, model: 'other-provider-model' }), /other-provider-model.*openai.*mock_route/);
      await assert.rejects(rpc('thread/fork', { threadId: source.thread.id, modelProvider: 'openai' }), /routed-model.*mock_route.*openai/);
      assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
    });
  });
});

test('codex exec fork accepts a same-provider model and rejects a cross-provider model', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the built codex.exe');
  await fixture(async ({ home, cwd, requests, configure }) => {
    configure({ mockOpenAiDefault: true });
    const started = await exec(binary, home, cwd);
    assert.equal(started.code, 0, `${started.stdout}\n${started.stderr}`);
    const sourceId = started.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.type === 'thread.started')?.thread_id;
    assert.ok(sourceId, started.stdout);
    const sameProvider = await exec(binary, home, cwd, ['exec', 'fork', '--skip-git-repo-check', '--json', '-m', 'same-provider-model', sourceId, 'Reply briefly.']);
    assert.equal(sameProvider.code, 0, `${sameProvider.stdout}\n${sameProvider.stderr}`);
    await expectRequest(requests, '/v1/responses', 'same-provider-model');
    const crossProvider = await exec(binary, home, cwd, ['exec', 'fork', '--skip-git-repo-check', '--json', '-m', 'other-provider-model', sourceId, 'Reply briefly.']);
    assert.notEqual(crossProvider.code, 0);
    assert.match(`${crossProvider.stdout}\n${crossProvider.stderr}`, /other-provider-model.*openai.*mock_route/);
    assert.equal(requests.filter((request) => request.url === '/v1/default/responses').length, 0);
  });
});
