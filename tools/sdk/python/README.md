# Published Python SDK / patched app-server

Install from public PyPI (a private mirror may not contain these releases):

```powershell
python -m pip install --index-url https://pypi.org/simple -r tools/sdk/python/requirements.txt
$env:CODEX_TEST_ROUTED_BINARY = 'C:\path\to\patched\codex.exe'
python -m mypy --strict tools/sdk/python/public_api.py
python -m pytest -q tools/sdk/python
```

Use the engine at `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3` with the four
ordered patches described in [engine-baseline.md](../../../docs/engine-baseline.md).
CI builds that exact combination on Linux and Windows before running these tests.
The binary variable is mandatory; a missing binary fails instead of silently
testing the bundled CLI. `CodexConfig(codex_bin=...)` launches its app-server over stdio.

The tests use a temporary CODEX_HOME, model catalog and workspace, disable plugin
sync, and point the Coding Plan service identity at a loopback Responses server.
Only a fake key is used. They cover initialize metadata, thread creation, typed
turn notifications and a delta while the server deliberately withholds completion,
persisted resume in a fresh app-server, fork with inherited provider, 401 propagation,
credential redaction and rejection of an explicit cross-provider fork.
CI bounds the SDK step to five minutes in case a notification stream hangs.

## Runtime pairing (verified 2026-09-29)

The **published** `openai-codex==0.158.0` wheel declares
`openai-codex-cli-bin==0.158.0` in its package metadata. This differs from the
`0.153.4` dependency in the fixed tag's source `sdk/python/pyproject.toml`.
The released SDK and bundled runtime versions align at 0.158.0, but the bundled
runtime is the upstream CLI and does **not** contain this repository's patches.
Passing `codex_bin` explicitly is required for this acceptance result.

No SDK source changes or schema adapters are needed for the tested public calls.
Use `metadata.userAgent` for initialize metadata, `TurnStatus` enum values for
statuses, and expect `RuntimeError` from `Thread.run` on a failed provider turn.
These are existing SDK contracts, not engine/schema defects. The independent
`public_api.py` check exercises public imports and signatures with strict mypy.

This validates the synchronous public SDK with the patched engine, not every SDK
API, async parity, default-runtime routing, parent/subagent completion policy or
live Z.AI credentials. Parent completion remains covered by the shared Rust CI
tests; ordinary turn notifications are the notification boundary exercised here.
