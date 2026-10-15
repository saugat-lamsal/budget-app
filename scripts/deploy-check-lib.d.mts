// Types for scripts/deploy-check-lib.mjs, so its tests are type-checked.
export const APP: string;
export const CHECK_COMMAND: string;
export const WORKS: string;

export interface FlyAnswer {
  readonly code: number;
  readonly out: string;
  readonly stdout?: string;
}

export function labelFor(now: Date): string;

export function deployCheck(input: {
  readonly run: (args: readonly string[]) => Promise<FlyAnswer>;
  readonly say: (line: string) => void;
  readonly app?: string;
  readonly label: string;
}): Promise<{ readonly ok: boolean; readonly lastLine: string; readonly image: string }>;
