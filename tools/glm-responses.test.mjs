import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

const binary = process.env.CODEX_TEST_ROUTED_BINARY;
const fixtureConfig = new URL('../config/zai-coding-plan.config-snippet.toml', import.meta.url);
const fixtureModels = new URL('../config/zai-models.json', import.meta.url);
const fakeKey = 'fixture-key-must-not-appear-in-diagnostics';

async function fixture(run) {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-glm-home-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'codex-glm-cwd-'));
  const requests = [];
  let heldResponse = null;
  let reply = () => ({ events: [
    { type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', item: { id: 'message-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] } },
    { type: 'response.output_text.delta', delta: 'GLM mock reply' },
    { type: 'response.output_item.done', item: { id: 'message-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'GLM mock reply' }] } },
    { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [
      { id: 'message-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'GLM mock reply' }] },
    ], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ] });
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    const result = reply(body, requests.length);
    response.writeHead(result.status ?? 200, { 'content-type': result.status ? 'application/json' : 'text/event-stream' });
    if (result.status) response.end(result.body ?? '{}');
    else {
      for (const event of result.events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (result.hold) heldResponse = response;
      else response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const modelsPath = path.join(home, 'models.json');
  writeFileSync(modelsPath, readFileSync(fixtureModels));
  const config = readFileSync(fixtureConfig, 'utf8')
    .replace('https://api.z.ai/api/v1', baseUrl)
    .replace('wire_api = "responses"', 'wire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0');
  writeFileSync(path.join(home, 'config.toml'), `model_catalog_json = ${JSON.stringify(modelsPath.replaceAll('\\', '\\\\'))}\n${config}`);
  try {
    await run({
      home, cwd, requests, baseUrl,
      setReply: (callback) => { reply = callback; },
      finishHeld: (events) => {
        assert.ok(heldResponse, 'expected an open streaming response');
        for (const event of events) heldResponse.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        heldResponse.end();
        heldResponse = null;
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const dir of [home, cwd]) {
      assert.ok(dir.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

async function appServer(home, run) {
  const child = spawn(binary, ['app-server'], {
    env: { ...process.env, CODEX_HOME: home, ZAI_CODING_PLAN_API_KEY: fakeKey },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
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
    } else if (message.method) notifications.push(message);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'glm-mock-test', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    return await run(rpc, notifications, () => stderr);
  } finally {
    child.kill();
    await once(child, 'close');
    for (const { reject } of pending.values()) reject(Error('app-server stopped'));
  }
}

async function exec(home, cwd, prompt) {
  const child = spawn(binary, ['exec', '--skip-git-repo-check', '--json', prompt], {
    cwd, env: { ...process.env, CODEX_HOME: home, ZAI_CODING_PLAN_API_KEY: fakeKey }, windowsHide: true,
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [code] = await once(child, 'close');
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function completed(notifications, count = 1, diagnostics = () => '') {
  const deadline = Date.now() + 20_000;
  while (notifications.filter((n) => n.method === 'turn/completed').length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const events = notifications.filter((n) => n.method === 'turn/completed');
  assert.equal(events.length, count, `${JSON.stringify(notifications.map(({ method, params }) => ({ method, status: params?.turn?.status })))}\nstderr: ${diagnostics().slice(0, 1000)}`);
  return events.at(-1);
}

function stream(id, output) {
  return { events: [
    { type: 'response.created', response: { id, status: 'in_progress', output: [] } },
    ...output.map((item) => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed', response: { id, status: 'completed', output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ] };
}

function message(id, text) {
  return { id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
}

test('Coding Plan GLM route streams text directly at the preserved /api/v1/responses path', { timeout: 60_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
  await fixture(async ({ home, cwd, requests, setReply, finishHeld }) => {
    setReply(() => ({ hold: true, events: [
      { type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', item: { id: 'message-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] } },
      { type: 'response.output_text.delta', delta: 'GLM mock reply' },
    ] }));
    await appServer(home, async (rpc, notifications, stderr) => {
      const start = await rpc('thread/start', { cwd, model: 'glm-5.3-flash', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      assert.equal(start.modelProvider, 'zai_coding_plan');
      await rpc('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'hello', text_elements: [] }] });
      const deadline = Date.now() + 15_000;
      while (!notifications.some((n) => n.method === 'item/agentMessage/delta') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(notifications.some((n) => n.method === 'item/agentMessage/delta' && JSON.stringify(n.params).includes('GLM mock reply')));
      assert.ok(!notifications.some((n) => n.method === 'turn/completed'), 'text must stream before the terminal event');
      finishHeld([
        { type: 'response.output_item.done', item: message('message-1', 'GLM mock reply') },
        { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [message('message-1', 'GLM mock reply')], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]);
      const done = await completed(notifications, 1, stderr);
      assert.equal(done.params.turn.status, 'completed');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/api/v1/responses');
      assert.equal(requests[0].body.model, 'glm-5.3-flash');
      assert.equal(requests[0].body.reasoning?.effort, 'max');
      assert.equal(requests[0].authorization, `Bearer ${fakeKey}`);
      assert.match(JSON.stringify(notifications), /GLM mock reply/);
      assert.doesNotMatch(stderr(), new RegExp(fakeKey));
    });
  });
});

test('GLM catalog exposes only low/high/max and each selected effort reaches Responses', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
  await fixture(async ({ home, cwd, requests }) => appServer(home, async (rpc, notifications) => {
    const models = await rpc('model/list', { includeHidden: false, cursor: null, limit: 100 });
    const glm = models.data.find((item) => item.model === 'glm-5.3-flash');
    assert.deepEqual(glm.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort), ['low', 'high', 'max']);
    assert.equal(glm.defaultReasoningEffort, 'max');
    for (const [index, effort] of ['low', 'high', 'max'].entries()) {
      const start = await rpc('thread/start', { cwd, model: 'glm-5.3-flash', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      assert.equal(start.modelProvider, 'zai_coding_plan');
      await rpc('turn/start', { threadId: start.thread.id, effort, input: [{ type: 'text', text: `effort ${effort}`, text_elements: [] }] });
      const deadline = Date.now() + 15_000;
      while (requests.length < index + 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(requests.at(-1)?.body.reasoning?.effort, effort);
      await completed(notifications, index + 1);
    }
  }));
});

test('codex exec uses the Coding Plan GLM route without a compatibility proxy', { timeout: 60_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
  await fixture(async ({ home, cwd, requests }) => {
    const result = await exec(home, cwd, 'Reply briefly.');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/v1/responses');
    assert.equal(requests[0].body.model, 'glm-5.3-flash');
    assert.match(result.stdout, /GLM mock reply/);
    assert.doesNotMatch(result.stderr, new RegExp(fakeKey));
  });
});

test('GLM function call closes on the same call_id, then a second conversation turn retains the provider', { timeout: 90_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
  await fixture(async ({ home, cwd, requests, setReply }) => {
    setReply((body, requestNumber) => {
      if (requestNumber === 1) return stream('tool-response', [{
        id: 'tool-1', type: 'function_call', name: 'exec_command', call_id: 'glm-call-1',
        arguments: JSON.stringify({ cmd: 'echo GLM_TOOL_OK' }), status: 'completed',
      }]);
      if (requestNumber === 2) return stream('tool-followup', [message('message-2', 'Tool complete')]);
      return stream('second-turn', [message('message-3', 'Second turn complete')]);
    });
    await appServer(home, async (rpc, notifications) => {
      const start = await rpc('thread/start', { cwd, model: 'glm-5.3-flash', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      await rpc('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'Run the echo tool.', text_elements: [] }] });
      assert.equal((await completed(notifications)).params.turn.status, 'completed');
      assert.equal(requests.length, 2);
      assert.equal(requests[1].url, '/api/v1/responses');
      const toolOutput = requests[1].body.input.find((item) => item.type === 'function_call_output' && item.call_id === 'glm-call-1');
      assert.ok(toolOutput, 'tool result must be sent with the model-issued call_id');
      assert.match(JSON.stringify(toolOutput.output), /GLM_TOOL_OK/);
      await rpc('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'One more question.', text_elements: [] }] });
      assert.equal((await completed(notifications, 2)).params.turn.status, 'completed');
      assert.equal(requests.length, 3);
      assert.equal(requests[2].body.model, 'glm-5.3-flash');
      assert.equal(requests[2].url, '/api/v1/responses');
      assert.match(JSON.stringify(requests[2].body.input), /One more question/);
      assert.match(JSON.stringify(requests[2].body.input), /glm-call-1/);
      assert.match(JSON.stringify(notifications), /Second turn complete/);
    });
  });
});

test('GLM streaming turn can be cancelled without leaking a partial conversation', { timeout: 60_000 }, async () => {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
  await fixture(async ({ home, cwd, requests, setReply }) => {
    setReply(() => ({ hold: true, events: [{ type: 'response.created', response: { id: 'slow' } }] }));
    await appServer(home, async (rpc, notifications, stderr) => {
      const start = await rpc('thread/start', { cwd, model: 'glm-5.3-flash', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      const turn = await rpc('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'private full conversation marker', text_elements: [] }] });
      const deadline = Date.now() + 15_000;
      while (requests.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(requests[0]?.url, '/api/v1/responses');
      await rpc('turn/interrupt', { threadId: start.thread.id, turnId: turn.turn.id });
      const done = await completed(notifications, 1, stderr);
      assert.equal(done.params.turn.status, 'interrupted');
      assert.doesNotMatch(stderr(), new RegExp(fakeKey));
      assert.doesNotMatch(stderr(), /private full conversation marker/);
    });
  });
});

for (const [caseName, response, diagnostic] of [
  ['missing response.completed', { events: [{ type: 'response.created', response: { id: 'incomplete' } }] }, /stream closed before response\.completed/i],
  ['field rejected (400)', { status: 400, body: '{"error":{"message":"reasoning field rejected"}}' }, /reasoning field rejected/i],
  ['unauthorized (401)', { status: 401, body: '{"error":{"message":"unauthorized"}}' }, /401[\s\S]*unauthorized/i],
  ['forbidden (403)', { status: 403, body: '{"error":{"message":"forbidden"}}' }, /403[\s\S]*forbidden/i],
  ['rate limited (429)', { status: 429, body: '{"error":{"message":"rate limited"}}' }, /429 Too Many Requests/i],
  ['upstream unavailable (503)', { status: 503, body: '{"error":{"message":"unavailable"}}' }, /503[\s\S]*unavailable/i],
]) {
  test(`GLM direct Responses reports ${caseName} without leaking credentials`, { timeout: 60_000 }, async () => {
    assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the patched CLI');
    await fixture(async ({ home, cwd, requests, setReply }) => {
      setReply(() => response);
      await appServer(home, async (rpc, notifications, stderr) => {
        const start = await rpc('thread/start', { cwd, model: 'glm-5.3-flash', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
        const effort = caseName.startsWith('field rejected') ? 'medium' : undefined;
        await rpc('turn/start', { threadId: start.thread.id, effort, input: [{ type: 'text', text: 'private full conversation marker', text_elements: [] }] });
        const done = await completed(notifications, 1, stderr);
        assert.equal(done.params.turn.status, 'failed');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, '/api/v1/responses');
        if (effort) assert.equal(requests[0].body.reasoning?.effort, 'medium');
        const error = JSON.stringify(done.params.turn.error);
        const visible = `${JSON.stringify(notifications.filter((n) => n.method !== 'item/started' && n.method !== 'item/completed'))}\n${stderr()}`;
        assert.match(error, diagnostic);
        assert.doesNotMatch(visible, new RegExp(fakeKey));
        assert.doesNotMatch(stderr(), /private full conversation marker/);
      });
    });
  });
}
