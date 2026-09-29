import { Codex, type ThreadEvent } from "@openai/codex-sdk";

// Compile the same public API shape exercised by sdk-routing.test.mjs.
export async function runPatchedCli(binary: string, home: string, cwd: string): Promise<string> {
  const codex = new Codex({
    codexPathOverride: binary,
    env: { ...process.env, CODEX_HOME: home, ZAI_CODING_PLAN_API_KEY: "fixture-key" } as Record<string, string>,
  });
  const options = {
    model: "glm-5.3-flash",
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    approvalPolicy: "never" as const,
    sandboxMode: "read-only" as const,
  };
  const thread = codex.startThread(options);
  const { events } = await thread.runStreamed("hello");
  for await (const event of events) {
    const observed: ThreadEvent = event;
    if (observed.type === "turn.failed") throw new Error(observed.error.message);
  }
  if (!thread.id) throw new Error("SDK did not expose a thread ID");
  const resumed = codex.resumeThread(thread.id, options);
  return (await resumed.run("again")).finalResponse;
}
