// Section 2 (QUESTIONS.md A47): where Plaid sends its webhooks, and the most
// one may be (Plaid's are a few hundred bytes). Nothing else here: the web
// server names the address (the demo's too), and the demo never loads the
// bank connection.
export const WEBHOOK_PATH = '/plaid/webhook';
export const WEBHOOK_BODY_LIMIT = 8_192;
