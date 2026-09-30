import os, sys, json
from importlib.metadata import version
from openai_codex import ApprovalMode, Codex, CodexConfig, Sandbox
from openai_codex.models import AgentMessageDeltaNotification
from openai_codex.types import ReasoningEffort, TurnCompletedNotification, TurnStatus
binary, home, key_name = sys.argv[1:]
try:
    sdk_version = version('openai-codex')
    runtime_version = version('openai-codex-cli-bin')
    assert sdk_version == runtime_version == '0.159.2'
    key = os.environ[key_name]
    env = {k:os.environ[k] for k in ("SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP","COMSPEC") if k in os.environ}
    env.update({k:home for k in ("USERPROFILE","HOME","APPDATA","LOCALAPPDATA","CODEX_HOME")})
    env[key_name] = key
    # The Python SDK merges parent env: isolate it in THIS Python process.
    os.environ.clear()
    os.environ.update(env)
    config = CodexConfig(codex_bin=binary, cwd=home+"/workspace", env=env)
    with Codex(config) as codex:
        assert "0.159.2" in (codex.metadata.userAgent or "")
        thread = codex.thread_start(model="glm-5.3-flash", approval_mode=ApprovalMode.deny_all, sandbox=Sandbox.read_only)
        thread_id = thread.id
        deltas = 0
        completed = 0
        text = ""
        turn = thread.turn("Remember token PY_ACCEPTANCE. Do not use tools. Reply only ACK_PY.", effort=ReasoningEffort.low)
        for event in turn.stream():
            if isinstance(event.payload, AgentMessageDeltaNotification):
                assert event.payload.thread_id == thread_id and event.payload.turn_id == turn.id
                assert completed == 0
                deltas += 1
                text += event.payload.delta
            if isinstance(event.payload, TurnCompletedNotification):
                assert event.payload.thread_id == thread_id and event.payload.turn.id == turn.id
                assert event.payload.turn.status == TurnStatus.completed
                completed += 1
        assert deltas > 0 and completed == 1 and "ACK_PY" in text
    # A new app-server verifies persisted resume rather than an in-memory object.
    with Codex(config) as codex:
        resumed = codex.thread_resume(thread_id)
        result = resumed.run("Do not use tools. Reply only the token I asked you to remember.", effort=ReasoningEffort.low)
        assert "PY_ACCEPTANCE" in (result.final_response or "")
    print(json.dumps({"probe":"python-sdk","sdkVersion":sdk_version,"runtimeVersion":runtime_version,"deltaBeforeCompleted":True,"completed":1,"persistedResume":True,"pass":True}))
except Exception:
    print("FAIL: Python live probe; inspect privately, no automatic retry.", file=sys.stderr)
    sys.exit(1)
