// Rule 0.8 (QUESTIONS.md A57): when the phone cannot reach the app's server
// as it opens a screen, the service worker (sw.ts) answers with one fixed page
// built in here, instead of the blank screen a home-screen app shows (Oct 16,
// 2026: Fly restarted its hosts and the app was black for 16 minutes).
//
// - Only for opening a screen of the app: a page navigation on the app's own
//   address, never its numbers (/api), its health checks, or Plaid's webhook,
//   and never a request a screen makes. Those go to the server as always.
// - Only when the server cannot be reached: the request fails, no answer
//   comes within 15 seconds, or the host answers that the server is not
//   running (Fly's proxy: 502, 503, 504). Any other answer is the server's own
//   and is shown as it came.
// - The page is fixed: no number, nothing from the server, no script, nothing
//   from anywhere else. Nothing is kept on the phone for it.

export const NO_ANSWER_MS = 15_000;

// What the host (Fly's proxy) answers when the server is not running.
const NOT_RUNNING: ReadonlySet<number> = new Set([502, 503, 504]);

// The app's own addresses that are not screens.
const NOT_SCREENS = /^\/(api|health|plaid)(\/|$)|^\/sw\.js$/;

export const OFFLINE_WORDS = {
  title: "Can't reach the app right now.",
  body: 'Your money is safe; the server is offline or restarting. Try again in a few minutes.',
  again: 'Try again',
} as const;

// A navigation it answers when the server cannot be reached.
export function handlesNavigation(url: URL, origin: string): boolean {
  return url.origin === origin && !NOT_SCREENS.test(url.pathname);
}

export function showOffline(answer: { readonly status: number } | 'failed' | 'no-answer'): boolean {
  return answer === 'failed' || answer === 'no-answer' || NOT_RUNNING.has(answer.status);
}

// The app's look, written out here: the page cannot load the app's styles when
// the server cannot be reached. Light and dark follow the phone; the text
// follows the phone's text size; the notch and the home bar are left clear;
// Try again is at least 44 points.
const STYLE = `
:root { color-scheme: light dark; --bg: #f2f2f7; --surface: #ffffff; --text: #111114; --text-2: #5c5c63; --accent: #2459d6; --on-accent: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #000000; --surface: #1c1c1e; --text: #f5f5f7; --text-2: #a3a3aa; --accent: #6f9dff; --on-accent: #0a1430; } }
html { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; font-size: 106.25%; line-height: 1.35; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@supports (font: -apple-system-body) { html { font: -apple-system-body; } }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }
main { box-sizing: border-box; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: calc(env(safe-area-inset-top) + 1.5rem) calc(env(safe-area-inset-right) + 1rem) calc(env(safe-area-inset-bottom) + 1.5rem) calc(env(safe-area-inset-left) + 1rem); }
.box { box-sizing: border-box; width: 100%; max-width: 28rem; background: var(--surface); border-radius: 14px; padding: 1.5rem; text-align: center; }
h1 { font-size: 1.25rem; line-height: 1.25; margin: 0 0 0.75rem; overflow-wrap: anywhere; }
p { font-size: 1rem; color: var(--text-2); margin: 0 0 1.5rem; overflow-wrap: anywhere; }
a { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 0.625rem 1.5rem; border-radius: 10px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 1rem; text-decoration: none; }
a:focus-visible { outline: 3px solid var(--text); outline-offset: 2px; }
`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Budget</title>
<style>${STYLE}</style>
</head>
<body>
<main data-testid="offline">
<div class="box" role="alert">
<h1>${OFFLINE_WORDS.title}</h1>
<p>${OFFLINE_WORDS.body}</p>
<a href="" data-testid="offline-again">${OFFLINE_WORDS.again}</a>
</div>
</main>
</body>
</html>
`;

// The page, made new for each answer (a Response is read once).
export function offlinePage(): Response {
  return new Response(PAGE, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Its own style only: no script, nothing from anywhere.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
