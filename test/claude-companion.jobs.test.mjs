import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const binDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-bin-"));
  await makeExecutable(
    path.join(binDir, "claude"),
    [
      "#!/bin/sh",
      "trap 'echo \"interrupted\" >&2; exit 130' INT TERM",
      "/bin/cat > /dev/null",
      "if [ \"$FAKE_CLAUDE_STREAM\" = \"slow\" ]; then",
      "  /bin/sleep 10",
      "fi",
      "if [ \"$FAKE_CLAUDE_STREAM\" = \"crash\" ]; then",
      "  echo 'simulated Claude crash' >&2",
      "  exit 17",
      "fi",
      "echo '{\"type\":\"stream_event\",\"stream_event\":{\"delta\":{\"text\":\"Background \"}}}'",
      "echo '{\"type\":\"result\",\"result\":\"Background done\"}'",
      "exit 0",
      ""
    ].join("\n")
  );
  return binDir;
}

function runCli(args, { binDir, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...env,
        PATH: binDir ? `${binDir}${path.delimiter}${process.env.PATH}` : process.env.PATH
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

async function waitForJob(stateDir, jobId, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await runCli(["status", "--state-dir", stateDir, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const job = payload.jobs.find((candidate) => candidate.id === jobId);
    if (job && predicate(job)) {
      return job;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

test("background rescue completes and writes status, result, and logs", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const start = await runCli(
    [
      "rescue",
      "--prompt",
      "Do this in the background",
      "--background",
      "--state-dir",
      stateDir,
      "--json"
    ],
    { binDir }
  );
  assert.equal(start.exitCode, 0, start.stderr);
  const startPayload = JSON.parse(start.stdout);
  const jobId = startPayload.job.id;
  assert.equal(startPayload.job.status, "running");
  assert.equal(startPayload.job.prompt, undefined);

  const job = await waitForJob(stateDir, jobId, (candidate) => candidate.status === "completed");
  assert.equal(job.summary, "Background done");

  const result = await runCli(["result", "--job-id", jobId, "--state-dir", stateDir, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const resultPayload = JSON.parse(result.stdout);
  assert.equal(resultPayload.result, "Background done");

  assert.match(await readFile(job.logPath, "utf8"), /Background/);
  assert.equal(await readFile(job.stderrPath, "utf8"), "");
});

test("background rescue --wait returns the completed job and result", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Do this in the background",
      "--background",
      "--wait",
      "--state-dir",
      stateDir,
      "--json"
    ],
    { binDir }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.job.status, "completed");
  assert.equal(payload.result, "Background done");
  assert.equal(payload.wait.timedOut, false);
});

test("background rescue --wait reports timeout without discarding the running job", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Keep running",
      "--background",
      "--wait",
      "--wait-timeout-ms",
      "100",
      "--state-dir",
      stateDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_STREAM: "slow"
      }
    }
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "timed_out");
  assert.equal(payload.job.status, "running");
  assert.equal(payload.wait.timedOut, true);

  const cancel = await runCli([
    "cancel",
    "--job-id",
    payload.job.id,
    "--state-dir",
    stateDir,
    "--json"
  ]);
  assert.equal(cancel.exitCode, 0, cancel.stderr);
});

test("background rescue --wait returns failed job details", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const result = await runCli(
    [
      "rescue",
      "--prompt",
      "Crash in the background",
      "--background",
      "--wait",
      "--state-dir",
      stateDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_STREAM: "crash"
      }
    }
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "failed");
  assert.equal(payload.job.status, "failed");
  assert.match(payload.job.summary, /simulated Claude crash/);
  assert.match(payload.result, /Claude rescue failed/);
  assert.match(payload.result, /Exit code: 17/);
  assert.equal(payload.wait.timedOut, false);
});

test("cancel stops a running background rescue job", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const start = await runCli(
    [
      "rescue",
      "--prompt",
      "Keep running",
      "--background",
      "--state-dir",
      stateDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_STREAM: "slow"
      }
    }
  );
  assert.equal(start.exitCode, 0, start.stderr);
  const jobId = JSON.parse(start.stdout).job.id;
  await waitForJob(stateDir, jobId, (candidate) => Boolean(candidate.childPid));

  const cancel = await runCli(["cancel", "--job-id", jobId, "--state-dir", stateDir, "--json"]);
  assert.equal(cancel.exitCode, 0, cancel.stderr);
  const cancelPayload = JSON.parse(cancel.stdout);
  assert.match(cancelPayload.status, /^(cancelling|cancelled)$/);

  const job = await waitForJob(stateDir, jobId, (candidate) => candidate.status === "cancelled");
  assert.equal(job.summary, "Cancelled by user");
});

test("failed background rescue writes an actionable result", async () => {
  const binDir = await makeFakeClaudeBin();
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));

  const start = await runCli(
    [
      "rescue",
      "--prompt",
      "Crash in the background",
      "--background",
      "--state-dir",
      stateDir,
      "--json"
    ],
    {
      binDir,
      env: {
        FAKE_CLAUDE_STREAM: "crash"
      }
    }
  );
  assert.equal(start.exitCode, 0, start.stderr);
  const jobId = JSON.parse(start.stdout).job.id;

  const job = await waitForJob(stateDir, jobId, (candidate) => candidate.status === "failed");
  assert.match(job.summary, /simulated Claude crash/);

  const result = await runCli(["result", "--job-id", jobId, "--state-dir", stateDir, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.result, /Claude rescue failed/);
  assert.match(payload.result, /simulated Claude crash/);
  assert.match(payload.result, /Exit code: 17/);
});

test("status marks stale running jobs as failed", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "claude-jobs-state-"));
  await mkdir(stateDir, { recursive: true });
  const staleJob = {
    id: "rescue-stale",
    kind: "rescue",
    status: "running",
    runnerPid: 99999999,
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    summary: ""
  };
  await writeFile(
    path.join(stateDir, "jobs.json"),
    `${JSON.stringify({ version: 1, jobs: [staleJob] }, null, 2)}\n`,
    "utf8"
  );

  const result = await runCli(["status", "--state-dir", stateDir, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.jobs[0].id, "rescue-stale");
  assert.equal(payload.jobs[0].status, "failed");
  assert.match(payload.jobs[0].summary, /Runner process/);
});
