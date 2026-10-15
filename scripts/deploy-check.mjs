#!/usr/bin/env node
// npm run deploy-check (QUESTIONS.md A50a): run before every fly deploy.
// Builds the new image on Fly, rebuilds the real books from the backup with
// it on a throwaway machine, and replays every event (0.6). Deploy only when
// it ends with "The backup works." Steps and why: scripts/deploy-check-lib.mjs.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deployCheck, labelFor } from './deploy-check-lib.mjs';

const local = join(homedir(), '.fly', 'bin', process.platform === 'win32' ? 'flyctl.exe' : 'flyctl');
const flyctl = process.env.FLYCTL ?? (existsSync(local) ? local : 'flyctl');

// Runs flyctl, showing what it says as it says it, and keeps it.
function run(args) {
  return new Promise((resolve) => {
    const child = spawn(flyctl, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let out = '';
    let stdout = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
      stdout += c.toString();
      process.stdout.write(c);
    });
    child.stderr.on('data', (c) => {
      out += c.toString();
      process.stderr.write(c);
    });
    child.on('error', (error) => resolve({ code: 127, out: `${out}\n${error.message}`, stdout }));
    child.on('close', (code) => resolve({ code: code ?? 1, out, stdout }));
  });
}

const result = await deployCheck({ run, say: (line) => console.log(line), label: labelFor(new Date()) });
console.log('');
console.log(result.ok ? `Deploy check passed: ${result.lastLine} Safe to run: fly deploy --ha=false --remote-only` : `Deploy check FAILED: ${result.lastLine} Do not deploy.`);
process.exitCode = result.ok ? 0 : 1;
