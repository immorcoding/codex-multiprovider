import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repository, 'tools', 'install-engine.ps1');
const checkout = process.env.CODEX_TEST_UPSTREAM_CHECKOUT;
const expectedSha = '064c6b8c737f5b41d171fdda80bd9ef10ad06eb3';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

async function initializeAppServer(binary) {
  const probeHome = mkdtempSync(path.join(tmpdir(), 'codex-mp-baseline-'));
  try {
    const response = await new Promise((resolve, reject) => {
      const child = spawn(binary, ['app-server'], {
        env: { ...process.env, CODEX_HOME: probeHome },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      let settled = false;
      const closed = new Promise((done) => child.once('close', done));
      const timer = setTimeout(() => finish(new Error(`app-server initialize timed out: ${errors.slice(-4000)}`)), 90_000);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        closed.then(() => {
          if (error) reject(error);
          else resolve(value);
        });
      }
      child.on('error', finish);
      child.on('exit', (code) => finish(new Error(`app-server exited ${code}: ${errors.slice(-4000)}`)));
      child.stderr.on('data', (chunk) => { errors += chunk.toString(); });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const newline = output.indexOf('\n');
        if (newline !== -1) {
          try { finish(null, JSON.parse(output.slice(0, newline))); }
          catch (error) { finish(error); }
        }
      });
      child.stdin.write(`${JSON.stringify({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'baseline_probe', version: '0.1.0' }, capabilities: { experimentalApi: true } },
      })}\n`);
    });
    assert.equal(response.id, 1);
    assert.ok(response.result, JSON.stringify(response));
  } finally {
    assert.ok(probeHome.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    rmSync(probeHome, { recursive: true, force: true });
  }
}

test('a clean stable baseline builds and initializes through the installer without applying the old patch', { timeout: 60 * 60 * 1000 }, async () => {
  assert.ok(checkout, 'Set CODEX_TEST_UPSTREAM_CHECKOUT to a clean rust-v0.158.0 checkout');
  const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
  assert.equal(head.status, 0, head.stderr);
  assert.equal(head.stdout.trim(), expectedSha);

  const install = run('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
    '-BaselineOnly', '-EnginePath', checkout, '-Profile', 'debug',
  ]);
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);

  const binary = path.join(checkout, 'codex-rs', 'target', 'debug', 'codex.exe');
  assert.ok(existsSync(binary), `Expected built CLI at ${binary}`);
  const version = run(binary, ['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /0\.158\.0/);
  await initializeAppServer(binary);

  const status = run('git', ['-C', checkout, 'status', '--porcelain']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout.trim(), '');
});

test('the stable baseline records engine and both SDK runtime versions', () => {
  const record = readFileSync(path.join(repository, 'docs', 'engine-baseline.md'), 'utf8');
  for (const value of ['rust-v0.158.0', expectedSha, '@openai/codex', '@openai/codex-sdk', 'openai-codex', 'openai-codex-cli-bin', '0.153.4']) {
    assert.ok(record.includes(value), `Missing baseline fact: ${value}`);
  }
});

test('baseline mode rejects a dirty checkout without removing its contents', () => {
  assert.ok(checkout, 'Set CODEX_TEST_UPSTREAM_CHECKOUT to a clean rust-v0.158.0 checkout');
  const marker = path.join(checkout, `codex-mp-test-${process.pid}.txt`);
  assert.ok(!existsSync(marker));
  writeFileSync(marker, 'preserve this user file');
  try {
    const install = run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
      '-BaselineOnly', '-EnginePath', checkout, '-Profile', 'debug',
    ]);
    assert.notEqual(install.status, 0);
    assert.match(install.stderr, /uncommitted changes/);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve this user file');
  } finally {
    unlinkSync(marker);
  }
});

test('baseline mode rejects a checkout at another commit without changing it', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'codex-mp-wrong-sha-'));
  try {
    mkdirSync(path.join(fixture, 'codex-rs'));
    writeFileSync(path.join(fixture, 'codex-rs', 'Cargo.toml'), '[workspace]\n');
    assert.equal(run('git', ['init', fixture]).status, 0);
    assert.equal(run('git', ['-C', fixture, 'add', 'codex-rs/Cargo.toml']).status, 0);
    assert.equal(run('git', ['-C', fixture, '-c', 'user.name=Baseline Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']).status, 0);
    const install = run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
      '-BaselineOnly', '-EnginePath', fixture, '-Profile', 'debug',
    ]);
    assert.notEqual(install.status, 0);
    assert.match(install.stderr, /checked out .* but this build needs/);
    assert.equal(run('git', ['-C', fixture, 'status', '--porcelain']).stdout.trim(), '');
  } finally {
    assert.ok(fixture.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    rmSync(fixture, { recursive: true, force: true });
  }
});
