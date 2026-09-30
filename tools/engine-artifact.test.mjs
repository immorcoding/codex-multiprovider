import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('artifact verification rejects patch fingerprint drift before starting the CLI', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'codex-artifact-record-'));
  try {
    const record = JSON.parse(readFileSync('docs/engine-validation-0.159.json', 'utf8'));
    record.enginePath = process.env.CODEX_TEST_UPSTREAM_CHECKOUT;
    assert.ok(record.enginePath, 'Set CODEX_TEST_UPSTREAM_CHECKOUT to the single frozen engine');
    record.patches[0].sha256 = '0'.repeat(64);
    const file = path.join(temporary, 'record.json');
    writeFileSync(file, JSON.stringify(record));
    const result = spawnSync(process.execPath, ['tools/verify-engine-artifact.mjs', '--record', file], { encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Patch fingerprint mismatch/);
  } finally {
    assert.ok(path.resolve(temporary).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    rmSync(temporary, { recursive: true, force: true });
  }
});
