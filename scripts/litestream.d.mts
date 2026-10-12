// Types for scripts/litestream.mjs, for the tests that read its pins.
export interface LitestreamFile {
  readonly name: string;
  readonly sha256: string;
}

export declare const LITESTREAM: {
  readonly version: string;
  readonly files: Readonly<Record<'win32-x64' | 'win32-arm64' | 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64', LitestreamFile>>;
};

export declare function litestreamPath(): string;
export declare function installLitestream(): Promise<string>;
