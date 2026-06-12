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
      "if [ -n \"$FAKE_GIT_COMMANDS_FILE\" ]; then printf '%s\\n' \"$@\" >> \"$FAKE_GIT_COMMANDS_FILE\"; fi",
      "if [ \"$1\" = \"ls-files\" ]; then",
      "  if [ \"$FAKE_GIT_UNTRACKED\" = \"1\" ]; then printf 'notes/new-file.js\\0'; fi",
      "  if [ \"$FAKE_GIT_UNTRACKED\" = \"2\" ]; then printf 'notes/first.js\\0notes/second.js\\0'; fi",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"diff\" ]; then",
      "  if [ -n \"$FAKE_GIT_ARGS_FILE\" ]; then printf '%s\\n' \"$@\" > \"$FAKE_GIT_ARGS_FILE\"; fi",
      "  if [ \"$FAKE_GIT_NO_HEAD\" = \"1\" ] && [ \"$3\" = \"HEAD\" ]; then",
      "    echo \"fatal: ambiguous argument 'HEAD': unknown revision\" >&2",
      "    exit 128",
      "  fi",
      "  if [ \"$5\" = \"/dev/null\" ]; then",
      "    printf 'diff --git a/dev/null b/%s\\n+untracked content\\n' \"$6\"",
      "    exit 1",
      "  fi",
      "  if [ \"$FAKE_GIT_NO_HEAD\" = \"1\" ] && [ \"$3\" = \"--cached\" ]; then",
      "    printf 'diff --git a/new.js b/new.js\\n+staged();\\n'",
      "    exit 0",
      "  fi",
      "  if [ \"$FAKE_GIT_NO_HEAD\" = \"1\" ] && [ -z \"$3\" ]; then",
      "    printf 'diff --git a/new.js b/new.js\\n+unstaged();\\n'",
      "    exit 0",
      "  fi",
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

  const result = await runCli(["review", "--base", "main", "--model", "haiku", "--json"], {
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
  assert.match(await readFile(promptFile, "utf8"), /Review the diff from main\.\.\.HEAD and return structured output/);
  assert.match(await readFile(promptFile, "utf8"), /buggy/);
});

test("review default includes staged and unstaged tracked changes", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const gitArgsFile = path.join(tempDir, "git-args.txt");

  const result = await runCli(["review", "--json"], {
    binDir,
    env: {
      FAKE_GIT_ARGS_FILE: gitArgsFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.deepEqual(payload.diffCommand, ["git", "diff", "--no-ext-diff", "HEAD"]);
  assert.deepEqual((await readFile(gitArgsFile, "utf8")).trim().split("\n"), [
    "diff",
    "--no-ext-diff",
    "HEAD"
  ]);
});

test("review falls back when HEAD is unavailable in a new repository", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const commandsFile = path.join(tempDir, "git-commands.txt");
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--json"], {
    binDir,
    env: {
      FAKE_GIT_COMMANDS_FILE: commandsFile,
      FAKE_GIT_NO_HEAD: "1",
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  const commands = await readFile(commandsFile, "utf8");
  assert.match(commands, /diff\n--no-ext-diff\nHEAD/);
  assert.match(commands, /diff\n--no-ext-diff\n--cached/);
  assert.match(commands, /diff\n--no-ext-diff\n$/);
  const prompt = await readFile(promptFile, "utf8");
  assert.match(prompt, /staged\(\)/);
  assert.match(prompt, /unstaged\(\)/);
});

test("review sends a strict finding schema to Claude", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const argsFile = path.join(tempDir, "claude-args.txt");

  const result = await runCli(["review", "--base", "main", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  const schema = JSON.parse(claudeArgs[4]);
  const findingSchema = schema.properties.findings.items;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(findingSchema.required, [
    "title",
    "severity",
    "file",
    "line",
    "description",
    "recommendation"
  ]);
  assert.deepEqual(findingSchema.properties.severity.enum, [
    "critical",
    "high",
    "medium",
    "low",
    "info"
  ]);
  assert.deepEqual(findingSchema.properties.line.type, ["integer", "null"]);
  assert.equal(findingSchema.additionalProperties, false);
});

test("review can explicitly include untracked files", async () => {
  const binDir = await makeFakeBin({ diff: "diff --git a/app.js b/app.js\n+tracked();\n" });
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const commandsFile = path.join(tempDir, "git-commands.txt");
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--include-untracked", "--json"], {
    binDir,
    env: {
      FAKE_GIT_COMMANDS_FILE: commandsFile,
      FAKE_GIT_UNTRACKED: "1",
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.includeUntracked, true);
  assert.deepEqual(payload.untrackedFiles, ["notes/new-file.js"]);
  const commands = await readFile(commandsFile, "utf8");
  assert.match(commands, /ls-files\n--others\n--exclude-standard\n-z/);
  assert.match(commands, /diff\n--no-ext-diff\n--no-index\n--\n\/dev\/null\nnotes\/new-file\.js/);
  assert.match(await readFile(promptFile, "utf8"), /untracked content/);
});

test("review includes untracked files with an explicit base when requested", async () => {
  const binDir = await makeFakeBin({ diff: "diff --git a/app.js b/app.js\n+tracked();\n" });
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--base", "main", "--include-untracked", "--json"], {
    binDir,
    env: {
      FAKE_GIT_UNTRACKED: "1",
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.includeUntracked, true);
  assert.deepEqual(payload.diffCommand, ["git", "diff", "--no-ext-diff", "main...HEAD"]);
  assert.deepEqual(payload.untrackedFiles, ["notes/new-file.js"]);
  assert.match(await readFile(promptFile, "utf8"), /tracked\(\)/);
  assert.match(await readFile(promptFile, "utf8"), /untracked content/);
});

test("review separates multiple untracked-only diffs", async () => {
  const binDir = await makeFakeBin({ diff: "" });
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const promptFile = path.join(tempDir, "prompt.txt");

  const result = await runCli(["review", "--include-untracked", "--json"], {
    binDir,
    env: {
      FAKE_GIT_UNTRACKED: "2",
      FAKE_CLAUDE_PROMPT_FILE: promptFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const prompt = await readFile(promptFile, "utf8");
  assert.match(
    prompt,
    /b\/notes\/first\.js\n\+untracked content\n\ndiff --git a\/dev\/null b\/notes\/second\.js/
  );
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
  assert.match(prompt, /Adversarially review the diff from main\.\.\.HEAD and return structured output/);
  assert.match(prompt, /subtle concrete failure modes/);
});

test("review passes explicit Claude effort level", async () => {
  const binDir = await makeFakeBin();
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const argsFile = path.join(tempDir, "claude-args.txt");

  const result = await runCli(["review", "--base", "main", "--effort", "low", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.effort, "low");

  const claudeArgs = (await readFile(argsFile, "utf8")).trim().split("\n");
  assert.equal(claudeArgs[8], "sonnet");
  assert.equal(claudeArgs[9], "--effort");
  assert.equal(claudeArgs[10], "low");
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

test("review refuses oversized diffs before invoking Claude", async () => {
  const binDir = await makeFakeBin({ diff: "diff --git a/app.js b/app.js\n+" + "x".repeat(80) });
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-review-"));
  const argsFile = path.join(tempDir, "claude-args.txt");

  const result = await runCli(["review", "--max-diff-bytes", "20", "--json"], {
    binDir,
    env: {
      FAKE_CLAUDE_ARGS_FILE: argsFile
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Review diff is too large/);
  await assert.rejects(readFile(argsFile, "utf8"), /ENOENT/);
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
