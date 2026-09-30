"""Published Python SDK against the fixed-SHA patched app-server, without real keys."""

import hashlib
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import distribution, version
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from openai_codex import ApprovalMode, Codex, CodexConfig, CodexRpcError, Sandbox
from openai_codex.types import TurnStatus

ROOT = Path(__file__).resolve().parents[3]
KEY = "python-sdk-fixture-key-must-not-leak"


@pytest.fixture(scope="session")
def verified_binary():
    baseline = json.loads((ROOT / "config/engine-baseline.json").read_text())
    evidence = json.loads((ROOT / "docs/engine-validation-0.159.json").read_text())
    requirements = Path(__file__).with_name("requirements.txt").read_text().splitlines()
    for package in ("openai-codex", "openai-codex-cli-bin"):
        expected = baseline["publishedVersions"][package]
        assert f"{package}=={expected}" in requirements, "Pin the frozen public SDK/runtime"
        assert version(package) == expected, "Install the frozen public SDK/runtime"
    runtime = next(Requirement(value) for value in distribution("openai-codex").requires
                   if Requirement(value).name == "openai-codex-cli-bin")
    assert str(runtime.specifier) == "==0.159.2"
    binary = Path(os.environ["CODEX_TEST_ROUTED_BINARY"]).resolve(strict=True)
    assert binary == Path(evidence["binaryPath"]).resolve(), "Reuse the single verified patched CLI"
    with binary.open("rb") as file:
        assert hashlib.file_digest(file, "sha256").hexdigest() == evidence["binarySha256"]
    for patch in evidence["patches"]:
        assert hashlib.sha256((ROOT / patch["path"]).read_bytes()).hexdigest() == patch["sha256"]
    return binary


def events(text):
    item = {"id": "msg", "type": "message", "role": "assistant",
            "content": [{"type": "output_text", "text": text}]}
    return [
        {"type": "response.created", "response": {"id": "r", "status": "in_progress", "output": []}},
        {"type": "response.output_item.added", "item": {**item, "content": []}},
        {"type": "response.output_text.delta", "delta": text},
        {"type": "response.output_item.done", "item": item},
        {"type": "response.completed", "response": {"id": "r", "status": "completed", "output": [item],
         "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
    ]


@pytest.fixture
def provider(tmp_path, monkeypatch, verified_binary):
    binary = verified_binary
    requests = []
    release = threading.Event()
    state = {"status": 200, "hold": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, self.headers.get("Authorization"), body))
            self.send_response(state["status"])
            self.send_header("Content-Type", "text/event-stream" if state["status"] == 200 else "application/json")
            self.end_headers()
            if state["status"] != 200:
                self.wfile.write(b'{"error":{"message":"mock unauthorized"}}')
                return
            for event in events(f"Python reply {len(requests)}"):
                if event["type"] == "response.completed" and state["hold"]:
                    assert release.wait(20), "SDK did not expose delta before completion"
                self.wfile.write(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    home = tmp_path / "home"
    home.mkdir()
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    # CodexConfig.env augments os.environ; isolate both before SDK launch.
    env = {key: os.environ[key] for key in
           ("SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC")
           if key in os.environ}
    env.update({key: str(home) for key in
                ("USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "CODEX_HOME")})
    env["ZAI_CODING_PLAN_API_KEY"] = KEY
    for key in list(os.environ):
        monkeypatch.delenv(key)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    catalog = home / "models.json"
    catalog.write_bytes((ROOT / "config/zai-models.json").read_bytes())
    config = (ROOT / "config/zai-coding-plan.config-snippet.toml").read_text()
    config = config.replace("https://api.z.ai/api/v1", f"http://127.0.0.1:{server.server_port}/api/v1")
    config = config.replace('wire_api = "responses"', 'wire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0')
    config = config.replace("[model_providers.zai_coding_plan]", "[features]\nplugins = false\n[model_providers.zai_coding_plan]")
    (home / "config.toml").write_text(f"model_catalog_json = {json.dumps(str(catalog))}\n{config}")
    sdk_config = CodexConfig(codex_bin=str(binary), cwd=str(cwd),
                             env=env)
    try:
        result = subprocess.run([str(binary), "--version"], env=env, capture_output=True,
                                text=True, check=True, timeout=10)
        assert result.stdout.strip() == "codex-cli 0.159.2"
        yield sdk_config, requests, state, release
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def start(codex):
    return codex.thread_start(model="glm-5.3-flash", approval_mode=ApprovalMode.auto_review,
                              sandbox=Sandbox.read_only)


def routed(requests, count):
    assert len(requests) == count
    for url, authorization, body in requests:
        assert url == "/api/v1/responses"
        assert authorization == f"Bearer {KEY}"
        assert body["model"] == "glm-5.3-flash"


def test_initialize_stream_resume_and_fork(provider):
    config, requests, state, release = provider
    with Codex(config) as codex:
        assert "0.159.2" in codex.metadata.userAgent
        thread = start(codex)
        thread_id = thread.id
        state["hold"] = True
        turn = thread.turn("first")
        methods = []
        for event in turn.stream():
            methods.append(event.method)
            if event.method == "item/agentMessage/delta":
                assert event.payload.delta == "Python reply 1"
                assert event.payload.thread_id == thread_id
                assert event.payload.turn_id == turn.id
                assert "turn/completed" not in methods
                release.set()
            if event.method == "turn/completed":
                assert event.payload.turn.status == TurnStatus.completed
        assert "item/agentMessage/delta" in methods
        assert methods.count("turn/completed") == 1
        state["hold"] = False
    # A fresh app-server proves persisted resume rather than an in-memory handle.
    with Codex(config) as codex:
        resumed = codex.thread_resume(thread_id)
        assert resumed.id == thread_id
        assert resumed.run("second").final_response == "Python reply 2"
        fork = codex.thread_fork(thread_id)
        assert fork.id != thread_id
        assert fork.run("forked").final_response == "Python reply 3"
        assert fork.read().thread.model_provider == "zai_coding_plan"
        assert resumed.read().thread.model_provider == "zai_coding_plan"
    routed(requests, 3)


def test_provider_and_rpc_errors(provider):
    config, requests, state, _release = provider
    with Codex(config) as codex:
        thread = start(codex)
        state["status"] = 401
        with pytest.raises(RuntimeError, match="401") as failure:
            thread.run("fail")
        assert KEY not in str(failure.value)
        with pytest.raises(CodexRpcError) as error:
            codex.thread_fork(thread.id, model_provider="openai")
        assert "provider" in str(error.value).lower()
        assert KEY not in str(error.value)
    routed(requests, 1)

