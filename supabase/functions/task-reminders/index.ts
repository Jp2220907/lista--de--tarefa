import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import webpush from 'npm:web-push@3.6.7';
import { createReminderHandler } from '../_shared/push-worker.mjs';

const env = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_APP_URL', 'VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'NOTIFICATION_CRON_SECRET'].map((name) => [name, Deno.env.get(name) || '']));
// As credenciais privilegiadas são injetadas pelo Supabase, nunca pelo navegador.
const db = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
Deno.serve(createReminderHandler({ db, send: webpush.sendNotification.bind(webpush), env }));
