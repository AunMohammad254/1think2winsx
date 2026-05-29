import webpush from 'web-push';

console.log('Generating VAPID Keypair...');
const vapidKeys = webpush.generateVAPIDKeys();

console.log('\n==================================================');
console.log('COPY THESE TO YOUR .env AND .env.production FILES:');
console.log('==================================================\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${vapidKeys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${vapidKeys.privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:contact@1think2wins.com"\n`);
console.log('==================================================');
