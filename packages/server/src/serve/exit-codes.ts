// How the server command (serve.mjs) ends, for whatever started it: on Fly.io
// the supervisor (start.ts), which tells him what to do about each.
export const EXIT = {
  // Stopped when asked to (Ctrl+C, or a stop from Fly).
  stopped: 0,
  // Something went wrong that is not one of the below.
  failed: 1,
  // It could not start: a setting or a key is missing or wrong. It says which.
  didNotStart: 2,
  // The history no longer replays to the totals saved with it (0.6): it
  // stays stopped until npm run replay-check is run (A28, A30).
  historyDoesNotReplay: 3,
} as const;
