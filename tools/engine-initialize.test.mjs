import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('the combined Windows CLI reports the release version and initializes', async () => {
  const binary = process.env.CODEX_TEST_ROUTED_BINARY;
  assert.ok(binary, 'Set CODEX_TEST_ROUTED_BINARY to the 0.159.2 combined debug CLI (#31/#16); this test never builds it');
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /\b0\.159\.2\b/);
  await initializeAppServer(binary);
});
