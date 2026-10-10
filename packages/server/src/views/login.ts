// What Settings shows about logging in (Step 2), on the real server only: the
// demo has no login. Types only, shared with the phone.

export interface LoginView {
  // How long he stays logged in on a device (section 2).
  readonly stayLoggedInDays: number;
  // His passkeys: where each was made, and when (an instant, ISO).
  readonly passkeys: readonly { readonly device: string; readonly createdAt: string }[];
  // This device, in words.
  readonly thisDevice: string;
}

// What the login page asks first: whether this device is logged in, and
// whether any passkey exists yet (if not, the one-time code makes the first).
export interface AuthState {
  readonly loggedIn: boolean;
  readonly passkeys: boolean;
}
