const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.from('AppSettings').upsert({key: 'wallet_enabled', value: 'false'}).then((data) => console.log('Success:', data)).catch(console.error);
