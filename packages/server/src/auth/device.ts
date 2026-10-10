// What a device is called in the change log and on Settings (Step 2): the
// browser and the system, in words, from what the browser says it is. Only
// so he can tell his devices apart; nothing depends on it.

export function deviceOf(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux|X11/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  return system === null || browser === null ? 'A browser' : `${browser} on ${system}`;
}
