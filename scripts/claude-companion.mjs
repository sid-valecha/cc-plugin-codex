#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
  "If `claude auth status --text` works in a normal terminal but this setup check fails, Codex's sandbox may not be able to read Claude's OAuth/keychain session; approve the Claude command to run outside the sandbox or use bare-compatible auth.",
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
const DEFAULT_REVIEW_MAX_DIFF_BYTES = 200000;
const VALID_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
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
const PERMISSIONS_DIR = "permissions";
const CANCEL_GRACE_MS = 500;
const STALE_RUNNING_GRACE_MS = 10000;
const DEFAULT_WAIT_TIMEOUT_MS = 300000;
const WAIT_POLL_INTERVAL_MS = 100;
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RESUMABLE_JOB_STATUSES = new Set(["completed", "failed"]);
const STOP_REVIEW_ENABLE_FILE = path.join(".codex", "claude-stop-review.enabled");
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);
const PERMISSION_TEXT_PATTERN = /\b(permission|approval|approve|allow|allowed|denied|deny|requires permission|needs permission)\b/i;
const TOOL_PATTERN = /\b(?:Bash|Read|Edit|Write|Glob|Grep|LS|WebFetch|WebSearch|Task|TodoWrite|NotebookRead|NotebookEdit)\([^)\r\n]+\)/g;
const DESTRUCTIVE_COMMAND_PATTERN =
  /\b(rm\s+-|git\s+clean\b|git\s+reset\s+--hard\b|npm\s+publish\b|pnpm\s+publish\b|yarn\s+npm\s+publish\b|deploy\b|kubectl\b|docker\s+push\b|aws\b|gcloud\b|scp\b|ssh\b|curl\b|wget\b)\b/i;
const READ_ONLY_COMMAND_PATTERN =
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|check|format)(\b|:)|^(git\s+(status|diff|log|show)|ls\b|pwd\b|cat\b|sed\b|rg\b|grep\b|find\b)/i;
const PLAN_PROMPT_PREFIX = [
  "You are Claude Code acting as a planning, architecture, and systems-design partner for Codex.",
  "Produce a concrete plan, tradeoffs, risks, sequencing, validation approach, and open questions.",
  "Stay read-only. Do not edit files or run mutating commands unless a later task explicitly asks for implementation.",
  "",
  "Planning request:"
].join("\n");
const UI_PROMPT_PREFIX = [
  "You are Claude Code acting as a frontend UI and product-design specialist for Codex.",
  "Focus on visual hierarchy, interaction quality, responsive layout, accessibility, implementation details, and design polish.",
  "When editing, keep changes scoped to the requested interface and preserve the existing stack and project conventions.",
  "",
  "UI/design request:"
].join("\n");

function parseArgs(argv) {
  const options = {
    json: false,
    help: false,
    prompt: null,
    cwd: null,
    base: null,
    schema: null,
    model: null,
    effort: null,
    permissionMode: null,
    stateDir: null,
    jobId: null,
    proposalId: null,
    format: "allowed-tools",
    limit: 20,
    sessionId: null,
    write: false,
    danger: false,
    plan: false,
    background: false,
    wait: false,
    resume: false,
    fresh: false,
    waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
    bare: false,
    adversarial: false,
    maxDiffBytes: DEFAULT_REVIEW_MAX_DIFF_BYTES
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
    if (arg === "--effort") {
      options.effort = readOptionValue(argv, index, arg);
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
    if (arg === "--proposal-id") {
      options.proposalId = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = readOptionValue(argv, index, arg);
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
    if (arg === "--max-diff-bytes") {
      options.maxDiffBytes = Number.parseInt(readOptionValue(argv, index, arg), 10);
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
    if (arg === "--wait") {
      options.wait = true;
      continue;
    }
    if (arg === "--resume") {
      options.resume = true;
      continue;
    }
    if (arg === "--fresh") {
      options.fresh = true;
      continue;
    }
    if (arg === "--wait-timeout-ms") {
      options.waitTimeoutMs = Number.parseInt(readOptionValue(argv, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--bare") {
      options.bare = true;
      continue;
    }
    if (arg === "--adversarial") {
      options.adversarial = true;
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
    "  plan      Ask Claude for read-only planning, architecture, or strategy help.",
    "  ui        Ask Claude for frontend UI/design implementation or polish.",
    "  status    List active and recent Claude jobs.",
    "  result    Show the latest or selected Claude job result.",
    "  cancel    Cancel a running Claude job.",
    "  review    Run a structured read-only Claude review.",
    "  adversarial-review",
    "           Run a stricter structured read-only Claude review.",
    "  permissions analyze|show|export",
    "           Analyze plugin-owned Claude logs and export reviewed permission proposals.",
    "  hook-stop-review",
    "           Optional Stop hook helper for read-only Claude review.",
    "",
    "Options:",
    "  --json                  Emit machine-readable JSON.",
    "  --cwd <path>            Run from a specific working directory.",
    "  --model <model>         Claude model alias or ID. Defaults to sonnet.",
    "  --effort <level>        Claude effort level: low, medium, high, xhigh, or max.",
    "  --state-dir <path>      Override plugin job state directory.",
    "",
    "Rescue options:",
    "  --prompt <text>         Task prompt to send to Claude.",
    "  --plan                  Use read-only plan permission mode.",
    "  --write                 Use acceptEdits permission mode. This is the default.",
    "  --danger                Use bypassPermissions permission mode.",
    "  --permission-mode <m>   Explicit Claude permission mode.",
    "  --session-id <uuid>     Explicit Claude session id for continuity.",
    "  --background            Start a managed background job.",
    "  --wait                  With --background, wait for the job to finish.",
    "  --wait-timeout-ms <n>   Maximum --wait duration. Defaults to 300000.",
    "  --resume                Continue the latest resumable rescue session in this workspace.",
    "  --fresh                 Explicitly start a new rescue session.",
    "  --bare                  Use Claude bare mode for API-key/helper/provider auth.",
    "",
    "Plan/UI options:",
    "  plan always uses read-only plan permission mode.",
    "  ui uses acceptEdits by default; add --plan for read-only UI critique.",
    "",
    "Job options:",
    "  --job-id <id>           Select a specific job for result or cancel.",
    "  --limit <n>             Limit status output. Defaults to 20.",
    "",
    "Permission proposal options:",
    "  --proposal-id <id>      Select a permission proposal for show or export.",
    "  --format <format>       Export format. Currently only allowed-tools.",
    "",
    "Review options:",
    "  --base <ref>            Review git diff from <ref>...HEAD.",
    "  --schema <path>         Override review JSON schema path.",
    "  --max-diff-bytes <n>    Refuse review diffs larger than n bytes. Defaults to 200000.",
    "  --adversarial           Use the stricter adversarial review prompt."
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

function normalizeEffort(effort) {
  if (!effort) {
    return null;
  }
  const normalized = effort.trim();
  if (!VALID_EFFORT_LEVELS.has(normalized)) {
    throw new Error(
      `Unsupported effort level '${effort}'. Expected one of: ${[...VALID_EFFORT_LEVELS].join(", ")}`
    );
  }
  return normalized;
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

function buildRescueArgs({ bare, model, effort, permissionMode, sessionId }) {
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
    ...(effort ? ["--effort", effort] : []),
    "--permission-mode",
    permissionMode
  ];
}

function runClaudeRescue({
  bare,
  cwd,
  prompt,
  model,
  effort,
  permissionMode,
  sessionId,
  onChildPid,
  detached = false
}) {
  const args = buildRescueArgs({ bare, model, effort, permissionMode, sessionId });
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
  if (options.wait && !options.background) {
    throw new Error("rescue --wait requires --background");
  }
  validateRescueSessionOptions(options);
  const waitTimeoutMs = normalizeWaitTimeoutMs(options.waitTimeoutMs);

  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort);
  const permissionMode = resolvePermissionMode(options);
  const cwd = await resolveCwd(options.cwd);
  const session = await resolveRescueSession(options, cwd);
  const sessionId = session.sessionId;

  if (options.background) {
    const started = await startBackgroundRescue({
      options,
      cwd,
      model,
      effort,
      permissionMode,
      session
    });
    if (!options.wait) {
      return started;
    }
    return waitForBackgroundJob({
      stateDir: resolveStateDir(options.stateDir),
      jobId: started.job.id,
      timeoutMs: waitTimeoutMs
    });
  }

  const invocation = await runClaudeRescue({
    bare: options.bare,
    cwd,
    prompt: options.prompt,
    model,
    effort,
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
    effort,
    permissionMode,
    isolation: options.bare ? "bare" : "standard",
    sessionId,
    sessionMode: session.mode,
    resumedFromJobId: session.resumedFromJobId,
    command: ["claude", ...invocation.args],
    exitCode: invocation.exitCode,
    signal: invocation.signal,
    result: resultText,
    stderr: invocation.stderr,
    stream
  };
}

async function runPlan(options) {
  if (!options.prompt || !options.prompt.trim()) {
    throw new Error("plan requires --prompt <text>");
  }
  const result = await runRescue({
    ...options,
    prompt: `${PLAN_PROMPT_PREFIX}\n${options.prompt.trim()}`,
    plan: true,
    write: false,
    danger: false,
    permissionMode: PLAN_PERMISSION_MODE
  });
  return {
    ...result,
    kind: result.job ? result.job.kind : "plan",
    productMode: "plan"
  };
}

async function runUi(options) {
  if (!options.prompt || !options.prompt.trim()) {
    throw new Error("ui requires --prompt <text>");
  }
  const result = await runRescue({
    ...options,
    prompt: `${UI_PROMPT_PREFIX}\n${options.prompt.trim()}`,
    permissionMode: options.plan ? PLAN_PERMISSION_MODE : (options.permissionMode ?? WRITE_PERMISSION_MODE)
  });
  return {
    ...result,
    kind: result.job ? result.job.kind : "ui",
    productMode: "ui"
  };
}

function normalizeWaitTimeoutMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--wait-timeout-ms must be a positive integer");
  }
  return timeoutMs;
}

function validateRescueSessionOptions(options) {
  if (options.resume && options.fresh) {
    throw new Error("rescue cannot use --resume and --fresh together");
  }
  if (options.resume && options.sessionId) {
    throw new Error("rescue cannot use --resume with --session-id; choose one session source");
  }
  if (options.fresh && options.sessionId) {
    throw new Error("rescue cannot use --fresh with --session-id; choose one session source");
  }
}

async function resolveRescueSession(options, cwd) {
  if (options.sessionId?.trim()) {
    return {
      sessionId: options.sessionId.trim(),
      mode: "explicit",
      resumedFromJobId: null
    };
  }
  if (options.resume) {
    const stateDir = resolveStateDir(options.stateDir);
    const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
    const job = selectResumableJob(jobs, cwd);
    if (!job) {
      throw new Error(
        `No resumable Claude rescue session found for ${cwd}. Run a fresh rescue first, or omit --resume.`
      );
    }
    return {
      sessionId: job.claudeSessionId,
      mode: "resume",
      resumedFromJobId: job.id
    };
  }
  return {
    sessionId: randomUUID(),
    mode: options.fresh ? "fresh" : "new",
    resumedFromJobId: null
  };
}

function selectResumableJob(jobs, cwd) {
  return jobs
    .filter((job) => {
      if (job.kind !== "rescue" || !job.claudeSessionId) {
        return false;
      }
      if (!RESUMABLE_JOB_STATUSES.has(job.status)) {
        return false;
      }
      return normalizeJobWorkspace(job) === cwd;
    })
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))[0];
}

function normalizeJobWorkspace(job) {
  const workspace = job.workspaceRoot || job.cwd;
  return workspace ? path.resolve(workspace) : "";
}

function parseClaudeStream(stdout) {
  const parsedEvents = [];
  const malformedLines = [];
  const text = [];
  let finalText = "";
  let modelUsage = null;

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

    const candidateModelUsage = extractModelUsageFromEvent(event);
    if (candidateModelUsage) {
      modelUsage = candidateModelUsage;
    }
  }

  return {
    text,
    finalText,
    eventCount: parsedEvents.length,
    malformedLineCount: malformedLines.length,
    malformedLines,
    ...(modelUsage ? { modelUsage } : {})
  };
}

function extractModelUsageFromEvent(event) {
  const candidates = [
    event.modelUsage,
    event.model_usage,
    event.usage,
    event.raw?.modelUsage,
    event.raw?.model_usage,
    event.stream_event?.modelUsage,
    event.stream_event?.model_usage,
    event.stream_event?.usage,
    event.stream_event?.raw?.modelUsage,
    event.event?.modelUsage,
    event.event?.model_usage,
    event.event?.usage,
    event.event?.raw?.modelUsage
  ];

  return candidates.find((candidate) => isPlainObject(candidate)) ?? null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractTextFromEvent(event) {
  const candidates = [
    event.delta?.text,
    event.text,
    event.content_delta?.text,
    event.message?.content,
    event.stream_event?.delta?.text,
    event.stream_event?.text,
    event.stream_event?.event?.delta?.text,
    event.stream_event?.event?.text,
    event.stream_event?.content_delta?.text,
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
    event.stream_event?.event?.message?.content,
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
  if (result.wait) {
    lines.push(`Claude ${result.job.kind} job ${result.job.id}: ${result.status}`);
    lines.push(`Session: ${result.job.claudeSessionId || "unknown"} (${result.job.sessionMode || "unknown"})`);
    if (result.job.resumedFromJobId) {
      lines.push(`Resumed from job: ${result.job.resumedFromJobId}`);
    }
    if (result.status === "timed_out") {
      lines.push(`Wait timed out after ${result.wait.timeoutMs}ms.`);
      lines.push(`Result: ${result.job.resultPath}`);
      lines.push(`Next: node scripts/claude-companion.mjs result --job-id ${result.job.id}`);
      return lines.join("\n");
    }
    if (result.result) {
      lines.push("", result.result.trimEnd());
    } else {
      lines.push("", result.job.summary || "No result is available.");
    }
    return lines.join("\n");
  }
  if (result.job && result.status === "running") {
    const productMode = result.productMode ? ` (${result.productMode})` : "";
    lines.push(`Started Claude ${result.job.kind} job ${result.job.id}${productMode}`);
    lines.push(`Status: ${result.job.status}`);
    lines.push(`Session: ${result.job.claudeSessionId || "unknown"} (${result.job.sessionMode || "unknown"})`);
    if (result.job.resumedFromJobId) {
      lines.push(`Resumed from job: ${result.job.resumedFromJobId}`);
    }
    lines.push(`Result: ${result.job.resultPath}`);
    return lines.join("\n");
  }
  lines.push(`Claude ${result.productMode || result.kind || "rescue"} ${result.status}.`);
  lines.push(`Session: ${result.sessionId || "unknown"} (${result.sessionMode || "unknown"})`);
  if (result.resumedFromJobId) {
    lines.push(`Resumed from job: ${result.resumedFromJobId}`);
  }
  lines.push("");
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
  const lines = ["Claude jobs"];
  for (const job of result.jobs) {
    lines.push("", `[${job.status}] ${job.id} (${job.kind})`);
    if (job.summary) {
      lines.push(`  Summary: ${job.summary}`);
    }
    lines.push(`  Session: ${job.claudeSessionId || "unknown"}`);
    lines.push(`  ${formatJobRuntime(job)}`);
    if (job.exitCode !== null && job.exitCode !== undefined) {
      lines.push(`  Exit: ${job.exitCode}`);
    }
    if (job.signal) {
      lines.push(`  Signal: ${job.signal}`);
    }
    if (job.modelUsage) {
      lines.push(`  Model usage: ${formatModelUsage(job.modelUsage)}`);
    }
    lines.push(`  Updated: ${job.updatedAt || "unknown"}`);
    lines.push(`  Result: ${job.nextCommands.result}`);
    if (job.nextCommands.cancel) {
      lines.push(`  Cancel: ${job.nextCommands.cancel}`);
    }
  }
  return lines.join("\n");
}

function renderHumanResult(result) {
  const lines = [
    `Job: ${result.job.id}`,
    `Status: ${result.job.status}`,
    `Kind: ${result.job.kind}`,
    `Session: ${result.job.claudeSessionId || "unknown"}`,
    formatJobRuntime(result.job)
  ];
  if (result.job.cwd) {
    lines.push(`Cwd: ${result.job.cwd}`);
  }
  if (result.job.createdAt) {
    lines.push(`Created: ${result.job.createdAt}`);
  }
  if (result.job.updatedAt) {
    lines.push(`Updated: ${result.job.updatedAt}`);
  }
  if (result.job.exitCode !== null && result.job.exitCode !== undefined) {
    lines.push(`Exit: ${result.job.exitCode}`);
  }
  if (result.job.signal) {
    lines.push(`Signal: ${result.job.signal}`);
  }
  if (result.job.modelUsage) {
    lines.push(`Model usage: ${formatModelUsage(result.job.modelUsage)}`);
  }
  lines.push(`Result command: ${result.job.nextCommands.result}`);
  if (result.job.nextCommands.cancel) {
    lines.push(`Cancel command: ${result.job.nextCommands.cancel}`);
  }
  lines.push("");
  lines.push(result.result || "No result is available yet.");
  return lines.join("\n");
}

function formatJobRuntime(job) {
  return [
    `Model: ${job.model || "unknown"}`,
    `Effort: ${job.effort || "default"}`,
    `Permission: ${job.permissionMode || "unknown"}`,
    `Isolation: ${job.isolation || "unknown"}`
  ].join(" | ");
}

function formatModelUsage(modelUsage) {
  return Object.keys(modelUsage)
    .sort()
    .map((key) => `${key}=${formatModelUsageValue(modelUsage[key])}`)
    .join(", ");
}

function formatModelUsageValue(value) {
  if (isPlainObject(value)) {
    return JSON.stringify(sortObjectKeys(value));
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function sortObjectKeys(value) {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, isPlainObject(value[key]) ? sortObjectKeys(value[key]) : value[key]])
  );
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
  await mkdir(path.join(stateDir, PERMISSIONS_DIR), { recursive: true });
}

function jobsPath(stateDir) {
  return path.join(stateDir, JOBS_FILE);
}

function permissionsDir(stateDir) {
  return path.join(stateDir, PERMISSIONS_DIR);
}

function permissionProposalPath(stateDir, proposalId) {
  return path.join(permissionsDir(stateDir), `${proposalId}.json`);
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

async function startBackgroundRescue({ options, cwd, model, effort, permissionMode, session }) {
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
    claudeSessionId: session.sessionId,
    sessionMode: session.mode,
    resumedFromJobId: session.resumedFromJobId,
    runnerPid: null,
    childPid: null,
    model,
    effort,
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
    job: await decorateJobForOutput(updatedJob)
  };
}

async function waitForBackgroundJob({ stateDir, jobId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error(`Job not found while waiting: ${jobId}`);
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      const result = await readJobResult(job);
      return {
        ok: job.status === "completed",
        status: job.status,
        job: await decorateJobForOutput(job),
        result,
        wait: {
          timedOut: false,
          timeoutMs
        }
      };
    }
    await delay(WAIT_POLL_INTERVAL_MS);
  }

  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    throw new Error(`Job not found while waiting: ${jobId}`);
  }
  return {
    ok: false,
    status: "timed_out",
    job: await decorateJobForOutput(job),
    result: await readJobResult(job),
    wait: {
      timedOut: true,
      timeoutMs
    }
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
    effort: job.effort,
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
  const persistedResult =
    resultText || (status === "failed" ? formatRescueFailure(invocation, stream) : "");

  await writeFile(job.logPath, invocation.stdout, "utf8");
  await writeFile(job.stderrPath, invocation.stderr, "utf8");
  await writeFile(job.resultPath, persistedResult, "utf8");
  await writeFile(
    job.sessionPath,
    `${JSON.stringify(
      {
        claudeSessionId: job.claudeSessionId,
        stream,
        ...(stream.modelUsage ? { modelUsage: stream.modelUsage } : {})
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await patchJob(stateDir, job.id, {
    status,
    childPid: null,
    exitCode: invocation.exitCode,
    signal: invocation.signal,
    summary,
    ...(stream.modelUsage ? { modelUsage: stream.modelUsage } : {})
  });
}

function formatRescueFailure(invocation, stream) {
  const lines = ["Claude rescue failed before producing a final assistant result."];
  const reason = firstLine(invocation.stderr) || firstLine(invocation.stdout);
  if (reason) {
    lines.push("", `Reason: ${reason}`);
  }
  if (stream.malformedLineCount > 0) {
    lines.push("", `Malformed Claude stream lines: ${stream.malformedLineCount}`);
  }
  if (invocation.exitCode !== null) {
    lines.push(`Exit code: ${invocation.exitCode}`);
  }
  if (invocation.signal) {
    lines.push(`Signal: ${invocation.signal}`);
  }
  if (invocation.stderr.trim()) {
    lines.push("", "Claude stderr:", invocation.stderr.trim());
  }
  return `${lines.join("\n")}\n`;
}

async function runStatus(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 20;
  const selectedJobs = jobs
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
  return {
    ok: true,
    stateDir,
    jobs: await Promise.all(selectedJobs.map((job) => decorateJobForOutput(job)))
  };
}

async function runResult(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const job = selectJob(jobs, options.jobId);
  if (!job) {
    throw new Error("No Claude jobs found");
  }
  const result = await readJobResult(job);
  return {
    ok: job.status === "completed" || result.length > 0,
    job: await decorateJobForOutput(job),
    result
  };
}

async function readJobResult(job) {
  let result = "";
  try {
    result = await readFile(job.resultPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return result;
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
      job: await decorateJobForOutput(job)
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
        job: await decorateJobForOutput(cancellingJob)
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
    job: await decorateJobForOutput(cancelledJob)
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

async function decorateJobForOutput(job) {
  const safeJob = sanitizeJob(job);
  const sessionMetadata = await readJobSessionMetadata(safeJob);
  const modelUsage =
    safeJob.modelUsage || sessionMetadata?.modelUsage || sessionMetadata?.stream?.modelUsage;
  if (modelUsage) {
    safeJob.modelUsage = modelUsage;
  }
  safeJob.nextCommands = buildNextCommands(safeJob);
  return safeJob;
}

async function readJobSessionMetadata(job) {
  if (!job.sessionPath) {
    return null;
  }
  try {
    const metadata = JSON.parse(await readFile(job.sessionPath, "utf8"));
    return isPlainObject(metadata) ? metadata : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildNextCommands(job) {
  const commands = {
    result: `node scripts/claude-companion.mjs result --job-id ${job.id}`
  };
  if (job.status === "running" || job.status === "cancelling") {
    commands.cancel = `node scripts/claude-companion.mjs cancel --job-id ${job.id}`;
  }
  return commands;
}

async function runPermissions(options, rest) {
  const action = rest[0];
  if (action === "analyze") {
    return runPermissionsAnalyze(options);
  }
  if (action === "show") {
    return runPermissionsShow(options);
  }
  if (action === "export") {
    return runPermissionsExport(options);
  }
  throw new Error("permissions requires one of: analyze, show, export");
}

async function runPermissionsAnalyze(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const jobs = await refreshStaleJobs(stateDir, await readJobs(stateDir));
  const selectedJobs = await selectPermissionJobs(jobs, options);
  if (selectedJobs.length === 0) {
    throw new Error(options.jobId ? `Job not found: ${options.jobId}` : "No Claude jobs found");
  }

  const extracted = [];
  for (const job of selectedJobs) {
    extracted.push(...(await extractPermissionCandidatesFromJob(job)));
  }
  const candidates = mergePermissionCandidates(extracted);
  const workspaceRoot =
    selectedJobs[0]?.workspaceRoot || selectedJobs[0]?.cwd || (await resolveCwd(options.cwd));
  const proposalId = `perm-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const proposal = {
    version: 1,
    id: proposalId,
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    sourceJobs: selectedJobs.map((job) => job.id),
    approved: false,
    approvalRequired: true,
    candidates,
    candidateCount: candidates.length
  };

  await writePermissionProposal(stateDir, proposal);
  return {
    ok: true,
    status: "completed",
    stateDir,
    proposalPath: permissionProposalPath(stateDir, proposalId),
    proposal,
    nextCommands: buildPermissionNextCommands(proposalId)
  };
}

async function selectPermissionJobs(jobs, options) {
  if (options.jobId) {
    const job = jobs.find((candidate) => candidate.id === options.jobId);
    return job ? [job] : [];
  }
  const cwd = await resolveCwd(options.cwd);
  return jobs.filter((job) => normalizeJobWorkspace(job) === cwd);
}

async function extractPermissionCandidatesFromJob(job) {
  if (!job.logPath) {
    return [];
  }
  let logText;
  try {
    logText = await readFile(job.logPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates = [];
  const lines = logText.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      event = null;
    }
    if (event) {
      candidates.push(...extractPermissionCandidatesFromEvent(event, job, index + 1));
      continue;
    }
    candidates.push(...extractPermissionCandidatesFromText(line, job, index + 1, "log_text"));
  }
  return candidates;
}

function extractPermissionCandidatesFromEvent(event, job, lineNumber) {
  const eventText = JSON.stringify(event);
  if (!PERMISSION_TEXT_PATTERN.test(eventText)) {
    return [];
  }

  const candidates = [];
  const explicitPatterns = extractToolPatterns(eventText);
  for (const pattern of explicitPatterns) {
    candidates.push(buildPermissionCandidate({ pattern, job, lineNumber, sourceType: event.type || "event" }));
  }

  for (const pattern of extractStructuredToolPatterns(event)) {
    candidates.push(buildPermissionCandidate({ pattern, job, lineNumber, sourceType: event.type || "event" }));
  }

  if (candidates.length > 0) {
    return candidates;
  }
  return extractPermissionCandidatesFromText(eventText, job, lineNumber, event.type || "event");
}

function extractPermissionCandidatesFromText(text, job, lineNumber, sourceType) {
  if (!PERMISSION_TEXT_PATTERN.test(text)) {
    return [];
  }
  return extractToolPatterns(text).map((pattern) =>
    buildPermissionCandidate({ pattern, job, lineNumber, sourceType })
  );
}

function extractToolPatterns(text) {
  return [...new Set(text.match(TOOL_PATTERN) ?? [])];
}

function extractStructuredToolPatterns(value) {
  const patterns = new Set();
  walkPlainObject(value, (node) => {
    const toolName = firstStringField(node, ["toolName", "tool_name", "tool", "name"]);
    const command = firstStringField(node, ["command", "cmd"]);
    if (toolName && command && /^bash$/i.test(toolName)) {
      patterns.add(`Bash(${command})`);
    } else if (toolName && isKnownToolName(toolName)) {
      patterns.add(toolName);
    }
    for (const key of ["pattern", "allowedTool", "allowed_tool", "permission"]) {
      const value = node[key];
      if (typeof value === "string") {
        for (const pattern of extractToolPatterns(value)) {
          patterns.add(pattern);
        }
      }
    }
  });
  return [...patterns];
}

function walkPlainObject(value, visit) {
  if (!isPlainObject(value)) {
    return;
  }
  visit(value);
  for (const child of Object.values(value)) {
    if (isPlainObject(child)) {
      walkPlainObject(child, visit);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        walkPlainObject(item, visit);
      }
    }
  }
}

function firstStringField(object, keys) {
  for (const key of keys) {
    if (typeof object[key] === "string" && object[key].trim()) {
      return object[key].trim();
    }
  }
  return "";
}

function isKnownToolName(value) {
  return /^(Bash|Read|Edit|Write|Glob|Grep|LS|WebFetch|WebSearch|Task|TodoWrite|NotebookRead|NotebookEdit)$/i.test(
    value
  );
}

function buildPermissionCandidate({ pattern, job, lineNumber, sourceType }) {
  const normalizedPattern = normalizePermissionPattern(pattern);
  const risk = classifyPermissionRisk(normalizedPattern);
  return {
    kind: "tool",
    pattern: normalizedPattern,
    risk,
    rationale: permissionRationale(normalizedPattern, risk),
    confidence: normalizedPattern === pattern ? "high" : "medium",
    sourceJobIds: [job.id],
    sourceSessions: job.claudeSessionId ? [job.claudeSessionId] : [],
    sources: [
      {
        jobId: job.id,
        logPath: job.logPath,
        type: sourceType,
        line: lineNumber
      }
    ]
  };
}

function normalizePermissionPattern(pattern) {
  const trimmed = pattern.trim().replace(/\s+/g, " ");
  const bashMatch = trimmed.match(/^Bash\((.*)\)$/);
  if (!bashMatch) {
    return trimmed;
  }
  return `Bash(${bashMatch[1].trim()})`;
}

function classifyPermissionRisk(pattern) {
  const bashCommand = extractBashCommand(pattern);
  if (bashCommand && DESTRUCTIVE_COMMAND_PATTERN.test(bashCommand)) {
    return "high";
  }
  if (/\b(secret|token|credential|keychain|\.env)\b/i.test(pattern)) {
    return "high";
  }
  if (/^(Read|Glob|Grep|LS)\b/.test(pattern)) {
    return "low";
  }
  if (bashCommand && READ_ONLY_COMMAND_PATTERN.test(bashCommand)) {
    return "low";
  }
  if (bashCommand) {
    return "medium";
  }
  return "medium";
}

function extractBashCommand(pattern) {
  const match = pattern.match(/^Bash\((.*)\)$/);
  return match ? match[1].trim() : "";
}

function permissionRationale(pattern, risk) {
  if (risk === "high") {
    return `Potentially sensitive or destructive permission pattern observed: ${pattern}`;
  }
  if (risk === "low") {
    return `Narrow read-only or project-check permission pattern observed: ${pattern}`;
  }
  return `Narrow permission pattern observed: ${pattern}`;
}

function mergePermissionCandidates(candidates) {
  const byPattern = new Map();
  for (const candidate of candidates) {
    const existing = byPattern.get(candidate.pattern);
    if (!existing) {
      byPattern.set(candidate.pattern, candidate);
      continue;
    }
    existing.sourceJobIds = mergeSorted(existing.sourceJobIds, candidate.sourceJobIds);
    existing.sourceSessions = mergeSorted(existing.sourceSessions, candidate.sourceSessions);
    existing.sources = [...existing.sources, ...candidate.sources].sort(comparePermissionSources);
    existing.confidence = mergeConfidence(existing.confidence, candidate.confidence);
    existing.risk = mergeRisk(existing.risk, candidate.risk);
    existing.rationale = permissionRationale(existing.pattern, existing.risk);
  }
  return [...byPattern.values()].sort((left, right) => left.pattern.localeCompare(right.pattern));
}

function mergeSorted(left, right) {
  return [...new Set([...left, ...right])].sort();
}

function comparePermissionSources(left, right) {
  return (
    left.jobId.localeCompare(right.jobId) ||
    String(left.logPath).localeCompare(String(right.logPath)) ||
    left.line - right.line
  );
}

function mergeConfidence(left, right) {
  if (left === "high" || right === "high") {
    return "high";
  }
  return left || right || "medium";
}

function mergeRisk(left, right) {
  const order = ["low", "medium", "high"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? "medium";
}

async function writePermissionProposal(stateDir, proposal) {
  await ensureStateDir(stateDir);
  await writeFile(
    permissionProposalPath(stateDir, proposal.id),
    `${JSON.stringify(proposal, null, 2)}\n`,
    "utf8"
  );
}

async function readPermissionProposal(stateDir, proposalId) {
  if (!proposalId?.trim()) {
    throw new Error("permissions show/export requires --proposal-id <id>");
  }
  const proposal = JSON.parse(await readFile(permissionProposalPath(stateDir, proposalId), "utf8"));
  if (!isPlainObject(proposal) || proposal.version !== 1 || !Array.isArray(proposal.candidates)) {
    throw new Error(`Invalid permission proposal: ${proposalId}`);
  }
  return proposal;
}

async function runPermissionsShow(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const proposal = await readPermissionProposal(stateDir, options.proposalId);
  return {
    ok: true,
    status: "completed",
    stateDir,
    proposalPath: permissionProposalPath(stateDir, proposal.id),
    proposal,
    nextCommands: buildPermissionNextCommands(proposal.id)
  };
}

async function runPermissionsExport(options) {
  const stateDir = resolveStateDir(options.stateDir);
  const proposal = await readPermissionProposal(stateDir, options.proposalId);
  const format = options.format || "allowed-tools";
  if (format !== "allowed-tools") {
    throw new Error(`Unsupported permissions export format: ${format}`);
  }
  if (proposal.approved !== true) {
    throw new Error(
      `Permission proposal ${proposal.id} is not approved. Review and edit the proposal file to set "approved": true before export.`
    );
  }
  const allowedTools = proposal.candidates
    .map((candidate) => candidate.pattern)
    .filter(Boolean)
    .sort();
  return {
    ok: true,
    status: "completed",
    stateDir,
    proposalPath: permissionProposalPath(stateDir, proposal.id),
    proposalId: proposal.id,
    format,
    allowedTools,
    argv: allowedTools.length > 0 ? ["--allowedTools", ...allowedTools] : []
  };
}

function buildPermissionNextCommands(proposalId) {
  return {
    show: `node scripts/claude-companion.mjs permissions show --proposal-id ${proposalId}`,
    export: `node scripts/claude-companion.mjs permissions export --proposal-id ${proposalId} --format allowed-tools`
  };
}

function renderHumanPermissions(result) {
  if (result.format === "allowed-tools") {
    return renderHumanPermissionsExport(result);
  }
  return renderHumanPermissionsProposal(result);
}

function renderHumanPermissionsProposal(result) {
  const proposal = result.proposal;
  const lines = [
    `Permission proposal: ${proposal.id}`,
    `Workspace: ${proposal.workspaceRoot}`,
    `Approved: ${proposal.approved === true ? "yes" : "no"}`,
    `Candidates: ${proposal.candidateCount ?? proposal.candidates.length}`,
    `Path: ${result.proposalPath}`
  ];
  if (proposal.candidates.length === 0) {
    lines.push("", "No permission candidates found.");
  } else {
    for (const candidate of proposal.candidates) {
      lines.push(
        "",
        `[${candidate.risk}] ${candidate.pattern}`,
        `  Confidence: ${candidate.confidence}`,
        `  Jobs: ${candidate.sourceJobIds.join(", ")}`,
        `  Rationale: ${candidate.rationale}`
      );
    }
  }
  if (result.nextCommands) {
    lines.push("", `Show: ${result.nextCommands.show}`, `Export: ${result.nextCommands.export}`);
  }
  return lines.join("\n");
}

function renderHumanPermissionsExport(result) {
  if (result.allowedTools.length === 0) {
    return "No allowed tools to export.";
  }
  return [
    `Permission proposal: ${result.proposalId}`,
    "Allowed tools:",
    ...result.allowedTools.map((tool) => `- ${tool}`),
    "",
    "Arguments:",
    result.argv.map((arg) => JSON.stringify(arg)).join(" ")
  ].join("\n");
}

function runCommand(command, args, { cwd, input = null } = {}) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let child;

    try {
      child = spawn(command, args, {
        cwd,
        stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"]
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

    if (input !== null) {
      child.stdin.end(input);
    }
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

function buildReviewPrompt({ diff, base, mode = "review" }) {
  const target = base ? `the diff from ${base}...HEAD` : "the uncommitted working tree diff";
  const basePrompt = [
    `Review ${target} and return structured output.`,
    "",
    "Each finding must include: title, severity, file, line, description, recommendation.",
    "Severity must be one of: critical, high, medium, low, info.",
    "Only report actionable correctness, regression, security, data loss, or missing-test risks.",
    "",
    "Diff:",
    diff
  ];

  if (mode === "adversarial-review") {
    return [
      `Adversarially review ${target} and return structured output.`,
      "",
      "Each finding object must include title, severity, file, line, description, and recommendation.",
      "Severity must be one of: critical, high, medium, low, info.",
      "Look for subtle concrete failure modes and weak assumptions. Do not invent issues.",
      "",
      "Diff:",
      diff
    ].join("\n");
  }

  return basePrompt.join("\n");
}

async function runClaudeReview({ cwd, prompt, model, effort, schema }) {
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
    ...(effort ? ["--effort", effort] : []),
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
  const effort = normalizeEffort(options.effort);
  const mode = options.adversarial ? "adversarial-review" : "review";
  const maxDiffBytes =
    Number.isFinite(options.maxDiffBytes) && options.maxDiffBytes > 0
      ? options.maxDiffBytes
      : DEFAULT_REVIEW_MAX_DIFF_BYTES;
  const diffResult = await collectGitDiff({ cwd, base: options.base });
  const diffBytes = Buffer.byteLength(diffResult.diff, "utf8");
  if (!diffResult.diff.trim()) {
    return {
      ok: true,
      status: "empty_diff",
      mode,
      cwd,
      base: options.base,
      model,
      effort,
      findings: [],
      summary: options.base
        ? `No changes found in diff ${options.base}...HEAD.`
        : "No uncommitted changes found to review.",
      diffCommand: diffResult.command,
      diffBytes,
      maxDiffBytes
    };
  }
  if (diffBytes > maxDiffBytes) {
    throw new Error(
      `Review diff is too large for a single Claude review (${diffBytes} bytes, limit ${maxDiffBytes}). Use --base to narrow the diff, commit or stage smaller chunks, or raise --max-diff-bytes if you explicitly want to send a larger diff.`
    );
  }

  const { path: schemaPath, schema } = await loadReviewSchema(options.schema);
  const prompt = buildReviewPrompt({
    diff: diffResult.diff,
    base: options.base,
    mode
  });
  const invocation = await runClaudeReview({
    cwd,
    prompt,
    model,
    effort,
    schema
  });
  if (!invocation.ok) {
    throw new Error(`Claude review failed: ${summarizeClaudeFailure(invocation)}`);
  }
  const parsed = parseReviewResponse(invocation.stdout);
  return {
    ok: true,
    status: "completed",
    mode,
    cwd,
    base: options.base,
    model,
    effort,
    permissionMode: "plan",
    schemaPath,
    diffCommand: diffResult.command,
    diffBytes,
    maxDiffBytes,
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

async function runHookStopReview(options) {
  const hookInput = await readHookInput();
  const cwd = await resolveHookCwd(options.cwd, hookInput);
  const enabled = await isStopReviewHookEnabled(cwd);
  const blocking = isTruthy(process.env.CLAUDE_COMPANION_STOP_REVIEW_BLOCKING);
  const mode = isTruthy(process.env.CLAUDE_COMPANION_STOP_REVIEW_ADVERSARIAL)
    ? "adversarial-review"
    : "review";

  if (!enabled) {
    return {
      ok: true,
      status: "disabled",
      kind: "hook-stop-review",
      cwd,
      blocking,
      summary:
        "Claude Stop review hook is installed but disabled. Set CLAUDE_COMPANION_STOP_REVIEW=1 or create .codex/claude-stop-review.enabled to enable it."
    };
  }

  try {
    const review = await runReview({
      ...options,
      cwd,
      base: process.env.CLAUDE_COMPANION_STOP_REVIEW_BASE || options.base,
      model: process.env.CLAUDE_COMPANION_STOP_REVIEW_MODEL || options.model,
      effort: process.env.CLAUDE_COMPANION_STOP_REVIEW_EFFORT || options.effort,
      adversarial: mode === "adversarial-review"
    });
    const blockingFindings = review.findings.filter((finding) =>
      BLOCKING_SEVERITIES.has(finding.severity)
    );
    const shouldBlock = blocking && blockingFindings.length > 0;
    return {
      ok: !shouldBlock,
      status: shouldBlock ? "blocked" : review.status,
      kind: "hook-stop-review",
      cwd,
      blocking,
      blockingSeverities: [...BLOCKING_SEVERITIES],
      blockingFindings,
      review
    };
  } catch (error) {
    return {
      ok: true,
      status: "hook_error",
      kind: "hook-stop-review",
      cwd,
      blocking,
      error: error instanceof Error ? error.message : String(error),
      summary: "Claude Stop review hook failed; Codex should continue."
    };
  }
}

async function readHookInput() {
  if (process.stdin.isTTY) {
    return {};
  }
  let stdin = "";
  for await (const chunk of process.stdin) {
    stdin += chunk;
  }
  if (!stdin.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(stdin);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {
      rawInput: stdin
    };
  }
}

async function resolveHookCwd(rawCwd, hookInput) {
  const candidate =
    rawCwd ||
    hookInput.cwd ||
    hookInput.workspaceRoot ||
    hookInput.workspace_root ||
    hookInput.projectRoot ||
    hookInput.project_root ||
    process.env.CLAUDE_COMPANION_HOOK_CWD ||
    process.env.PWD ||
    process.cwd();
  return resolveCwd(candidate);
}

async function isStopReviewHookEnabled(cwd) {
  if (isTruthy(process.env.CLAUDE_COMPANION_STOP_REVIEW)) {
    return true;
  }
  return fileExists(path.join(cwd, STOP_REVIEW_ENABLE_FILE));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

function renderHumanHookStopReview(result) {
  if (result.status === "disabled") {
    return "";
  }
  if (result.status === "hook_error") {
    return result.summary;
  }
  const renderedReview = renderHumanReview(result.review);
  if (result.status === "blocked") {
    return [`Claude Stop review found blocking findings.`, "", renderedReview].join("\n");
  }
  return renderedReview;
}

async function main() {
  const { command, options, rest } = parseArgs(process.argv.slice(2));

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

  if (command === "plan") {
    const result = await runPlan(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanRescue(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "ui" || command === "design") {
    const result = await runUi(options);
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

  if (command === "permissions") {
    const result = await runPermissions(options, rest);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanPermissions(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "review" || command === "adversarial-review") {
    if (command === "adversarial-review") {
      options.adversarial = true;
    }
    const result = await runReview(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanReview(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "hook-stop-review") {
    const result = await runHookStopReview(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHumanHookStopReview(result));
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
