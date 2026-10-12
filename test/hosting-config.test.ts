import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LITESTREAM } from '../scripts/litestream.mjs';

// Phase 6: the hosting files, read as text. fly.toml: one small machine with
// one volume near New York, never more, always on, https only, the health
// check. The Dockerfile: pinned images, the same Litestream as the tests use,
// nothing secret. .dockerignore: no keys or books sent to the builder.

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fly = read('fly.toml');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

// fly.toml without its comments.
const settings = fly
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter((line) => line !== '');

function value(key: string, section: string | null = null): string | undefined {
  let current: string | null = null;
  for (const line of settings) {
    const head = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (head !== null) {
      current = head[1] ?? null;
      continue;
    }
    const m = /^([\w.]+)\s*=\s*(.+)$/.exec(line);
    if (m !== null && m[1] === key && current === section) return m[2]?.replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}

describe('Phase 6 fly.toml', () => {
  it('Phase 6 one small machine in Secaucus, near New York, with one volume for the books', () => {
    expect(value('primary_region')).toBe('ewr');
    expect(value('size', 'vm')).toBe('shared-cpu-1x');
    expect(value('memory', 'vm')).toBe('512mb');
    expect(value('source', 'mounts')).toBe('budget_data');
    expect(value('destination', 'mounts')).toBe('/data');
    expect(value('initial_size', 'mounts')).toBe('1gb');
    expect(value('BUDGET_DB', 'env')).toBe('/data/budget.sqlite');
    expect(settings.filter((l) => l === '[[vm]]' || l === '[mounts]' || l === '[http_service]')).toEqual(['[mounts]', '[http_service]', '[[vm]]']);
  });

  it('Phase 6 only ever one machine: always on, never stopped for being idle, nothing that adds one, and a deploy replaces it in place', () => {
    expect(value('auto_stop_machines', 'http_service')).toBe('off');
    expect(value('min_machines_running', 'http_service')).toBe('1');
    expect(value('strategy', 'deploy')).toBe('rolling');
    // No autoscaling, no second process group, no count.
    expect(settings.join('\n')).not.toMatch(/autoscal|\[processes\]|max_machines|bluegreen|canary/i);
  });

  it('Phase 6 the free fly.dev address, https only: APP_ORIGIN is the app\'s own name there', () => {
    const app = value('app');
    expect(app).toMatch(/^[a-z0-9-]+$/);
    expect(value('APP_ORIGIN', 'env')).toBe(`https://${app ?? ''}.fly.dev`);
    expect(value('force_https', 'http_service')).toBe('true');
    expect(value('internal_port', 'http_service')).toBe('8080');
    expect(value('PORT', 'env')).toBe('8080');
  });

  it('Phase 6 Fly checks the health address; it stops the machine with SIGTERM and gives it a minute', () => {
    expect(value('path', 'http_service.checks')).toBe('/health');
    expect(value('method', 'http_service.checks')).toBe('GET');
    expect(value('kill_signal')).toBe('SIGTERM');
    expect(value('kill_timeout')).toBe('60s');
  });

  it("Phase 6 Plaid's test bank only, and no key in the file", () => {
    expect(value('PLAID_ENV', 'env')).toBe('sandbox');
    const env = settings.slice(settings.indexOf('[env]') + 1, settings.findIndex((l, i) => i > settings.indexOf('[env]') && l.startsWith('[')));
    expect(env.map((l) => l.split('=')[0]?.trim()).sort()).toEqual(['APP_ORIGIN', 'BUDGET_DB', 'PLAID_ENV', 'PORT']);
  });
});

describe('Phase 6 the Dockerfile', () => {
  it('Phase 6 both stages are Node 22, pinned to the exact image', () => {
    const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    expect(froms).toHaveLength(2);
    for (const from of froms) expect(from).toMatch(/^node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/);
    expect(new Set(froms).size).toBe(1);
  });

  it('Phase 6 the same Litestream as the tests use, checked against its SHA-256', () => {
    const file = LITESTREAM.files['linux-x64'];
    expect(dockerfile).toContain(`ADD --checksum=sha256:${file.sha256} https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM.version}/${file.name} /tmp/litestream.tar.gz`);
  });

  it('Phase 6 it runs the supervisor, with the screens and litestream.yml where the server looks', () => {
    expect(dockerfile).toMatch(/^CMD \["node", "\/app\/serve\/start\.mjs"\]$/m);
    expect(dockerfile).toContain('COPY litestream.yml /etc/litestream.yml');
    expect(dockerfile).toContain('ENV WEB_ROOT=/app/web');
    expect(dockerfile).toContain('ENV LITESTREAM_CONFIG=/etc/litestream.yml');
    expect(dockerfile).toContain('RUN node scripts/build.mjs && npm prune --omit=dev');
  });

  it('Phase 6 no key in the image: no secret ARG or ENV, and the builder is never sent .env, the books, or data', () => {
    for (const line of dockerfile.split('\n').filter((l) => /^(ARG|ENV)\b/.test(l))) expect(line).not.toMatch(/KEY|SECRET|TOKEN|PLAID|VAPID|R2_|PASSWORD/i);
    const ignored = dockerignore.split('\n').map((l) => l.trim());
    for (const path of ['.env', '.env.*', 'data/', '*.sqlite', '*.sqlite-wal', 'node_modules/', '.git/']) expect(ignored, path).toContain(path);
  });
});
