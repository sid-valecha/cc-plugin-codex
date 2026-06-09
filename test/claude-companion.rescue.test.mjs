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
      "spark",
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
