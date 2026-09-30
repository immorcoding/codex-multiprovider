import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const entry = 'tools/glm-acceptance/run.mjs';
function run(...args) {
  return execute(args);
}
function execute(args, overrides = {}) {
  const env = { ...process.env };
  delete env.ZAI_CODING_PLAN_API_KEY;
  delete env.ZAI_PAYG_API_KEY;
  const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 120_000 });
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

test('live acceptance requires explicit confirmation before any provider request', () => {
  const result = run('--profile', 'coding-plan', '--live', '--max-requests', '1');
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.report?.status, 'rejected');
  assert.equal(result.report?.errorCode, 'LIVE_CONFIRMATION_REQUIRED');
  assert.equal(result.report?.requests, 0);
});

test('pay-as-you-go cannot borrow Coding Plan Responses qualification', () => {
  const result = run('--profile', 'payg', '--live', '--confirm-live', '--max-requests', '1', '--base-url', 'https://api.z.ai/api/v1');
  assert.equal(result.status, 2);
  assert.equal(result.report.errorCode, 'RESPONSES_QUALIFICATION_REQUIRED');
  assert.equal(result.report.requests, 0);
});

test('live acceptance requires an explicit finite provider request budget', () => {
  const result = run('--live', '--confirm-live');
  assert.equal(result.status, 2);
  assert.equal(result.report.errorCode, 'REQUEST_BUDGET_REQUIRED');
  assert.equal(result.report.requests, 0);
});

test('default mock acceptance exercises the patched CLI without any live credentials', () => {
  const result = run('--cases', 'text-low');
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.report.mode, 'mock');
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.requests, 1);
  assert.equal(result.report.steps[0].case, 'text-low');
  assert.equal(result.report.steps[0].status, 'passed');
  assert.equal(result.report.artifact.version, 'codex-cli 0.159.2');
});

test('request budget stops later probes rather than claiming partial success', () => {
  const result = run('--cases', 'text-low,text-high', '--max-requests', '1');
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.errorCode, 'REQUEST_BUDGET_EXHAUSTED');
  assert.equal(result.report.requests, 1);
  assert.equal(result.report.steps[1].case, 'text-high');
  assert.equal(result.report.steps[1].status, 'failed');
});

test('provider authentication errors are reported without leaking keys or response bodies', () => {
  const result = run('--cases', 'text-low', '--mock-scenario', 'secret-error');
  assert.equal(result.status, 1);
  assert.equal(result.report.errorCode, 'PROVIDER_HTTP_ERROR');
  assert.equal(result.report.observations[0].status, 401);
  assert.doesNotMatch(result.stdout + result.stderr, /DO-NOT-LOG|private-provider-body/);
});

test('missing live credentials stop before starting the CLI or relay', () => {
  // An unreachable loopback URL keeps the RED run offline even before the gate exists.
  const result = run('--live', '--confirm-live', '--max-requests', '1', '--base-url', 'http://127.0.0.1:1');
  assert.equal(result.status, 2);
  assert.equal(result.report.errorCode, 'KEY_REQUIRED');
  assert.equal(result.report.requests, 0);
});

test('ambiguous modes and misspelled probes are rejected instead of running a different test', () => {
  for (const args of [['--mock', '--live'], ['--cases', 'text-typo'], ['--profile', 'other'], ['--max-requests', 'NaN'], ['--key', 'DO-NOT-LOG']]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.report.errorCode, 'INVALID_OPTIONS');
    assert.equal(result.report.requests, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /DO-NOT-LOG/);
  }
});

test('the pay-as-you-go mock profile verifies callId binding, tool continuation and a second turn independently', () => {
  const result = run('--profile', 'payg', '--cases', 'tool-loop');
  assert.equal(result.status, 0);
  assert.equal(result.report.profile, 'payg');
  assert.equal(result.report.issue, 18);
  assert.equal(result.report.requests, 3);
  assert.equal(result.report.steps[0].details.callIdBound, true);
  assert.equal(result.report.steps[0].details.secondTurn, true);
  assert.equal(result.report.steps[0].details.toolCalls, 1);
});

test('the reusable TypeScript probe streams and resumes through the installed public SDK', () => {
  const result = run('--cases', 'typescript');
  assert.equal(result.status, 0);
  assert.equal(result.report.requests, 2);
  assert.equal(result.report.steps[0].details.sdkVersion, '0.159.2');
  assert.equal(result.report.steps[0].details.persistedResume, true);
});

test('the reusable Python probe checks delta ordering and persisted resume in a new app-server', () => {
  const result = run('--profile', 'payg', '--cases', 'python');
  assert.equal(result.status, 0);
  assert.equal(result.report.requests, 2);
  assert.equal(result.report.steps[0].details.sdkVersion, '0.159.2');
  assert.equal(result.report.steps[0].details.runtimeVersion, '0.159.2');
  assert.equal(result.report.steps[0].details.deltaBeforeCompleted, true);
  assert.equal(result.report.steps[0].details.persistedResume, true);
});

test('live credentials cannot be sent to a guessed Chat endpoint, redirect host or credential-bearing URL', () => {
  for (const url of ['http://127.0.0.1:1', 'https://evil.example/api/v1', 'https://api.z.ai/api/paas/v4',
    'https://user:DO-NOT-LOG@api.z.ai/api/v1', 'https://api.z.ai/api/v1?key=DO-NOT-LOG', 'https://api.z.ai/api/v1/responses']) {
    const result = execute(['--live', '--confirm-live', '--max-requests', '1', '--base-url', url], { ZAI_CODING_PLAN_API_KEY: 'DO-NOT-LOG' });
    assert.equal(result.status, 2);
    assert.equal(result.report.errorCode, 'BASE_URL_REJECTED');
    assert.equal(result.report.requests, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /DO-NOT-LOG/);
  }
});

test('Windows users can run the mock smoke test with one PowerShell command and no key prompt', () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/test-glm.ps1', '-Service', 'payg', '-Cases', 'text-low', '-MaxRequests', '1'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'mock');
  assert.equal(report.profile, 'payg');
  assert.equal(report.requests, 1);
  assert.equal(report.status, 'passed');
});

test('visible text without a Responses completion tail is never reported as a passing turn', () => {
  const result = run('--cases', 'text-low', '--mock-scenario', 'missing-completed');
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.requests, 1);
  assert.equal(result.report.steps[0].status, 'failed');
});

test('a stalled provider is cancelled at the configured deadline without starting a later probe', () => {
  const result = run('--cases', 'text-low,text-high', '--mock-scenario', 'slow', '--timeout-ms', '2000');
  assert.equal(result.status, 1);
  assert.equal(result.report.errorCode, 'TIMEOUT');
  assert.ok(result.report.requests <= 1);
  assert.ok(!result.report.steps.some(step => step.case === 'text-high' && step.status === 'passed'));
});

test('a passing selected-case report does not claim full live compatibility', () => {
  const result = run('--cases', 'text-high');
  assert.equal(result.status, 0);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.liveCompatibility, 'unverified');
  assert.equal(result.report.matrixComplete, false);
  assert.equal(result.report.remoteRequests, 0);
  assert.deepEqual(result.report.selectedCases, ['text-high']);
  assert.equal(result.report.observations[0].effort, 'high');
});

test('inconsistent service function call IDs fail before a tool continuation can be accepted', () => {
  const result = run('--cases', 'tool-loop', '--mock-scenario', 'inconsistent-call-id');
  assert.equal(result.status, 1);
  assert.equal(result.report.errorCode, 'TOOL_BINDING_FAILED');
  assert.equal(result.report.status, 'failed');
});

test('the RPC command rejects wrong-turn tool requests and stale same-thread completions', () => {
  for (const scenario of ['wrong-tool-turn', 'wrong-completion', 'duplicate-completion', 'after-completed']) {
    const home = mkdtempSync(path.resolve('work/rpc-fault-'));
    mkdirSync(path.join(home, 'workspace'));
    copyFileSync('tools/glm-acceptance/rpc-fixture.cjs', path.join(home, 'workspace/app-server'));
    writeFileSync(path.join(home, 'workspace/scenario.txt'), scenario);
    const result = spawnSync(process.execPath, ['tools/glm-acceptance/rpc-probe.mjs', process.execPath, home, 'fixture', 'FIXTURE_KEY', '1000'],
      { env: { ...process.env, FIXTURE_KEY: 'fixture-only' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /"pass":true/);
  }
});
