import { describe, expect, it } from 'vitest';
import { NO_ANSWER_MS, OFFLINE_WORDS, handlesNavigation, offlinePage, showOffline } from '../src/sw/offline.js';

// Rule 0.8 (QUESTIONS.md A57): when the phone cannot reach the app's server
// as it opens a screen, the app's background part shows one fixed page built
// into the app instead of a blank screen. Only for opening a screen of the
// app; only when there is no answer within 15 seconds, the request fails, or
// the host says the server is not running; never a number, nothing from the
// server, nothing kept.

const ORIGIN = 'https://budget.example';

describe('0.8 when the app cannot be reached', () => {
  it('0.8 it is for opening a screen of the app only: not its numbers, not the health checks, not Plaid, not another site', () => {
    for (const path of ['/', '/home', '/buckets', '/buckets/needs', '/review', '/settings', '/status', '/payday', '/alerts', '/bank', '/login', '/setup/bank']) {
      expect(handlesNavigation(new URL(path, ORIGIN), ORIGIN), path).toBe(true);
    }
    for (const path of ['/api/home', '/api/status', '/api', '/health', '/health/backups', '/plaid/webhook', '/sw.js']) {
      expect(handlesNavigation(new URL(path, ORIGIN), ORIGIN), path).toBe(false);
    }
    expect(handlesNavigation(new URL('https://cdn.plaid.com/link'), ORIGIN)).toBe(false);
    expect(handlesNavigation(new URL('http://budget.example/home'), ORIGIN)).toBe(false);
  });

  it('0.8 the plain page shows when the request fails, gets no answer, or the host says the server is not running; any other answer is the server\'s own', () => {
    expect(showOffline('failed')).toBe(true);
    expect(showOffline('no-answer')).toBe(true);
    for (const status of [502, 503, 504]) expect(showOffline({ status }), String(status)).toBe(true);
    for (const status of [200, 301, 304, 308, 400, 401, 403, 404, 421, 500, 501, 505]) expect(showOffline({ status }), String(status)).toBe(false);
    expect(NO_ANSWER_MS).toBe(15_000);
  });

  it('0.8 one fixed page, in the rulebook\'s words, with Try again, and nothing else: no numbers, no scripts, nothing from elsewhere', async () => {
    expect(OFFLINE_WORDS).toEqual({
      title: "Can't reach the app right now.",
      body: 'Your money is safe; the server is offline or restarting. Try again in a few minutes.',
      again: 'Try again',
    });
    const page = offlinePage();
    expect(page.status).toBe(503);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-store');
    const policy = page.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toMatch(/script-src|connect-src|https?:/);
    const html = await page.text();
    expect(html).toContain(`<h1>${OFFLINE_WORDS.title}</h1>`);
    expect(html).toContain(OFFLINE_WORDS.body);
    expect(html).toContain(`>${OFFLINE_WORDS.again}</a>`);
    // Try again opens the same screen again.
    expect(html).toMatch(/<a [^>]*href=""[^>]*>Try again<\/a>/);
    expect(html).not.toMatch(/<script|<img|<link|<iframe|src=|https?:\/\//i);
    // No amounts, and no numbers but the page's own layout.
    expect(html).not.toContain('$');
    const words = html.replace(/<style>[\s\S]*<\/style>/, '').replace(/<[^>]+>/g, ' ');
    expect(words).not.toMatch(/\d/);
    // Light and dark, the notch and the home bar, and the phone's text size.
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('env(safe-area-inset-top)');
    expect(html).toContain('env(safe-area-inset-bottom)');
    expect(html).toContain('-apple-system-body');
    // The same page every time.
    expect(await offlinePage().text()).toBe(html);
  });
});
