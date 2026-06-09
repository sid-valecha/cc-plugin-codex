#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 5000;
const AUTH_FAILURE_PATTERN =
  /\b(not\s+(logged|authenticated)|logged\s+out|unauthenticated|no\s+valid|invalid\s+auth|login\s+required)\b/i;

const INSTALL_GUIDANCE = [
  "Install Claude Code with `npm install -g @anthropic-ai/claude-code`.",
  "After installing, run `claude install stable` to select the stable channel."
];

const AUTH_GUIDANCE = [
  "Authenticate interactively with `claude auth login --claudeai` for Claude subscription accounts.",
  "Run `claude setup-token` for long-lived subscription auth in strict bare mode.",
  "Or set `ANTHROPIC_API_KEY` for API-key auth.",
  "For Amazon Bedrock, set `CLAUDE_CODE_USE_BEDROCK=1` and configure AWS credentials.",
  "For Google Vertex AI, set `CLAUDE_CODE_USE_VERTEX=1` and configure GCP credentials.",
  "For managed secrets, configure Claude Code `apiKeyHelper`."
];

const AUTH_PROBE_FAILURE_GUIDANCE = [
  "Run `claude auth status --text` directly and inspect the CLI error output."
];

const AUTH_PROBE_TIMEOUT_GUIDANCE = [
  "`claude auth status --text` timed out; check whether Claude Code is hanging or waiting for interactive input."
];

const DEFAULT_RESCUE_MODEL = "sonnet";
const MODEL_ALIASES = new Map([["spark", "haiku"]]);
const DEFAULT_PERMISSION_MODE = "acceptEdits";
const PLAN_PERMISSION_MODE = "plan";
const WRITE_PERMISSION_MODE = "acceptEdits";
const DANGER_PERMISSION_MODE = "bypassPermissions";
const VALID_PERMISSION_MODES = new Set([
  "plan",
  "acceptEdits",
  "bypassPermissions",
  "default",
  "auto",
  "dontAsk"
]);
const DEFAULT_STATE_DIR = path.join(homedir(), ".codex", "plugins", "data", "claude-code");
const JOBS_FILE = "jobs.json";
const CANCEL_GRACE_MS = 500;
const STALE_RUNNING_GRACE_MS = 10000;

function parseArgs(argv) {
  const options = {
    json: false,
    help: false,
    prompt: null,
    cwd: null,
    base: null,
    schema: null,
    model: null,
    permissionMode: null,
    stateDir: null,
    jobId: null,
    limit: 20,
    sessionId: null,
    write: false,
    danger: false,
    plan: false,
    background: false,
    bare: false
  };
  let command = null;
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--prompt") {
      options.prompt = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      options.cwd = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--base") {
      options.base = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--schema") {
      options.schema = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model") {
      options.model = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--permission-mode") {
      options.permissionMode = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--state-dir") {
      options.stateDir = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--job-id") {
      options.jobId = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = Number.parseInt(readOptionValue(argv, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--session-id") {
      options.sessionId = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--danger") {
      options.danger = true;
      continue;
    }
    if (arg === "--plan") {
      options.plan = true;
      continue;
    }
    if (arg === "--background") {
      options.background = true;
      continue;
    }
    if (arg === "--bare") {
      options.bare = true;
      continue;
    }
    if (command === null) {
      command = arg;
      continue;
    }
    rest.push(arg);
  }

  return { command, options, rest };
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: node scripts/claude-companion.mjs <subcommand> [options]",
    "",
    "Implemented subcommands:",
    "  setup     Check local Node, npm, Claude Code, and Claude auth status.",
    "  rescue    Run a foreground or background Claude Code delegation task.",
    "  status    List active and recent Claude jobs.",
    "  result    Show the latest or selected Claude job result.",
    "  cancel    Cancel a running Claude job.",
    "  review    Run a structured read-only Claude review.",
    "",
    "Options:",
    "  --json                  Emit machine-readable JSON.",
    "  --cwd <path>            Run from a specific working directory.",
    "  --model <model>         Claude model alias or ID. Defaults to sonnet.",
    "  --state-dir <path>      Override plugin job state directory.",
    "",
    "Rescue options:",
    "  --prompt <text>         Task prompt to send to Claude.",
    "  --plan                  Use read-only plan permission mode.",
    "  --write                 Use acceptEdits permission mode. This is the default.",
    "  --danger                Use bypassPermissions permission mode.",
    "  --permission-mode <m>   Explicit Claude permission mode.",
    "  --session-id <uuid>     Explicit Claude session id for continuity.",
    "  --bare                  Use Claude bare mode for API-key/helper/provider auth.",
    "",
    "Job options:",
    "  --job-id <id>           Select a specific job for result or cancel.",
    "  --limit <n>             Limit status output. Defaults to 20.",
    "",
    "Review options:",
    "  --base <ref>            Review git diff from <ref>...HEAD.",
    "  --schema <path>         Override review JSON schema path."
  ].join("\n");
}

function firstLine(value) {
  return value.trim().split(/\r?\n/).find(Boolean) ?? "";
}

function summarizeProbe(result) {
  if (result.status === "missing") {
    return "command not found";
  }
  if (result.status === "timed_out") {
    return `timed out after ${result.timeoutMs}ms`;
  }
  if (result.status === "skipped") {
    return result.detail;
  }
  if (result.status === "unauthenticated") {
    return firstLine(result.stdout) || firstLine(result.stderr) || "unauthenticated";
  }
  if (result.ok) {
    return firstLine(result.stdout) || firstLine(result.stderr) || "ok";
  }
  return firstLine(result.stderr) || firstLine(result.stdout) || `exited with ${result.exitCode}`;
}

function createSkippedCheck(name, command, detail) {
  return {
    name,
    command,
    ok: false,
    status: "skipped",
    detail,
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
    guidance: []
  };
}

function runProbe(name, command, args, { timeoutMs = DEFAULT_TIMEOUT_MS, guidance = [] } = {}) {
  return new Promise((resolve) => {
    const chunks = {
      stdout: [],
      stderr: []
    };
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        name,
        command: [command, ...args],
        guidance,
        ...result
      });
    };

    const timer = setTimeout(() => {
      if (child) {
        child.kill("SIGTERM");
      }
      finish({
        ok: false,
        status: "timed_out",
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        exitCode: null,
        signal: "SIGTERM",
        timeoutMs
      });
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        stdout: "",
        stderr: error.message,
        exitCode: null,
        signal: null
      });
      return;
    }

    child.stdout.on("data", (chunk) => chunks.stdout.push(chunk));
    child.stderr.on("data", (chunk) => chunks.stderr.push(chunk));
    child.on("error", (error) => {
      finish({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: error.message,
        exitCode: null,
        signal: null
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        ok: exitCode === 0,
        status: exitCode === 0 ? "ok" : "failed",
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        exitCode,
        signal
      });
    });
  });
}

function evaluateAuthProbe(result) {
  if (result.status === "missing") {
    return {
      ...result,
      guidance: INSTALL_GUIDANCE
    };
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (result.ok && !AUTH_FAILURE_PATTERN.test(combinedOutput)) {
    return result;
  }

  if (!AUTH_FAILURE_PATTERN.test(combinedOutput)) {
    return {
      ...result,
      guidance:
        result.status === "timed_out" ? AUTH_PROBE_TIMEOUT_GUIDANCE : AUTH_PROBE_FAILURE_GUIDANCE
    };
  }

  return {
    ...result,
    ok: false,
    status: "unauthenticated",
    guidance: AUTH_GUIDANCE
  };
}

async function runSetup() {
  const checks = [];

  checks.push(
    await runProbe("node", "node", ["--version"], {
      guidance: ["Install Node.js 20 or newer."]
    })
  );
  checks.push(
    await runProbe("npm", "npm", ["--version"], {
      guidance: ["Install npm with Node.js, or repair the Node.js installation."]
    })
  );

  const claudeVersion = await runProbe("claude", "claude", ["--version"], {
    guidance: INSTALL_GUIDANCE
  });
  checks.push(claudeVersion);

  if (claudeVersion.status === "missing") {
    checks.push(
      createSkippedCheck(
        "claudeAuth",
        ["claude", "auth", "status", "--text"],
        "`claude` must be installed before auth can be checked."
      )
    );
  } else {
    checks.push(
      evaluateAuthProbe(
        await runProbe("claudeAuth", "claude", ["auth", "status", "--text"], {
          guidance: []
        })
      )
    );
  }

  const result = {
    ok: checks.every((check) => check.ok),
    checks,
    guidance: collectGuidance(checks)
  };

  return result;
}

function collectGuidance(checks) {
  const seen = new Set();
  const guidance = [];
  for (const check of checks) {
    if (check.ok) {
      continue;
    }
    for (const item of check.guidance ?? []) {
      if (!seen.has(item)) {
        seen.add(item);
        guidance.push(item);
      }
    }
  }
  return guidance;
}

function renderHumanSetup(result) {
  const lines = ["Claude Code setup diagnostics", ""];
  for (const check of result.checks) {
    const mark = check.ok ? "[OK]" : "[FAIL]";
    lines.push(`${mark} ${check.command.join(" ")}: ${summarizeProbe(check)}`);
  }

  if (result.guidance.length > 0) {
    lines.push("", "Guidance:");
    for (const item of result.guidance) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", result.ok ? "Setup looks ready." : "Setup needs attention.");
  return lines.join("\n");
}

function normalizeModel(model) {
  const rawModel = model?.trim() || DEFAULT_RESCUE_MODEL;
  return MODEL_ALIASES.get(rawModel) ?? rawModel;
}

function resolvePermissionMode(options) {
  let permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;
  if (options.plan) {
    permissionMode = PLAN_PERMISSION_MODE;
  }
  if (options.write) {
    permissionMode = WRITE_PERMISSION_MODE;
  }
  if (options.danger) {
    permissionMode = DANGER_PERMISSION_MODE;
  }
  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new Error(
      `Unsupported permission mode '${permissionMode}'. Expected one of: ${[
        ...VALID_PERMISSION_MODES
      ].join(", ")}`
    );
  }
  return permissionMode;
}

async function resolveCwd(rawCwd) {
  const cwd = path.resolve(rawCwd ?? process.cwd());
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${cwd}`);
  }
  return cwd;
}

function buildRescueArgs({ bare, model, permissionMode, sessionId }) {
  return [
    ...(bare ? ["--bare"] : []),
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    "--session-id",
    sessionId,
    "--model",
    model,
    "--permission-mode",
    permissionMode
  ];
}

function runClaudeRescue({
  bare,
  cwd,
  prompt,
  model,
  permissionMode,
  sessionId,
  onChildPid,
  detached = false
}) {
  const args = buildRescueArgs({ bare, model, permissionMode, sessionId });
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn("claude", args, {
        cwd,
        detached,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        args,
        stdout: "",
        stderr: error.message,
        exitCode: null,
        signal: null
      });
      return;
    }

    if (onChildPid) {
      onChildPid(child.pid);
    }
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      finish({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        args,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        exitCode: null,
        signal: null
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        ok: exitCode === 0,
        status: exitCode === 0 ? "completed" : "failed",
        args,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        signal
      });
    });

    child.stdin.end(`${JSON.stringify(createUserStreamEvent(prompt))}\n`);
  });
}

function createUserStreamEvent(prompt) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt
        }
      ]
    }
  };
}

async function runRescue(options) {
  if (!options.prompt || !options.prompt.trim()) {
    throw new Error("rescue requires --prompt <text>");
  }

  const model = normalizeModel(options.model);
  const permissionMode = resolvePermissionMode(options);
  const sessionId = options.sessionId?.trim() || randomUUID();
  const cwd = await resolveCwd(options.cwd);

  if (options.background) {
    return startBackgroundRescue({
      options,
      cwd,
      model,
      permissionMode,
      sessionId
    });
  }

  const invocation = await runClaudeRescue({
    bare: options.bare,
    cwd,
    prompt: options.prompt,
    model,
    permissionMode,
    sessionId
  });
  const stream = parseClaudeStream(invocation.stdout);
  const resultText = stream.finalText || stream.text.join("").trim();

  return {
    ok: invocation.ok && resultText.length > 0,
    status: invocation.ok ? (resultText.length > 0 ? "completed" : "no_result") : invocation.status,
    kind: "rescue",
    cwd,
    model,
    permissionMode,
    isolation: options.bare ? "bare" : "standard",
    sessionId,
    command: ["claude", ...invocation.args],
    exitCode: invocation.exitCode,
    signal: invocation.signal,
    result: resultText,
    stderr: invocation.stderr,
    stream
  };
}

function parseClaudeStream(stdout) {
  const parsedEvents = [];
  const malformedLines = [];
  const text = [];
  let finalText = "";

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformedLines.push(rawLine);
      continue;
    }

    parsedEvents.push(event);
    const extractedText = extractTextFromEvent(event);
    if (extractedText) {
      text.push(extractedText);
    }

    const candidateFinal = extractFinalTextFromEvent(event);
    if (candidateFinal) {
      finalText = candidateFinal;
    }
  }

  return {
    text,
    finalText,
    eventCount: parsedEvents.length,
    malformedLineCount: malformedLines.length,
    malformedLines
  };
}

function extractTextFromEvent(event) {
  const candidates = [
    event.delta?.text,
    event.text,
    event.content_delta?.text,
    event.message?.content,
    event.stream_event?.delta?.text,
    event.stream_event?.text,
    event.event?.delta?.text,
    event.event?.text
  ];

  for (const candidate of candidates) {
    const text = normalizeContent(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function extractFinalTextFromEvent(event) {
  const candidates = [
    event.result,
    event.final,
    event.final_text,
    event.message?.content,
    event.response?.content,
    event.stream_event?.message?.content,
    event.event?.message?.content
  ];

  for (const candidate of candidates) {
    const text = normalizeContent(candidate).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => normalizeContent(item)).join("");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (typeof content.content === "string") {
      return content.content;
    }
  }
  return "";
}

function renderHumanRescue(result) {
  const lines = [];
  if (result.job && result.status === "running") {
    lines.push(`Started Claude ${result.job.kind} job ${result.job.id}`);
    lines.push(`Status: ${result.job.status}`);
    lines.push(`Result: ${result.job.resultPath}`);
    return lines.join("\n");
  }
  if (result.result) {
    lines.push(result.result);
  } else {
    lines.push("Claude rescue did not produce a final assistant result.");
  }
  if (!result.ok && result.stderr.trim()) {
    lines.push("", "Claude stderr:", result.stderr.trim());
  }
  return lines.join("\n");
}

function renderHumanStatus(result) {
  if (result.jobs.length === 0) {
    return "No Claude jobs found.";
  }
  return result.jobs
    .map((job) => `${job.id} ${job.status} ${job.kind} ${job.summary || ""}`.trim())
    .join("\n");
}

function renderHumanResult(result) {
  const lines = [`Job: ${result.job.id}`, `Status: ${result.job.status}`, ""];
  lines.push(result.result || "No result is available yet.");
  return lines.join("\n");
}

function renderHumanCancel(result) {
  return `Job ${result.job.id}: ${result.status}`;
}

function resolveStateDir(rawStateDir) {
  return path.resolve(
    rawStateDir ||
      process.env.PLUGIN_DATA ||
      process.env.CODEX_PLUGIN_DATA ||
      process.env.CLAUDE_PLUGIN_DATA ||
      DEFAULT_STATE_DIR
  );
}

async function ensureStateDir(stateDir) {
  await mkdir(path.join(stateDir, "logs"), { recursive: true });
  await mkdir(path.join(stateDir, "results"), { recursive: true });
  await mkdir(path.join(stateDir, "sessions"), { recursive: true });
}

function jobsPath(stateDir) {
  return path.join(stateDir, JOBS_FILE);
}

async function readJobs(stateDir) {
  try {
    const payload = JSON.parse(await readFile(jobsPath(stateDir), "utf8"));
    return Array.isArray(payload.jobs) ? payload.jobs : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJobs(stateDir, jobs) {
  await ensureStateDir(stateDir);
  const target = jobsPath(stateDir);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, jobs }, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function upsertJob(stateDir, job) {
  const jobs = await readJobs(stateDir);
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index === -1) {
    jobs.push(job);
  } else {
    jobs[index] = {
      ...jobs[index],
      ...job
    };
  }
  await writeJobs(stateDir, jobs);
  return jobs[index === -1 ? jobs.length - 1 : index];
}

async function patchJob(stateDir, jobId, patch) {
  const jobs = await readJobs(stateDir);
  const index = jobs.findIndex((candidate) => candidate.id === jobId);
  if (index === -1) {
    throw new Error(`Job not found: ${jobId}`);
  }
  jobs[index] = {
    ...jobs[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeJobs(stateDir, jobs);
  return jobs[index];
}

async function findJob(stateDir, jobId) {
  const jobs = await readJobs(stateDir);
  return jobs.find((job) => job.id === jobId);
}

function buildJobPaths(stateDir, jobId) {
  return {
    logPath: path.join(stateDir, "logs", `${jobId}.ndjson`),
    stderrPath: path.join(stateDir, "logs", `${jobId}.stderr.log`),
    resultPath: path.join(stateDir, "results", `${jobId}.md`),
    sessionPath: path.join(stateDir, "sessions", `${jobId}.json`)
  };
}

function summarizeResult(result) {
  return result.trim().replace(/\s+/g, " ").slice(0, 160);
}

async function startBackgroundRescue({ options, cwd, model, permissionMode, sessionId }) {
  const stateDir = resolveStateDir(options.stateDir);
  await ensureStateDir(stateDir);
  const jobId = `rescue-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const paths = buildJobPaths(stateDir, jobId);
  const job = {
    id: jobId,
    kind: "rescue",
    status: "running",
    cwd,
    workspaceRoot: cwd,
    claudeSessionId: sessionId,
    runnerPid: null,
    childPid: null,
    model,
    permissionMode,
    isolation: options.bare ? "bare" : "standard",
    logPath: paths.logPath,
    stderrPath: paths.stderrPath,
    resultPath: paths.resultPath,
    sessionPath: paths.sessionPath,
    createdAt: now,
    updatedAt: now,
    exitCode: null,
    signal: null,
    summary: "",
    prompt: options.prompt
  };
  await upsertJob(stateDir, job);

  const runner = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "__run-rescue-job", "--state-dir", stateDir, "--job-id", jobId],
    {
      cwd,
      detached: true,
      stdio: "ignore"
    }
  );
  runner.unref();

  const updatedJob = await patchJob(stateDir, jobId, {
    runnerPid: runner.pid
  });

  return {
    ok: true,
    status: "running",
    job: sanitizeJob(updatedJob)
  };
}

async function runRescueJob(options) {
  if (!options.jobId) {
    throw new Error("__run-rescue-job requires --job-id");
  }
  const stateDir = resolveStateDir(options.stateDir);
  const job = await findJob(stateDir, options.jobId);
  if (!job) {
    throw new Error(`Job not found: ${options.jobId}`);
  }

  await patchJob(stateDir, job.id, {
    status: "running",
    runnerPid: process.pid
  });

  const invocation = await runClaudeRescue({
    bare: job.isolation === "bare",
    cwd: job.cwd,
    prompt: job.prompt,
    model: job.model,
    permissionMode: job.permissionMode,
    sessionId: job.claudeSessionId,
    detached: true,
    onChildPid: (childPid) => {
      patchJob(stateDir, job.id, { childPid }).catch(() => {});
    }
  });
  const stream = parseClaudeStream(invocation.stdout);
  const resultText = stream.finalText || stream.text.join("").trim();
  const latestJob = await findJob(stateDir, job.id);
  const cancelled = latestJob?.status === "cancelling" || latestJob?.status === "cancelled";
  const status =
    cancelled || invocation.signal
      ? "cancelled"
      : invocation.ok && resultText.length > 0
        ? "completed"
        : "failed";
  const summary =
    status === "cancelled"
      ? "Cancelled by user"
      : resultText
        ? summarizeResult(resultText)
        : firstLine(invocation.stderr);

  await writeFile(job.logPath, invocation.stdout, "utf8");
  await writeFile(job.stderrPath, invocation.stderr, "utf8");
  await writeFile(job.resultPath, resultText, "utf8");
  await writeFile(
    job.sessionPath,
    `${JSON.stringify({ claudeSessionId: job.claudeSessionId, stream }, null, 2)}\n`,
    "utf8"
  );
  await patchJob(stateDir, job.id, {
    status,
    childPid: null,
    exitCode: invocation.exitCode,
    signal: invocation.signal,
    summary
  });
}

async function runStatus(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 20;
  return {
    ok: true,
    stateDir,
    jobs: jobs
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(sanitizeJob)
  };
}

async function runResult(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const job = selectJob(jobs, options.jobId);
  if (!job) {
    throw new Error("No Claude jobs found");
  }
  let result = "";
  try {
    result = await readFile(job.resultPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    ok: job.status === "completed" || result.length > 0,
    job: sanitizeJob(job),
    result
  };
}

async function runCancel(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const job = selectJob(jobs, options.jobId, "running");
  if (!job) {
    throw new Error(options.jobId ? `Job not found: ${options.jobId}` : "No running Claude job found");
  }
  if (job.status !== "running" && job.status !== "cancelling") {
    return {
      ok: true,
      status: job.status,
      job: sanitizeJob(job)
    };
  }

  await patchJob(stateDir, job.id, {
    status: "cancelling",
    summary: "Cancellation requested"
  });
  const targetPid = job.childPid || job.runnerPid;
  if (targetPid) {
    signalPidGroup(targetPid, "SIGINT");
    await delay(CANCEL_GRACE_MS);
    if (isProcessAlive(targetPid)) {
      signalPidGroup(targetPid, "SIGTERM");
      await delay(CANCEL_GRACE_MS);
    }
    if (isProcessAlive(targetPid)) {
      const cancellingJob = await findJob(stateDir, job.id);
      return {
        ok: true,
        status: "cancelling",
        job: sanitizeJob(cancellingJob)
      };
    }
  }

  const cancelledJob = await patchJob(stateDir, job.id, {
    status: "cancelled",
    summary: "Cancelled by user"
  });
  return {
    ok: true,
    status: "cancelled",
    job: sanitizeJob(cancelledJob)
  };
}

function selectJob(jobs, jobId, preferredStatus = null) {
  if (jobId) {
    return jobs.find((job) => job.id === jobId);
  }
  const sorted = jobs.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (preferredStatus) {
    return sorted.find((job) => job.status === preferredStatus) ?? sorted[0];
  }
  return sorted[0];
}

async function refreshStaleJobs(stateDir, jobs) {
  let changed = false;
  const now = Date.now();
  const refreshed = jobs.map((job) => {
    const updatedAtMs = Date.parse(job.updatedAt);
    const isPastGrace =
      Number.isNaN(updatedAtMs) || now - updatedAtMs > STALE_RUNNING_GRACE_MS;
    if (
      job.status === "running" &&
      job.runnerPid &&
      isPastGrace &&
      !isProcessAlive(job.runnerPid)
    ) {
      changed = true;
      return {
        ...job,
        status: "failed",
        updatedAt: new Date().toISOString(),
        summary: job.summary || "Runner process is no longer running"
      };
    }
    return job;
  });
  if (changed) {
    await writeJobs(stateDir, refreshed);
  }
  return refreshed;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function signalPidGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return signalPid(pid, signal);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeJob(job) {
  const { prompt, ...safeJob } = job;
  return safeJob;
}

function runCommand(command, args, { cwd, input = null } = {}) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let child;

    try {
      child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      resolve({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        stdout: "",
        stderr: error.message,
        exitCode: null,
        signal: null,
        command: [command, ...args]
      });
      return;
    }

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        status: error.code === "ENOENT" ? "missing" : "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        exitCode: null,
        signal: null,
        command: [command, ...args]
      });
    });
    child.on("close", (exitCode, signal) => {
      resolve({
        ok: exitCode === 0,
        status: exitCode === 0 ? "completed" : "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        signal,
        command: [command, ...args]
      });
    });

    child.stdin.end(input ?? "");
  });
}

function defaultReviewSchemaPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas", "review-output.schema.json");
}

async function collectGitDiff({ cwd, base }) {
  const args = base ? ["diff", "--no-ext-diff", `${base}...HEAD`] : ["diff", "--no-ext-diff"];
  const result = await runCommand("git", args, { cwd });
  if (!result.ok) {
    throw new Error(`Failed to collect git diff: ${firstLine(result.stderr) || firstLine(result.stdout)}`);
  }
  return {
    diff: result.stdout,
    command: result.command
  };
}

async function loadReviewSchema(schemaPath) {
  const resolvedPath = path.resolve(schemaPath ?? defaultReviewSchemaPath());
  return {
    path: resolvedPath,
    schema: JSON.parse(await readFile(resolvedPath, "utf8"))
  };
}

function buildReviewPrompt({ diff, base }) {
  const target = base ? `the diff from ${base}...HEAD` : "the uncommitted working tree diff";
  return [
    `Review ${target}.`,
    "",
    "Return only findings that are actionable defects or meaningful risks.",
    "Prioritize correctness, regressions, data loss, security, and missing tests.",
    "Do not report style-only issues unless they hide a real bug.",
    "Use file paths and line numbers from the diff when possible.",
    "",
    "Diff:",
    diff
  ].join("\n");
}

async function runClaudeReview({ cwd, prompt, model, schema }) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--permission-mode",
    "plan",
    "--model",
    model,
    prompt
  ];
  return runCommand("claude", args, { cwd });
}

function parseReviewResponse(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error("Claude review output was not valid JSON");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Claude review output must be a JSON object");
  }
  const structuredOutput = payload.structured_output;
  if (!Object.hasOwn(payload, "structured_output")) {
    throw new Error("Claude review output did not include structured_output");
  }
  if (structuredOutput === null) {
    throw new Error("Claude review structured_output was null");
  }
  if (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
    throw new Error("Claude review structured_output must be an object");
  }
  validateReviewOutput(structuredOutput);
  return {
    raw: payload,
    structuredOutput
  };
}

function validateReviewOutput(output) {
  const errors = [];
  if (!Array.isArray(output.findings)) {
    errors.push("findings must be an array");
  }
  if (typeof output.summary !== "string") {
    errors.push("summary must be a string");
  }
  if (Array.isArray(output.findings)) {
    for (const [index, finding] of output.findings.entries()) {
      validateFinding(finding, index, errors);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Claude review structured output failed schema validation: ${errors.join("; ")}`);
  }
}

function validateFinding(finding, index, errors) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    errors.push(`findings[${index}] must be an object`);
    return;
  }
  for (const field of ["title", "severity", "file", "description", "recommendation"]) {
    if (typeof finding[field] !== "string" || !finding[field].trim()) {
      errors.push(`findings[${index}].${field} must be a non-empty string`);
    }
  }
  if (!["critical", "high", "medium", "low", "info"].includes(finding.severity)) {
    errors.push(`findings[${index}].severity is invalid`);
  }
  if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) {
    errors.push(`findings[${index}].line must be an integer >= 1 or null`);
  }
}

async function runReview(options) {
  const cwd = await resolveCwd(options.cwd);
  const model = normalizeModel(options.model);
  const diffResult = await collectGitDiff({ cwd, base: options.base });
  if (!diffResult.diff.trim()) {
    return {
      ok: true,
      status: "empty_diff",
      cwd,
      base: options.base,
      model,
      findings: [],
      summary: options.base
        ? `No changes found in diff ${options.base}...HEAD.`
        : "No uncommitted changes found to review.",
      diffCommand: diffResult.command
    };
  }

  const { path: schemaPath, schema } = await loadReviewSchema(options.schema);
  const prompt = buildReviewPrompt({
    diff: diffResult.diff,
    base: options.base
  });
  const invocation = await runClaudeReview({
    cwd,
    prompt,
    model,
    schema
  });
  if (!invocation.ok) {
    throw new Error(`Claude review failed: ${summarizeClaudeFailure(invocation)}`);
  }
  const parsed = parseReviewResponse(invocation.stdout);
  return {
    ok: true,
    status: "completed",
    cwd,
    base: options.base,
    model,
    permissionMode: "plan",
    schemaPath,
    diffCommand: diffResult.command,
    command: invocation.command,
    findings: parsed.structuredOutput.findings,
    summary: parsed.structuredOutput.summary,
    raw: parsed.raw
  };
}

function summarizeClaudeFailure(invocation) {
  try {
    const payload = JSON.parse(invocation.stdout);
    if (typeof payload.result === "string" && payload.result.trim()) {
      return payload.result.trim();
    }
    if (payload.api_error_status) {
      return `Claude API error ${payload.api_error_status}`;
    }
  } catch {
    // Fall through to plain output summaries.
  }
  return firstLine(invocation.stderr) || firstLine(invocation.stdout) || "unknown Claude error";
}

function renderHumanReview(result) {
  if (result.status === "empty_diff") {
    return result.summary;
  }
  const lines = [result.summary || "Claude review completed."];
  if (result.findings.length === 0) {
    lines.push("", "No findings.");
    return lines.join("\n");
  }
  for (const finding of result.findings) {
    const location = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
    lines.push("", `[${finding.severity}] ${finding.title}`, `${location}`, finding.description);
    if (finding.recommendation) {
      lines.push(`Recommendation: ${finding.recommendation}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (options.help || command === null) {
    console.log(usage());
    process.exit(command === null ? 1 : 0);
  }

  if (command === "setup") {
    const result = await runSetup();
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanSetup(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "rescue") {
    const result = await runRescue(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanRescue(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "status") {
    const result = await runStatus(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanStatus(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "result") {
    const result = await runResult(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanResult(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "cancel") {
    const result = await runCancel(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanCancel(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "review") {
    const result = await runReview(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanReview(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "__run-rescue-job") {
    await runRescueJob(options);
    process.exit(0);
  }

  {
    console.error(`Unknown subcommand: ${command}`);
    console.error(usage());
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
