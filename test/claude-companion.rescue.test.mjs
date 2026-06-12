import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-companion.mjs");

async function makeExecutable(filePath, contents) {
  await writeFile(filePath, contents, "utf8");
  await chmod(filePath, 0o755);
}

async function makeFakeClaudeBin() {
  const binDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-bin-"));
  await makeExecutable(
    path.join(binDir, "claude"),
    [
      "#!/bin/sh",
      "if [ -n \"$FAKE_CLAUDE_ARGS_FILE\" ]; then",
      "  printf '%s\\n' \"$@\" > \"$FAKE_CLAUDE_ARGS_FILE\"",
      "fi",
      "if [ -n \"$FAKE_CLAUDE_STDIN_FILE\" ]; then",
      "  /bin/cat > \"$FAKE_CLAUDE_STDIN_FILE\"",
      "else",
      "  /bin/cat > /dev/null",
      "fi",
      "if [ -n \"$FAKE_CLAUDE_STDERR\" ]; then",
      "  echo \"$FAKE_CLAUDE_STDERR\" >&2",
      "fi",
      "case \"$FAKE_CLAUDE_STREAM\" in",
      "  malformed)",
      "    echo 'not-json'",
      "    echo '{\"type\":\"unknown\",\"payload\":{\"ignored\":true}}'",
      "    echo '{\"type\":\"stream_event\",\"stream_event\":{\"delta\":{\"text\":\"Partial \"}}}'",
      "    echo '{\"type\":\"stream_event\",\"stream_event\":{\"delta\":{\"text\":\"answer\"}}}'",
      "    ;;",
      "  message)",
      "    echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Message final\"}]}}'",
      "    ;;",
      "  nested-delta)",
      "    echo '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"delta\":{\"text\":\"Nested \"}}}'",
      "    echo '{\"type\":\"stream_event\",\"stream_event\":{\"event\":{\"type\":\"content_block_delta\",\"delta\":{\"text\":\"delta\"}}}}'",
      "    ;;",
      "  permission-block)",
      "    printf '%s\\n' '{\"type\":\"result\",\"result\":\"The user needs to approve running Python. Once approved, the command to run is:\\n\\n```bash\\npython -m unittest test_calculator -v\\n```\"}'",
      "    ;;",
      "  empty)",
      "    ;;",
      "  *)",
      "    echo '{\"type\":\"system\",\"subtype\":\"init\"}'",
      "    echo '{\"type\":\"unknown\",\"payload\":{\"ignored\":true}}'",
      "    echo '{\"type\":\"stream_event\",\"stream_event\":{\"delta\":{\"text\":\"Draft answer\"}}}'",
      "    echo '{\"type\":\"result\",\"result\":\"Final answer\"}'",
      "    ;;",
      "esac",
      "exit \"${FAKE_CLAUDE_EXIT:-0}\"",
      ""
    ].join("\n")
  );
  return binDir;
}

function runCli(args, { binDir, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...env,
        PATH: binDir
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

test("rescue invokes Claude with stream-json flags and user prompt", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const argsFile = path.join(workDir, "args.txt");
  const stdinFile = path.join(workDir, "stdin.ndjson");

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Fix the failing test",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--write",
      "--session-id",
      "session-123",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile,
        FAKE_CLAUDE_STDIN_FILE: stdinFile
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result, "Final answer");
  assert.equal(payload.cwd, workDir);
  assert.equal(payload.model, "haiku");
  assert.equal(payload.effort, "low");
  assert.equal(payload.permissionMode, "acceptEdits");
  assert.equal(payload.isolation, "standard");
  assert.equal(payload.sessionId, "session-123");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.deepEqual(claudeArgs, [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    "--session-id",
    "session-123",
    "--model",
    "haiku",
    "--effort",
    "low",
    "--permission-mode",
    "acceptEdits"
  ]);

  const stdinLine = (await readFile(stdinFile, "utf8")).trim();
  assert.deepEqual(JSON.parse(stdinLine), {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Fix the failing test"
        }
      ]
    }
  });
});

test("rescue passes allowed tools and trusted local dev preset to Claude", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const argsFile = path.join(workDir, "args.txt");
  const allowedToolsFile = path.join(workDir, "allowed-tools.json");
  await writeFile(allowedToolsFile, `${JSON.stringify(["Bash(custom check*)"])}\n`, "utf8");

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Fix and verify",
      "--trust-local-dev",
      "--allow-tool",
      "Bash(pytest*)",
      "--allowed-tools-file",
      allowedToolsFile,
      "--session-id",
      "session-tools",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile
      }
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.trustedLocalDev, true);
  assert.ok(payload.allowedTools.includes("Read"));
  assert.ok(payload.allowedTools.includes("Edit"));
  assert.ok(payload.allowedTools.includes("Bash(python3 -m unittest*)"));
  assert.ok(payload.allowedTools.includes("Bash(pytest*)"));
  assert.ok(payload.allowedTools.includes("Bash(custom check*)"));

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  const allowedIndex = claudeArgs.indexOf("--allowedTools");
  assert.notEqual(allowedIndex, -1);
  assert.ok(claudeArgs.slice(allowedIndex + 1).includes("Bash(pytest*)"));
  assert.ok(claudeArgs.slice(allowedIndex + 1).includes("Bash(custom check*)"));
});

test("rescue reports Claude tool approval requests as permission_blocked", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Fix and test", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_STREAM: "permission-block"
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "permission_blocked");
  assert.equal(payload.permissionBlock.blockedTool, "Bash(python -m unittest test_calculator -v)");
  assert.match(payload.permissionBlock.guidance.join("\n"), /--trust-local-dev/);
  assert.match(
    payload.permissionBlock.guidance.join("\n"),
    /--allow-tool "Bash\(python -m unittest test_calculator -v\)"/
  );
});

test("rescue supports bare isolation mode when requested", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const argsFile = path.join(workDir, "args.txt");

  const result = await runCli(["rescue", "--prompt", "Do the task", "--bare", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.isolation, "bare");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[0], "--bare");
  assert.equal(claudeArgs[1], "-p");
});

test("plan invokes Claude with read-only planning scaffold", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-plan-cwd-"));
  const argsFile = path.join(workDir, "args.txt");
  const stdinFile = path.join(workDir, "stdin.ndjson");

  const result = await runCli(
    [
      "plan",
      "--prompt",
      "Design the migration path",
      "--model",
      "opus",
      "--effort",
      "high",
      "--session-id",
      "session-plan",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile,
        FAKE_CLAUDE_STDIN_FILE: stdinFile
      }
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.productMode, "plan");
  assert.equal(payload.permissionMode, "plan");
  assert.equal(payload.model, "opus");
  assert.equal(payload.effort, "high");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[claudeArgs.indexOf("--permission-mode") + 1], "plan");

  const stdinEvent = JSON.parse((await readFile(stdinFile, "utf8")).trim());
  assert.match(stdinEvent.message.content[0].text, /planning, architecture, and systems-design/);
  assert.match(stdinEvent.message.content[0].text, /Stay read-only/);
  assert.match(stdinEvent.message.content[0].text, /Design the migration path/);
});

test("ui invokes Claude with design scaffold and write-capable default", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-ui-cwd-"));
  const argsFile = path.join(workDir, "args.txt");
  const stdinFile = path.join(workDir, "stdin.ndjson");

  const result = await runCli(
    [
      "ui",
      "--prompt",
      "Polish the dashboard layout",
      "--session-id",
      "session-ui",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile,
        FAKE_CLAUDE_STDIN_FILE: stdinFile
      }
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "ui");
  assert.equal(payload.productMode, "ui");
  assert.equal(payload.permissionMode, "acceptEdits");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[claudeArgs.indexOf("--permission-mode") + 1], "acceptEdits");

  const stdinEvent = JSON.parse((await readFile(stdinFile, "utf8")).trim());
  assert.match(stdinEvent.message.content[0].text, /frontend UI and product-design specialist/);
  assert.match(stdinEvent.message.content[0].text, /visual hierarchy/);
  assert.match(stdinEvent.message.content[0].text, /Polish the dashboard layout/);
});

test("ui --plan invokes read-only UI critique", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-ui-cwd-"));
  const argsFile = path.join(workDir, "args.txt");

  const result = await runCli(
    [
      "design",
      "--prompt",
      "Critique the landing page",
      "--plan",
      "--session-id",
      "session-ui-plan",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile
      }
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.productMode, "ui");
  assert.equal(payload.permissionMode, "plan");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[claudeArgs.indexOf("--permission-mode") + 1], "plan");
});

test("rescue tolerates malformed lines and unknown stream events", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Explain the change", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_STREAM: "malformed"
    }
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result, "Partial answer");
  assert.equal(payload.stream.malformedLineCount, 1);
  assert.equal(payload.stream.eventCount, 3);
});

test("rescue extracts assistant message content arrays", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Summarize", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_STREAM: "message"
    }
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result, "Message final");
});

test("rescue extracts nested Claude stream deltas", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Summarize", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_STREAM: "nested-delta"
    }
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result, "Nested delta");
});

test("rescue maps danger permission mode", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Do the task", "--danger", "--json"], {
    binDir
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.permissionMode, "bypassPermissions");
});

test("rescue supports plan permission mode", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--prompt", "Inspect only", "--plan", "--json"], {
    binDir
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.permissionMode, "plan");
});

test("rescue --resume uses the latest resumable session for the workspace", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const otherDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-other-cwd-"));
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-state-"));
  const argsFile = path.join(workDir, "args.txt");
  await writeFile(
    path.join(stateDir, "jobs.json"),
    `${JSON.stringify(
      {
        version: 1,
        jobs: [
          {
            id: "rescue-older",
            kind: "rescue",
            status: "completed",
            cwd: workDir,
            workspaceRoot: workDir,
            claudeSessionId: "session-older",
            updatedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "rescue-other-workspace",
            kind: "rescue",
            status: "completed",
            cwd: otherDir,
            workspaceRoot: otherDir,
            claudeSessionId: "session-other",
            updatedAt: "2026-01-03T00:00:00.000Z",
            createdAt: "2026-01-03T00:00:00.000Z"
          },
          {
            id: "rescue-latest",
            kind: "rescue",
            status: "completed",
            cwd: workDir,
            workspaceRoot: workDir,
            claudeSessionId: "session-latest",
            updatedAt: "2026-01-02T00:00:00.000Z",
            createdAt: "2026-01-02T00:00:00.000Z"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Continue the task",
      "--resume",
      "--cwd",
      workDir,
      "--state-dir",
      stateDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile
      }
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sessionId, "session-latest");
  assert.equal(payload.sessionMode, "resume");
  assert.equal(payload.resumedFromJobId, "rescue-latest");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[claudeArgs.indexOf("--session-id") + 1], "session-latest");
});

test("rescue --fresh creates a new session even when a resumable session exists", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-state-"));
  await writeFile(
    path.join(stateDir, "jobs.json"),
    `${JSON.stringify(
      {
        version: 1,
        jobs: [
          {
            id: "rescue-existing",
            kind: "rescue",
            status: "completed",
            cwd: workDir,
            workspaceRoot: workDir,
            claudeSessionId: "session-existing",
            updatedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Start over",
      "--fresh",
      "--cwd",
      workDir,
      "--state-dir",
      stateDir,
      "--json"
    ],
    { binDir }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sessionMode, "fresh");
  assert.notEqual(payload.sessionId, "session-existing");
  assert.equal(payload.resumedFromJobId, null);
});

test("rescue --resume reports a clear error when no resumable session exists", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-state-"));

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Continue",
      "--resume",
      "--cwd",
      workDir,
      "--state-dir",
      stateDir,
      "--json"
    ],
    { binDir }
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No resumable Claude rescue session found/);
});

test("rescue rejects conflicting session options before invoking Claude", async () => {
  const binDir = await makeFakeClaudeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-rescue-cwd-"));
  const argsFile = path.join(workDir, "args.txt");

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Invalid",
      "--resume",
      "--fresh",
      "--cwd",
      workDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_ARGS_FILE: argsFile
      }
    }
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cannot use --resume and --fresh together/);
  await assert.rejects(readFile(argsFile, "utf8"), /ENOENT/);
});

test("rescue rejects --resume with an explicit session id", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(
    ["rescue", "--prompt", "Invalid", "--resume", "--session-id", "session-123", "--json"],
    { binDir }
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cannot use --resume with --session-id/);
});

test("rescue rejects missing prompt before invoking Claude", async () => {
  const binDir = await makeFakeClaudeBin();

  const result = await runCli(["rescue", "--json"], { binDir });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /rescue requires --prompt/);
});

test("rescue rejects missing cwd", async () => {
  const binDir = await makeFakeClaudeBin();
  const missingDir = path.join(tmpdir(), "claude-rescue-missing-dir");
  await mkdir(path.dirname(missingDir), { recursive: true });

  const result = await runCli(
    ["rescue", "--prompt", "Do the task", "--cwd", missingDir, "--json"],
    { binDir }
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Working directory does not exist/);
});
