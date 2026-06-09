import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

async function makeFakeBin({ diff = "diff --git a/app.js b/app.js\n+buggy();\n" } = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), "claude-review-bin-"));
  await makeExecutable(
    path.join(binDir, "git"),
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"diff\" ]; then",
      "  if [ -n \"$FAKE_GIT_ARGS_FILE\" ]; then printf '%s\\n' \"$@\" > \"$FAKE_GIT_ARGS_FILE\"; fi",
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
      "if [ -n \"$FAKE_CLAUDE_PROMPT_FILE\" ]; then",
      "  last=''",
      "  for arg in \"$@\"; do last=\"$arg\"; done",
      "  printf '%s' \"$last\" > \"$FAKE_CLAUDE_PROMPT_FILE\"",
      "fi",
      "/bin/cat > /dev/null",
      "case \"$FAKE_CLAUDE_REVIEW\" in",
      "  null)",
      "    echo '{\"structured_output\":null}'",
      "    ;;",
      "  invalid)",
      "    echo '{\"structured_output\":{\"findings\":\"not-array\",\"summary\":42}}'",
      "    ;;",
      "  error)",
      "    echo '{\"is_error\":true,\"api_error_status\":429,\"result\":\"session limit reached\"}'",
      "    exit 1",
      "    ;;",
      "  *)",
      "    echo '{\"structured_output\":{\"findings\":[{\"title\":\"Missing guard\",\"severity\":\"high\",\"file\":\"app.js\",\"line\":1,\"description\":\"The new call lacks a guard.\",\"recommendation\":\"Add the missing guard before calling buggy().\"}],\"summary\":\"Found 1 issue.\"}}'",
      "    ;;",
      "esac",
      "exit 0",
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
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
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

test("review returns structured findings from fake Claude", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const argsFile = path.join(tempDir, "claude-args.txt");
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--base", "main", "--model", "spark", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile,
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.model, "haiku");
  assert.equal(payload.permissionMode, "plan");
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].title, "Missing guard");
  assert.deepEqual(payload.diffCommand, ["git", "diff", "--no-ext-diff", "main...HEAD"]);

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.deepEqual(claudeArgs.slice(0, 8), [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(payload.raw.schema ?? JSON.parse(await readFile(payload.schemaPath, "utf8"))),
    "--permission-mode",
    "plan",
    "--model"
  ]);
  assert.match(await readFile(promptFile, "utf8"), /Review the diff from main\.\.\.HEAD/);
  assert.match(await readFile(promptFile, "utf8"), /buggy/);
});

test("review supports adversarial prompt mode", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--adversarial", "--base", "main", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "adversarial-review");
  assert.equal(payload.findings.length, 1);
  const prompt = await readFile(promptFile, "utf8");
  assert.match(prompt, /Adversarially review the diff from main\.\.\.HEAD/);
  assert.match(prompt, /subtle defects/);
});

test("adversarial-review is a thin alias for adversarial mode", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const argsFile = path.join(tempDir, "claude-args.txt");

  const result = await runCli(["adversarial-review", "--base", "main", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "adversarial-review");
  assert.deepEqual(payload.diffCommand, ["git", "diff", "--no-ext-diff", "main...HEAD"]);
  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[0], "-p");
  assert.equal(claudeArgs[1], "--output-format");
  assert.equal(claudeArgs[2], "json");
});

test("review handles empty diffs without invoking Claude", async () => {
  const binDir = await makeFakeBin({ diff: "" });

  const result = await runCli(["review", "--json"], { binDir });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "empty_diff");
  assert.deepEqual(payload.findings, []);
  assert.match(payload.summary, /No uncommitted changes/);
});

test("review treats null structured_output as schema failure", async () => {
  const binDir = await makeFakeBin();

  const result = await runCli(["review", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_REVIEW: "null"
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /structured_output was null/);
});

test("review treats invalid structured output as schema failure", async () => {
  const binDir = await makeFakeBin();

  const result = await runCli(["review", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_REVIEW: "invalid"
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /failed schema validation/);
});

test("review summarizes Claude JSON errors", async () => {
  const binDir = await makeFakeBin();

  const result = await runCli(["review", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_REVIEW: "error"
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /session limit reached/);
  assert.doesNotMatch(result.stderr, /api_error_status/);
});
