import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-companion.mjs");
const HOOKS_JSON = path.join(ROOT, "hooks", "hooks.json");

async function makeExecutable(filePath, contents) {
  await writeFile(filePath, contents, "utf8");
  await chmod(filePath, 0o755);
}

async function makeFakeBin({ diff = "diff --git a/app.js b/app.js\n+buggy();\n" } = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), "claude-hook-bin-"));
  await makeExecutable(
    path.join(binDir, "git"),
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"diff\" ]; then",
      `  printf '%s' ${JSON.stringify(diff)}`,
      "  exit 0",
      "fi",
      "echo unexpected git \"$@\" >&2",
      "exit 2",
      ""
    ].join("\n")
  );
  await makeExecutable(
    path.join(binDir, "claude"),
    [
      "#!/bin/sh",
      "if [ -n \"$FAKE_CLAUDE_ARGS_FILE\" ]; then printf '%s\\n' \"$@\" > \"$FAKE_CLAUDE_ARGS_FILE\"; fi",
      "/bin/cat > /dev/null",
      "if [ \"$FAKE_CLAUDE_REVIEW\" = \"error\" ]; then",
      "  echo 'review transport failed' >&2",
      "  exit 42",
      "fi",
      "echo '{\"structured_output\":{\"findings\":[{\"title\":\"Missing guard\",\"severity\":\"high\",\"file\":\"app.js\",\"line\":1,\"description\":\"The new call lacks a guard.\",\"recommendation\":\"Add the missing guard before calling buggy().\"}],\"summary\":\"Found 1 issue.\"}}'",
      "exit 0",
      ""
    ].join("\n")
  );
  return binDir;
}

function runCli(args, { binDir, env = {}, stdin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        CODEX_PLUGIN_DATA: mkdtempSync(path.join(tmpdir(), "claude-hook-state-")),
        ...env,
        PATH: binDir ? `${binDir}${path.delimiter}${process.env.PATH}` : process.env.PATH
      },
      stdio: ["pipe", "pipe", "pipe"]
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
    child.stdin.end(stdin);
  });
}

async function bundledStopHookCommand() {
  const payload = JSON.parse(await readFile(HOOKS_JSON, "utf8"));
  return payload.hooks.Stop[0].hooks[0].command;
}

async function runHookConfigCommand({ cwd, env = {} } = {}) {
  const command = await bundledStopHookCommand();
  const {
    CLAUDE_COMPANION_PLUGIN_ROOT,
    CLAUDE_COMPANION_STOP_REVIEW,
    CLAUDE_COMPANION_STOP_REVIEW_BLOCKING,
    ...baseEnv
  } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(awaitableShell(), ["-c", command], {
      cwd,
      env: {
        ...baseEnv,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
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

function awaitableShell() {
  return process.env.SHELL || "/bin/sh";
}

test("bundled Stop hook config does not resolve helper from the current workspace", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-config-cwd-"));
  const markerFile = path.join(workDir, "cwd-hook-ran.txt");
  await mkdir(path.join(workDir, "hooks"), { recursive: true });
  await makeExecutable(
    path.join(workDir, "hooks", "claude-stop-review.mjs"),
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(markerFile)}, 'ran');`,
      ""
    ].join("\n")
  );

  const result = await runHookConfigCommand({ cwd: workDir });

  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(readFile(markerFile, "utf8"), { code: "ENOENT" });
});

test("bundled Stop hook config ignores relative plugin roots", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-config-relative-"));
  const markerFile = path.join(workDir, "relative-hook-ran.txt");
  await mkdir(path.join(workDir, "hooks"), { recursive: true });
  await makeExecutable(
    path.join(workDir, "hooks", "claude-stop-review.mjs"),
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(markerFile)}, 'ran');`,
      ""
    ].join("\n")
  );

  const result = await runHookConfigCommand({
    cwd: workDir,
    env: {
      CLAUDE_COMPANION_PLUGIN_ROOT: "."
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(readFile(markerFile, "utf8"), { code: "ENOENT" });
});

test("bundled Stop hook config runs helper from an absolute plugin root", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-config-work-"));
  const pluginRoot = await mkdtemp(path.join(tmpdir(), "claude-hook-config-plugin-"));
  const markerFile = path.join(pluginRoot, "absolute-hook-ran.txt");
  await mkdir(path.join(pluginRoot, "hooks"), { recursive: true });
  await makeExecutable(
    path.join(pluginRoot, "hooks", "claude-stop-review.mjs"),
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(markerFile)}, 'ran');`,
      ""
    ].join("\n")
  );

  const result = await runHookConfigCommand({
    cwd: workDir,
    env: {
      CLAUDE_COMPANION_PLUGIN_ROOT: pluginRoot
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(markerFile, "utf8"), "ran");
});

test("hook-stop-review is inert until explicitly enabled", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-cwd-"));
  const result = await runCli(["hook-stop-review", "--cwd", workDir, "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "disabled");
  assert.match(payload.summary, /installed but disabled/);
});

test("hook-stop-review runs read-only review when enabled", async () => {
  const binDir = await makeFakeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-cwd-"));
  const argsFile = path.join(workDir, "claude-args.txt");

  const result = await runCli(["hook-stop-review", "--json"], {
    binDir,
    stdin: JSON.stringify({ cwd: workDir }),
    env: {
      CLAUDE_COMPANION_STOP_REVIEW: "1",
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.review.permissionMode, "plan");
  assert.equal(payload.review.findings.length, 1);
  assert.equal(payload.blockingFindings.length, 1);

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[0], "-p");
  assert.equal(claudeArgs[1], "--output-format");
  assert.equal(claudeArgs[2], "json");
});

test("hook-stop-review runs when enabled by project marker file", async () => {
  const binDir = await makeFakeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-cwd-"));
  await mkdir(path.join(workDir, ".codex"), { recursive: true });
  await writeFile(path.join(workDir, ".codex", "claude-stop-review.enabled"), "", "utf8");

  const result = await runCli(["hook-stop-review", "--cwd", workDir, "--json"], {
    binDir
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.review.findings.length, 1);
});

test("hook-stop-review can block on high-severity findings when opted in", async () => {
  const binDir = await makeFakeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-cwd-"));

  const result = await runCli(["hook-stop-review", "--cwd", workDir, "--json"], {
    binDir,
    env: {
      CLAUDE_COMPANION_STOP_REVIEW: "true",
      CLAUDE_COMPANION_STOP_REVIEW_BLOCKING: "true"
    }
  });

  assert.equal(result.exitCode, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "blocked");
  assert.equal(payload.ok, false);
  assert.equal(payload.blockingFindings[0].severity, "high");
});

test("hook-stop-review reports hook errors without blocking Codex", async () => {
  const binDir = await makeFakeBin();
  const workDir = await mkdtemp(path.join(tmpdir(), "claude-hook-cwd-"));

  const result = await runCli(["hook-stop-review", "--cwd", workDir, "--json"], {
    binDir,
    env: {
      CLAUDE_COMPANION_STOP_REVIEW: "1",
      FAKE_CLAUDE_REVIEW: "error"
    }
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "hook_error");
  assert.match(payload.error, /review transport failed/);
});
