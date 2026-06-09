#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hookDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(hookDir, "..", "scripts", "claude-companion.mjs");
const child = spawn(process.execPath, [scriptPath, "hook-stop-review", ...process.argv.slice(2)], {
  stdio: "inherit"
});

child.on("exit", (exitCode, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(exitCode ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
