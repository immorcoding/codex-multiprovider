import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';
import { Codex } from '@openai/codex-sdk';
import { isolatedCliEnv } from './isolated-cli-env.mjs';

const binary = process.env.CODEX_TEST_ROUTED_BINARY;
const fakeKey = 'sdk-fixture-key-must-not-leak';
const configFile = new URL('../../config/zai-coding-plan.config-snippet.toml', import.meta.url);
const catalogFile = new URL('../../config/zai-models.json', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('../../config/engine-baseline.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(readFileSync(new URL('../../docs/engine-validation-0.159.json', import.meta.url), 'utf8'));

before(() => {
  const expectedVersion = baseline.publishedVersions['@openai/codex-sdk'];
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@openai/codex-sdk')), 'utf8'));
  assert.equal(manifest.dependencies['@openai/codex-sdk'], expectedVersion);
  assert.equal(lock.packages[''].dependencies['@openai/codex-sdk'], expectedVersion);
  assert.equal(lock.packages['node_modules/@openai/codex-sdk'].version, expectedVersion);
  assert.equal(installed.version, expectedVersion, 'Install the frozen public SDK before running acceptance');
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the verified 0.159.2 patched CLI');
  assert.equal(path.resolve(binary), path.resolve(evidence.binaryPath), 'Reuse the single verified engine binary');
  assert.equal(createHash('sha256').update(readFileSync(binary)).digest('hex'), evidence.binarySha256,
    'Patched CLI fingerprint differs from the #31 handoff; stop before starting a model turn');
  for (const patch of evidence.patches) {
    const bytes = readFileSync(new URL(`../../${patch.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), patch.sha256, `Patch fingerprint differs: ${patch.path}`);
  }
});

function message(text, id = 'mock-message') {
  return { id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
}

function responseEvents(text, id = 'mock-response') {
  const item = message(text, `${id}-item`);
  return [
    { type: 'response.created', response: { id, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', item: { ...item, content: [{ type: 'output_text', text: '' }] } },
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
}

function sendEvents(response, events) {
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

async function fixture(run) {
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the verified 0.159.2 patched CLI');
  const home = mkdtempSync(path.join(tmpdir(), 'codex-sdk-glm-home-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'codex-sdk-glm-cwd-'));
  const env = isolatedCliEnv(home, fakeKey);
  const requests = [];
  let reply = (_body, count) => ({ events: responseEvents(`GLM SDK reply ${count}`, `r${count}`) });
  let held = null;
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: request.url, authorization: request.headers.authorization, body });
    const result = reply(body, requests.length);
    response.writeHead(result.status ?? 200, { 'content-type': result.status ? 'application/json' : 'text/event-stream' });
    if (result.status) response.end(result.body ?? '{}');
    else {
      sendEvents(response, result.events);
      if (result.hold) held = response;
      else response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const catalogPath = path.join(home, 'models.json');
  writeFileSync(catalogPath, readFileSync(catalogFile));
  const config = readFileSync(configFile, 'utf8')
    .replace('https://api.z.ai/api/v1', baseUrl)
    .replace('wire_api = "responses"', 'wire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0')
    .replace('[model_providers.zai_coding_plan]', '[features]\nplugins = false\n[model_providers.zai_coding_plan]');
  writeFileSync(path.join(home, 'config.toml'), `model_catalog_json = ${JSON.stringify(catalogPath.replaceAll('\\', '\\\\'))}\n${config}`);
  const codex = new Codex({
    codexPathOverride: binary,
    env,
  });
  const options = { model: 'glm-5.3-flash', workingDirectory: cwd, skipGitRepoCheck: true, approvalPolicy: 'never', sandboxMode: 'read-only' };
  try {
    const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.ifError(version.error);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), evidence.version);
    await run({ codex, options, requests, setReply: (next) => { reply = next; }, finishHeld: (events = []) => {
      assert.ok(held, 'mock response must be held open');
      sendEvents(held, events);
      held.end();
      held = null;
    } });
  } finally {
    held?.end();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const dir of [home, cwd]) {
      assert.ok(dir.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

function assertRouted(requests, count) {
  assert.equal(requests.length, count);
  for (const request of requests) {
    assert.equal(request.url, '/api/v1/responses');
    assert.equal(request.authorization, `Bearer ${fakeKey}`);
    assert.equal(request.body.model, 'glm-5.3-flash');
  }
}

test('published SDK starts a GLM thread through the explicitly selected patched CLI and streams before completion', { timeout: 60_000 }, async () => {
  await fixture(async ({ codex, options, requests, setReply, finishHeld }) => {
    setReply(() => ({ hold: true, events: responseEvents('GLM SDK streamed').slice(0, 4) }));
    const thread = codex.startThread(options);
    const { events } = await thread.runStreamed('hello');
    const observed = [];
    for await (const event of events) {
      observed.push(event);
      if (event.type === 'item.completed' && event.item.type === 'agent_message' && event.item.text.includes('GLM SDK streamed')) {
        assert.ok(!observed.some((item) => item.type === 'turn.completed'));
        assert.ok(thread.id);
        assertRouted(requests, 1);
        finishHeld(responseEvents('GLM SDK streamed').slice(4));
      }
    }
    assert.ok(observed.some((event) => event.type === 'item.completed' && event.item.text?.includes('GLM SDK streamed')));
    assert.ok(observed.some((event) => event.type === 'turn.completed'));
  });
});

test('published SDK resumes the same routed thread and returns the second answer', { timeout: 60_000 }, async () => {
  await fixture(async ({ codex, options, requests }) => {
    const original = codex.startThread(options);
    assert.equal((await original.run('first')).finalResponse, 'GLM SDK reply 1');
    assert.ok(original.id);
    const resumed = codex.resumeThread(original.id, options);
    assert.equal((await resumed.run('second')).finalResponse, 'GLM SDK reply 2');
    assert.equal(resumed.id, original.id);
    assertRouted(requests, 2);
  });
});

test('published SDK exposes a provider error without leaking the fake credential', { timeout: 60_000 }, async () => {
  await fixture(async ({ codex, options, requests, setReply }) => {
    setReply(() => ({ status: 401, body: '{"error":{"message":"mock unauthorized"}}' }));
    const thread = codex.startThread(options);
    await assert.rejects(thread.run('fail'), (error) => {
      assert.match(error.message, /401|unauthorized/i);
      assert.doesNotMatch(error.message, new RegExp(fakeKey));
      return true;
    });
    assertRouted(requests, 1);
  });
});

test('published SDK aborts a pending GLM stream without reporting a successful turn', { timeout: 60_000 }, async () => {
  await fixture(async ({ codex, options, requests, setReply }) => {
    setReply(() => ({ hold: true, events: responseEvents('waiting').slice(0, 4) }));
    const controller = new AbortController();
    const thread = codex.startThread(options);
    const { events } = await thread.runStreamed('cancel', { signal: controller.signal });
    const observed = [];
    await assert.rejects(async () => {
      for await (const event of events) {
        observed.push(event);
        if (event.type === 'item.completed') controller.abort();
      }
    }, /abort|signal|cancel/i);
    assert.ok(!observed.some((event) => event.type === 'turn.completed'));
    assertRouted(requests, 1);
  });
});
