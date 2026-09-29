"""Typecheck the public SDK boundary independently of the HTTP test fixture."""

from openai_codex import Codex, CodexConfig, Sandbox
from openai_codex.types import TurnCompletedNotification, TurnStatus


def exercise(binary: str, home: str) -> str | None:
    with Codex(CodexConfig(codex_bin=binary, env={"CODEX_HOME": home})) as codex:
        agent = codex.metadata.userAgent
        assert agent
        thread = codex.thread_start(model="glm-5.3-flash", sandbox=Sandbox.read_only)
        for notification in thread.turn("hello").stream():
            if isinstance(notification.payload, TurnCompletedNotification):
                assert notification.payload.turn.status == TurnStatus.completed
        resumed = codex.thread_resume(thread.id)
        fork = codex.thread_fork(resumed.id)
        return fork.run("continue").final_response
