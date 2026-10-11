// Types for scripts/break-it-lib.mjs, so the tests of the tool are type-checked.
export const BACKUP_SUFFIX: string;
export function defaultWorkDir(): string;
export function defaultWorkers(): number;

export interface BreakSpec {
  readonly section: string | number;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  readonly why: string;
}

export interface Options {
  restore: boolean;
  only: string | undefined;
  match: RegExp | undefined;
  file: RegExp | undefined;
  workers: number | undefined;
  sections: string[];
}

export function parseArgs(argv: readonly string[]): Options;
export const BREAK_LISTS: readonly string[];
export function loadBreaks(root: string, lists: readonly string[]): BreakSpec[];
// The breaks whose text is not in their file exactly once; found is null when the file is gone.
export function staleBreaks(root: string, breaks: readonly BreakSpec[]): (BreakSpec & { readonly found: number | null })[];
export function selectBreaks(breaks: readonly BreakSpec[], options: Pick<Options, 'sections' | 'match' | 'file'>): BreakSpec[];
export function restoreLeftovers(root: string, breaks: readonly BreakSpec[], log?: (line: string) => void): string[];
export function removeStaleRuns(root: string, workDir: string, log?: (line: string) => void): void;
export function needsBrowsers(b: BreakSpec): boolean;

export interface Workspace {
  readonly dir: string;
  readonly links: string[];
  readonly tmp: string;
}

export interface TestRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  // Stopped after the time limit, still running.
  timedOutAfterMs?: number;
}

export interface TestRequest {
  readonly workspace: Workspace;
  readonly withBrowsers: boolean;
  readonly threads: number | undefined;
}

export type TestRunner = (request: TestRequest) => Promise<TestRun>;

export function runCommand(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeLimitMs?: number }): Promise<TestRun>;
export function vitestRunner(options: { only: string | undefined; timeLimitMs?: number }): TestRunner;
export const TIME_LIMIT_MS: number;
export const MEMORY_CAP_MB: number;

export interface BreakResult extends BreakSpec {
  outcome: string;
}

export function runBreakIt(options: {
  root: string;
  breaks: readonly BreakSpec[];
  workers: number;
  runTests: TestRunner;
  workDir?: string;
  progress?: (done: number, total: number, result: BreakResult) => void;
  log?: (line: string) => void;
}): Promise<{ results: BreakResult[]; control?: undefined } | { results?: undefined; control: TestRun }>;

export function formatResults(results: readonly BreakResult[]): { text: string; ok: boolean };
