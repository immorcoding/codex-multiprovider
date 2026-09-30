import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions, type TurnOptions, type RunResult } from "@openai/codex-sdk";
import { isolatedCliEnv } from "./isolated-cli-env.mjs";

// Compile the same public API shape exercised by sdk-routing.test.mjs.
export async function runPatchedCli(binary: string, home: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const codexOptions: CodexOptions = {
    codexPathOverride: binary,
    env: isolatedCliEnv(home, "fixture-key"),
  };
  const codex = new Codex(codexOptions);
  const options: ThreadOptions = {
    model: "glm-5.3-flash",
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "read-only",
  };
  const turnOptions: TurnOptions = { signal };
  const thread = codex.startThread(options);
  const { events } = await thread.runStreamed("hello", turnOptions);
  for await (const event of events) {
    const observed: ThreadEvent = event;
    if (observed.type === "turn.failed") throw new Error(observed.error.message);
  }
  if (!thread.id) throw new Error("SDK did not expose a thread ID");
  const resumed = codex.resumeThread(thread.id, options);
  const result: RunResult = await resumed.run("again", turnOptions);
  return result.finalResponse;
}
