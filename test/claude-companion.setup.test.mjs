import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
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

async function makeBaseBin() {
  const binDir = await mkdtemp(path.join(tmpdir(), "claude-companion-bin-"));
  await makeExecutable(
    path.join(binDir, "node"),
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo v99.0.0; exit 0; fi\necho unexpected node \"$@\" >&2\nexit 2\n"
  );
  await makeExecutable(
    path.join(binDir, "npm"),
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 99.0.0; exit 0; fi\necho unexpected npm \"$@\" >&2\nexit 2\n"
  );
  return binDir;
}

async function addFakeClaude(binDir) {
  await makeExecutable(
    path.join(binDir, "claude"),
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"2.1.145\"",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ] && [ \"$3\" = \"--text\" ]; then",
      "  if [ -n \"$FAKE_CLAUDE_AUTH_SLEEP\" ]; then /bin/sleep \"$FAKE_CLAUDE_AUTH_SLEEP\"; fi",
      "  if [ -n \"$FAKE_CLAUDE_AUTH_STDERR\" ]; then echo \"$FAKE_CLAUDE_AUTH_STDERR\" >&2; fi",
      "  echo \"${FAKE_CLAUDE_AUTH_TEXT:-Logged in}\"",
      "  exit \"${FAKE_CLAUDE_AUTH_EXIT:-0}\"",
      "fi",
      "echo unexpected claude \"$@\" >&2",
      "exit 2",
      ""
    ].join("\n")
  );
}

function runSetup(binDir, { json = true, env = {} } = {}) {
  const args = [SCRIPT, "setup"];
  if (json) {
    args.push("--json");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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

test("setup reports ready when fake Claude is installed and authenticated", async () => {
  const binDir = await makeBaseBin();
  await addFakeClaude(binDir);

  const result = await runSetup(binDir);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(
    payload.checks.map((check) => [check.name, check.ok, check.status]),
    [
      ["node", true, "ok"],
      ["npm", true, "ok"],
      ["claude", true, "ok"],
      ["claudeAuth", true, "ok"]
    ]
  );
});

test("setup reports install guidance when Claude is missing", async () => {
  const binDir = await makeBaseBin();

  const result = await runSetup(binDir);
  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.checks.find((check) => check.name === "claude").status, "missing");
  assert.equal(payload.checks.find((check) => check.name === "claudeAuth").status, "skipped");
  assert.match(payload.guidance.join("\n"), /npm install -g @anthropic-ai\/claude-code/);
  assert.match(payload.guidance.join("\n"), /claude install stable/);
});

test("setup reports auth guidance when Claude auth is not ready", async () => {
  const binDir = await makeBaseBin();
  await addFakeClaude(binDir);

  const result = await runSetup(binDir, {
    env: {
      FAKE_CLAUDE_AUTH_TEXT: "Not logged in",
      FAKE_CLAUDE_AUTH_EXIT: "0"
    }
  });
  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout);
  const auth = payload.checks.find((check) => check.name === "claudeAuth");
  assert.equal(auth.ok, false);
  assert.equal(auth.status, "unauthenticated");
  assert.match(payload.guidance.join("\n"), /claude auth login/);
  assert.match(payload.guidance.join("\n"), /ANTHROPIC_API_KEY/);
  assert.match(payload.guidance.join("\n"), /CLAUDE_CODE_USE_BEDROCK=1/);
  assert.match(payload.guidance.join("\n"), /CLAUDE_CODE_USE_VERTEX=1/);
  assert.match(payload.guidance.join("\n"), /apiKeyHelper/);
});

test("setup preserves auth probe failures that are not auth failures", async () => {
  const binDir = await makeBaseBin();
  await addFakeClaude(binDir);

  const result = await runSetup(binDir, {
    env: {
      FAKE_CLAUDE_AUTH_TEXT: "",
      FAKE_CLAUDE_AUTH_STDERR: "network transport failed",
      FAKE_CLAUDE_AUTH_EXIT: "12"
    }
  });
  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout);
  const auth = payload.checks.find((check) => check.name === "claudeAuth");
  assert.equal(auth.ok, false);
  assert.equal(auth.status, "failed");
  assert.match(payload.guidance.join("\n"), /claude auth status --text/);
  assert.doesNotMatch(payload.guidance.join("\n"), /claude auth login/);
});

test("setup preserves auth probe timeouts", async () => {
  const binDir = await makeBaseBin();
  await addFakeClaude(binDir);

  const result = await runSetup(binDir, {
    env: {
      FAKE_CLAUDE_AUTH_SLEEP: "10"
    }
  });
  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout);
  const auth = payload.checks.find((check) => check.name === "claudeAuth");
  assert.equal(auth.ok, false);
  assert.equal(auth.status, "timed_out");
  assert.match(payload.guidance.join("\n"), /timed out/);
  assert.doesNotMatch(payload.guidance.join("\n"), /claude auth login/);
});

test("setup emits human-readable diagnostics", async () => {
  const binDir = await makeBaseBin();
  await addFakeClaude(binDir);

  const result = await runSetup(binDir, { json: false });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Claude Code setup diagnostics/);
  assert.match(result.stdout, /\[OK\] node --version: v99\.0\.0/);
  assert.match(result.stdout, /Setup looks ready\./);
});
