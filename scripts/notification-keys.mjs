import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = new URL('../', import.meta.url);
const directory = new URL('.notifications-local/', root);
const config = JSON.parse(await readFile(new URL('static/cloud-config.json', root), 'utf8'));
const projectUrl = config.url || config.supabaseUrl;
const appUrl = new URL(config.appUrl).origin;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(projectUrl)) throw new Error('URL do Supabase inválida.');
try {
  await access(directory);
  throw new Error('A pasta .notifications-local já existe. Preserve as chaves atuais; não gere outras para o mesmo serviço.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const keys = webpush.generateVAPIDKeys();
const secret = randomBytes(32).toString('hex');
await mkdir(directory, { mode: 0o700 });
await writeFile(new URL('.env', directory), [
  `PUBLIC_APP_URL=${appUrl}`,
  `VAPID_SUBJECT=${appUrl}`,
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  `NOTIFICATION_CRON_SECRET=${secret}`, '',
].join('\n'), { mode: 0o600, flag: 'wx' });
await writeFile(new URL('ATIVAR_AGENDAMENTO.sql', directory),
  `-- Contém uma chave privada de agendamento. Use somente no SQL Editor do seu projeto.\nselect public.configure_task_notification_schedule('${projectUrl.replace(/\/$/, '')}', '${secret}');\n`,
  { mode: 0o600, flag: 'wx' });
console.log(`Arquivos privados criados em ${fileURLToPath(directory)}. Não compartilhe nem adicione ao Git.\nSiga supabase/ATIVAR_NOTIFICACOES.md para ativar o serviço.`);
