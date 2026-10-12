// npm run push-keys
//
// Phase 5: makes the app's own key pair for web push (VAPID), for .env. Put
// the three lines it prints in .env (which git ignores), with your own
// contact address for VAPID_SUBJECT, then start npm run serve again. The
// private key stays in .env and on the server: it is never sent to a phone,
// and nothing in the app prints it. A new pair makes every phone's
// subscription stop working: turn notifications on again on each one.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('Put these in .env (never in git):');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   (your own address, for the push services)');
