// Rulebook section 1: four Bank of America accounts on one connection.
export type AccountId = 'checking' | 'savings' | 'everyday-card' | 'old-card';

export const ACCOUNTS: readonly AccountId[] = Object.freeze(['checking', 'savings', 'everyday-card', 'old-card']);
