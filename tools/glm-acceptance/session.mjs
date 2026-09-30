import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockKey, startMockProvider } from './mock-provider.mjs';
import { isolatedProcessEnv } from '../isolated-process-env.mjs';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const profiles = JSON.parse(readFileSync(path.join(repository, 'config/glm-acceptance-profiles.json'), 'utf8'));

/** @param {string} home @param {string | undefined} [keyEnv] @returns {Record<string, string>} */
export function childEnvironment(home, keyEnv) {
  const env = isolatedProcessEnv(home);
  // The real service key stays in the coordinator, never in a model-driven process.
  if (keyEnv) env[keyEnv] = 'local-acceptance-relay-key';
  return env;
}

async function terminateChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') { child.kill(); return; }
  // Only the process we spawned and its descendants, never a name-wide kill.
  await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3000);
    const finished = () => { clearTimeout(timer); child.kill(); resolve(); };
    killer.once('close', finished);
    killer.once('error', finished);
  });
}

export async function runProcess(command, args, { env, cwd = repository, timeoutMs = 120_000 } = {}) {
  const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  // Do not persist stderr: provider errors may contain credentials or private text.
  child.stderr.resume();
  let failure;
  const stop = code => { failure ??= code; void terminateChild(child); };
  const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
  const interrupted = () => stop('INTERRUPTED');
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  child.stdout.on('data', bytes => {
    stdout += bytes;
    if (stdout.length > 2 * 1024 * 1024) stop('OUTPUT_LIMIT');
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', () => reject(Error('PROCESS_START_FAILED')));
      child.once('close', resolve);
    });
    if (failure || code !== 0) throw Error(failure ?? 'PROBE_FAILED');
    return stdout;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await terminateChild(child);
  }
}

export async function createSession(options, report) {
  const work = path.join(repository, 'work');
  mkdirSync(work, { recursive: true });
  const directory = mkdtempSync(path.join(work, 'glm-acceptance-' + options.profile + '-'));
  const home = path.join(directory, 'home');
  const workspace = path.join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const mock = options.mode === 'live' ? null : await startMockProvider(options.scenario);
  const upstream = mock?.baseUrl ?? options.baseUrl;
  const key = mock ? mockKey : process.env[profiles[options.profile].keyEnv];
  const controllers = new Set();
  let currentCase;
  function inspectFunction(evidence, item) {
    if (item?.type !== 'function_call') return;
    if (!item.call_id || !item.id) throw Error('TOOL_BINDING_FAILED');
    const previous = evidence.functions.get(item.id);
    if (previous && previous !== item.call_id) throw Error('TOOL_BINDING_FAILED');
    evidence.functions.set(item.id, item.call_id);
  }
  const server = http.createServer(async (request, response) => {
    const evidence = currentCase;
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      if (request.method !== 'POST' || request.url !== '/api/v1/responses' ||
          request.headers.authorization !== 'Bearer local-acceptance-relay-key') throw Error('REQUEST_REJECTED');
      let raw = '';
      for await (const bytes of request) {
        raw += bytes;
        if (raw.length > 512 * 1024) throw Error('REQUEST_TOO_LARGE');
      }
      const body = JSON.parse(raw);
      if (report.errorCode) throw Error(report.errorCode);
      if (body.model !== 'glm-5.3-flash' || !['low', 'high', 'max'].includes(body.reasoning?.effort)) throw Error('REQUEST_REJECTED');
      if (evidence?.name === 'tool-loop') {
        const outputs = body.input?.filter(item => item.type === 'function_call_output') ?? [];
        const ids = outputs.map(item => item.call_id);
        if (new Set(ids).size !== ids.length || ids.some(id => ![...evidence.functions.values()].includes(id))) throw Error('TOOL_BINDING_FAILED');
        for (const id of ids) evidence.outputs.add(id);
      }
      if (report.requests >= options.maxRequests) throw Error('REQUEST_BUDGET_EXHAUSTED');
      report.requests += 1; // Count before dispatch; concurrent requests share the same finite budget.
      const observed = { model: body.model, effort: body.reasoning.effort, status: null };
      report.observations.push(observed);
      const result = await fetch(upstream + '/responses', { method: 'POST', redirect: 'manual',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: raw, signal: controller.signal });
      observed.status = result.status;
      if (!result.ok) {
        report.errorCode = 'PROVIDER_HTTP_ERROR';
        await result.body?.cancel();
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Provider HTTP status ' + result.status } }));
        return;
      }
      response.writeHead(200, { 'content-type': result.headers.get('content-type') ?? 'text/event-stream' });
      const decoder = new TextDecoder();
      let pending = '';
      let frames = '';
      // Hold potential partial key matches across chunks; never pass the real key into the CLI or its persisted state.
      for await (const bytes of result.body) {
        const chunk = decoder.decode(bytes, { stream: true });
        if (evidence?.name === 'tool-loop') {
          frames += chunk;
          if (frames.length > 2 * 1024 * 1024) throw Error('OUTPUT_LIMIT');
          const complete = frames.split(/\r?\n\r?\n/);
          frames = complete.pop();
          for (const frame of complete) {
            const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data || data === '[DONE]') continue;
            const event = JSON.parse(data);
            inspectFunction(evidence, event.item);
            for (const item of event.response?.output ?? []) inspectFunction(evidence, item);
          }
        }
        pending = (pending + chunk).replaceAll(key, '[REDACTED]');
        const safeLength = Math.max(0, pending.length - key.length + 1);
        response.write(pending.slice(0, safeLength));
        pending = pending.slice(safeLength);
      }
      response.end((pending + decoder.decode()).replaceAll(key, '[REDACTED]'));
    } catch (error) {
      report.errorCode ??= controller.signal.aborted ? 'TIMEOUT' :
        ['REQUEST_REJECTED', 'REQUEST_TOO_LARGE', 'REQUEST_BUDGET_EXHAUSTED', 'TOOL_BINDING_FAILED', 'OUTPUT_LIMIT'].includes(error.message) ? error.message : 'TRANSPORT_FAILED';
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"Acceptance relay stopped"}}');
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = profiles[options.profile];
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  const catalog = path.join(home, 'models.json');
  writeFileSync(catalog, readFileSync(path.join(repository, 'config/zai-models.json')));
  writeFileSync(path.join(home, 'config.toml'),
    'model = "glm-5.3-flash"\nmodel_provider = ' + JSON.stringify(profile.provider) +
    '\nmodel_reasoning_effort = "low"\nmodel_catalog_json = ' + JSON.stringify(catalog.replaceAll('\\', '/')) +
    '\napproval_policy = "never"\nsandbox_mode = "read-only"\nproject_doc_max_bytes = 0\nweb_search = "disabled"\n[features]\nplugins = false\n' +
    '[model_providers.' + profile.provider + ']\nname = "Acceptance relay"\nbase_url = ' + JSON.stringify(baseUrl) +
    '\nwire_api = "responses"\nenv_key = ' + JSON.stringify(profile.keyEnv) +
    '\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n' +
    '[model_provider_routes]\n"glm-5.3-flash" = ' + JSON.stringify(profile.provider) + '\n');
  return { directory, home, workspace, env: childEnvironment(home, profile.keyEnv),
    beginCase(name) { currentCase = { name, functions: new Map(), outputs: new Set() }; },
    toolEvidence() {
      const ids = [...currentCase.functions.values()];
      return { wireCallIdBound: ids.length === 1 && currentCase.outputs.size === 1 && currentCase.outputs.has(ids[0]) };
    },
    async close() {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await mock?.close();
    } };
}
