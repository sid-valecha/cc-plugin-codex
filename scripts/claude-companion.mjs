#!/usr/bin/env node
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;
const AUTH_FAILURE_PATTERN =
  /\b(not\s+(logged|authenticated)|logged\s+out|unauthenticated|no\s+valid|invalid\s+auth|login\s+required)\b/i;

const INSTALL_GUIDANCE = [
  "Install Claude Code with `npm install -g @anthropic-ai/claude-code`.",
  "After installing, run `claude install stable` to select the stable channel."
];

const AUTH_GUIDANCE = [
  "Authenticate interactively with `claude auth login`.",
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

function parseArgs(argv) {
  const options = {
    json: false,
    help: false
  };
  let command = null;
  const rest = [];

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
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

function usage() {
  return [
    "Usage: node scripts/claude-companion.mjs <subcommand> [options]",
    "",
    "Implemented subcommands:",
    "  setup     Check local Node, npm, Claude Code, and Claude auth status.",
    "",
    "Options:",
    "  --json    Emit machine-readable JSON."
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

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (options.help || command === null) {
    console.log(usage());
    process.exit(command === null ? 1 : 0);
  }

  if (command !== "setup") {
    console.error(`Unknown subcommand: ${command}`);
    console.error(usage());
    process.exit(1);
  }

  const result = await runSetup();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderHumanSetup(result));
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
