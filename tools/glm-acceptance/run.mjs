// One public entry point. Live safety gates run before any engine or network work.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnvironment, createSession, profiles, repository, runProcess } from './session.mjs';
import { availableCases, parseOptions, validateLiveEndpoint } from './options.mjs';
const args = process.argv.slice(2);
let options;
try { options = parseOptions(args); } catch { /* Never echo untrusted arguments. */ }
const report = { schemaVersion: 1, mode: options?.mode ?? 'invalid',
  profile: options?.profile ?? null, status: 'rejected', requests: 0, steps: [], observations: [],
  selectedCases: options?.cases ?? [], liveCompatibility: 'unverified', matrixComplete: false,
  startedAt: new Date().toISOString() };
if (!options) {
  report.errorCode = 'INVALID_OPTIONS';
  process.exitCode = 2;
} else if (report.mode === 'live' && !options.confirmLive) {
  report.errorCode = 'LIVE_CONFIRMATION_REQUIRED';
  process.exitCode = 2;
} else if (report.mode === 'live' && profiles[report.profile].qualificationRequired && !options.qualified) {
  report.errorCode = 'RESPONSES_QUALIFICATION_REQUIRED';
  process.exitCode = 2;
} else if (report.mode === 'live' && !options.maxRequests) {
  report.errorCode = 'REQUEST_BUDGET_REQUIRED';
  process.exitCode = 2;
} else if (report.mode === 'live' && !process.env[profiles[report.profile]?.keyEnv]) {
  report.errorCode = 'KEY_REQUIRED';
  process.exitCode = 2;
}
if (!report.errorCode && report.mode === 'live') {
  try { validateLiveEndpoint(options); }
  catch (error) { report.errorCode = error.message; process.exitCode = 2; }
}
if (!report.errorCode) {
  let session;
  try {
    assert.ok(profiles[report.profile]);
    report.issue = profiles[report.profile].issue;
    const engine = options.engine;
    const verified = JSON.parse(await runProcess(process.execPath,
      [path.join(repository, 'tools/verify-engine-artifact.mjs'), '--engine', engine], { env: childEnvironment(process.env.TEMP ?? repository) }));
    report.artifact = { version: verified.version, sourceSha: verified.sourceSha,
      patchTree: verified.patchTree, binarySha256: verified.binarySha256 };
    session = await createSession({ ...options, baseUrl: options.baseUrl ?? profiles[report.profile].baseUrl }, report);
    for (const name of options.cases) {
      const step = { case: name, status: 'failed' };
      report.steps.push(step);
      if (name === 'typescript' || name === 'python') {
        const python = options.python ?? path.join(repository, 'work/python-sdk/Scripts/python.exe');
        const script = name === 'typescript' ? 'typescript-probe.mjs' : 'python-probe.py';
        const output = await runProcess(name === 'typescript' ? process.execPath : python, [path.join(repository, 'tools/glm-acceptance', script),
          verified.binaryPath, session.home, profiles[report.profile].keyEnv, ...(name === 'typescript' ? [String(options.timeoutMs)] : [])],
        { ...session, timeoutMs: options.timeoutMs * 2 + 5000 });
        const details = JSON.parse(output);
        assert.equal(details.pass, true);
        step.details = details;
        step.status = 'passed';
        continue;
      }
      if (name === 'tool-loop') {
        const output = await runProcess(process.execPath, [path.join(repository, 'tools/glm-acceptance/rpc-probe.mjs'),
          verified.binaryPath, session.home, profiles[report.profile].provider, profiles[report.profile].keyEnv, String(options.timeoutMs)],
        { ...session, timeoutMs: options.timeoutMs * 2 + 5000 });
        const details = JSON.parse(output);
        assert.equal(details.pass, true);
        step.details = details;
        step.status = 'passed';
        continue;
      }
      const effort = name.slice(5);
      assert.ok(['low', 'high', 'max'].includes(effort));
      const output = await runProcess(verified.binaryPath, ['exec', '-C', session.workspace,
        '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
        '-c', 'model_reasoning_effort="' + effort + '"', 'Do not use tools. Reply only ACK_VERIFY.'], { ...session, timeoutMs: options.timeoutMs });
      const events = output.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.filter(event => event.type === 'turn.completed').length, 1);
      assert.ok(events.some(event => event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text.includes('ACK_VERIFY')));
      step.status = 'passed';
    }
    report.status = 'passed';
    report.matrixComplete = options.cases.length === availableCases.length;
    if (report.mode === 'live') report.liveCompatibility = report.matrixComplete ? 'selected-profile-matrix-passed' : 'selected-cases-only';
  } catch (error) {
    report.status = 'failed';
    report.errorCode ??= ['TIMEOUT', 'OUTPUT_LIMIT', 'PROCESS_START_FAILED'].includes(error.message) ? error.message : 'PROBE_FAILED';
    process.exitCode = 1;
  }
  finally {
    if (session) {
      await session.close();
      report.remoteRequests = report.mode === 'live' ? report.requests : 0;
      report.completedAt = new Date().toISOString();
      report.reportPath = path.join(session.directory, 'report.json');
      writeFileSync(report.reportPath, JSON.stringify(report, null, 2) + '\n');
    }
  }
}
report.remoteRequests ??= 0;
report.completedAt ??= new Date().toISOString();
console.log(JSON.stringify(report));
