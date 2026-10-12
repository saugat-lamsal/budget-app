// Types for scripts/server-build.mjs, for the tests that build the server's commands.
export declare const COMMANDS: Readonly<Record<string, string>>;
export declare function path(p: string): string;
export declare function buildServer(outDir?: string): Promise<void>;
export declare function runCommand(name: string, args: readonly string[]): void;
export declare function runBuilt(file: string, args: readonly string[], env?: Record<string, string>): void;
