import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createECDH, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import webpush from 'web-push';
import { createReminderHandler, trustedPushEndpoint } from '../supabase/functions/_shared/push-worker.mjs';

function setup() {
  const vapid = webpush.generateVAPIDKeys();
  const ec = createECDH('prime256v1'); ec.generateKeys();
  const job = { delivery_id: randomUUID(), lease_token: randomUUID(), task_id: randomUUID(), subscription_id: randomUUID(), user_id: randomUUID(),
    kind: 'before', due_at: new Date(Date.now() + 600000).toISOString(), endpoint: 'https://web.push.apple.com/fixture', p256dh: ec.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), private_title: 'Não enviar título privado' };
  const calls = [], deleted = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'claim_task_notifications' ? [job] : true }; },
    from: (name) => { assert.equal(name, 'task_push_subscriptions'); return { delete: () => ({ eq: async (column, id) => { deleted.push({ column, id }); return {}; } }) }; } };
  const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://lista.example/', NOTIFICATION_CRON_SECRET: 'fixture-'.repeat(8), PUBLIC_APP_URL: 'https://lista.example/' };
  return { job, db, env, calls, deleted };
}
const post = (env) => new Request('https://worker.example/', { method: 'POST', headers: { 'x-cron-secret': env.NOTIFICATION_CRON_SECRET } });

test('somente endpoints de provedores push HTTPS são aceitos', () => {
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://internal.example/x', 'https://web.push.apple.com.evil/x', 'https://user:pass@web.push.apple.com/x', 'https://web.push.apple.com:444/x']) assert.equal(trustedPushEndpoint(endpoint), false);
  for (const endpoint of ['https://web.push.apple.com/x', 'https://fcm.googleapis.com/x', 'https://updates.push.services.mozilla.com/x', 'https://wns2.notify.windows.com/x']) assert.equal(trustedPushEndpoint(endpoint), true);
});

test('configuração expõe só chave pública e cron exige autorização', async () => {
  const fixture = setup(); const handler = createReminderHandler({ ...fixture, send: async () => {} });
  const config = await handler(new Request('https://worker.example/', { headers: { Origin: 'https://lista.example' } }));
  assert.equal(config.status, 200); assert.equal(config.headers.get('Access-Control-Allow-Origin'), 'https://lista.example');
  const body = await config.text(); assert.ok(body.includes(fixture.env.VAPID_PUBLIC_KEY)); assert.ok(!body.includes(fixture.env.VAPID_PRIVATE_KEY)); assert.ok(!body.includes(fixture.env.NOTIFICATION_CRON_SECRET));
  assert.equal((await handler(new Request('https://worker.example/', { method: 'POST' }))).status, 401);
  assert.equal((await handler(new Request('https://worker.example/', { headers: { Origin: 'https://outro.example' } }))).status, 403);
  assert.equal(fixture.calls.filter((c) => c.name === 'claim_task_notifications').length, 0);
});

test('envio usa criptografia Web Push real e só confirma após sucesso', async () => {
  const fixture = setup(); let details, payload;
  const handler = createReminderHandler({ ...fixture, send: async (subscription, body, options) => { payload = JSON.parse(body); details = webpush.generateRequestDetails(subscription, body, options); } });
  const result = await handler(post(fixture.env));
  assert.deepEqual(await result.json(), { sent: 1, failed: 0, expired: 0 });
  assert.ok(details.body.length > 0); assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(payload.user_id, fixture.job.user_id); assert.equal(payload.subscription_id, fixture.job.subscription_id);
  assert.ok(!JSON.stringify(payload).includes(fixture.job.private_title));
  assert.equal(fixture.calls.at(-1).args.p_sent, true);
});

test('assinatura expirada é removida e falha transitória é reenfileirada', async () => {
  const expired = setup();
  const handler = createReminderHandler({ ...expired, send: async () => { throw { statusCode: 410 }; } });
  assert.deepEqual(await (await handler(post(expired.env))).json(), { sent: 0, failed: 0, expired: 1 });
  assert.equal(expired.deleted[0].id, expired.job.subscription_id);
  const retry = setup();
  const failing = createReminderHandler({ ...retry, send: async () => { throw { statusCode: 429 }; } });
  assert.deepEqual(await (await failing(post(retry.env))).json(), { sent: 0, failed: 1, expired: 0 });
  assert.equal(retry.calls.at(-1).args.p_sent, false); assert.equal(retry.calls.at(-1).args.p_status, 429);
});

test('destino não permitido e configuração incompleta nunca enviam push', async () => {
  const fixture = setup(); fixture.job.endpoint = 'https://127.0.0.1/private'; let sends = 0;
  const handler = createReminderHandler({ ...fixture, send: async () => { sends++; } });
  assert.deepEqual(await (await handler(post(fixture.env))).json(), { sent: 0, failed: 1, expired: 0 });
  assert.equal(sends, 0);
  const missing = createReminderHandler({ db: fixture.db, send: async () => { sends++; }, env: {} });
  assert.equal((await missing(new Request('https://worker.example/'))).status, 503); assert.equal(sends, 0);
});

test('worker do navegador ignora outra conta e abre apenas tarefas da conta vinculada', async () => {
  const fixture = setup(); const handlers = {}, shown = [], opened = [];
  let owner = { enabled: true, user_id: fixture.job.user_id, subscription_id: fixture.job.subscription_id };
  const self = { location: { origin: 'https://lista.example' }, addEventListener: (name, fn) => { handlers[name] = fn; }, registration: { showNotification: async (...args) => shown.push(args) },
    clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) } };
  vm.runInNewContext(await readFile(new URL('../static/sw.js', import.meta.url), 'utf8'), { self, importScripts() {}, URL, MinhaListaPushState: { read: async () => owner } });
  async function event(name, data) { let result; handlers[name]({ ...data, waitUntil: (promise) => { result = promise; } }); await result; }
  const payload = { ...fixture.job, tag: fixture.job.delivery_id, body: 'Não exibir conteúdo injetado', url: 'https://outro.example/' };
  await event('push', { data: { json: () => payload } }); assert.equal(shown.length, 1); assert.ok(!shown[0][1].body.includes('injetado'));
  owner = { ...owner, user_id: randomUUID() };
  await event('push', { data: { json: () => payload } }); assert.equal(shown.length, 1);
  await event('notificationclick', { notification: { data: payload, close() {} } }); assert.equal(opened.at(-1), 'https://lista.example/');
  owner = { enabled: true, user_id: payload.user_id, subscription_id: payload.subscription_id };
  await event('notificationclick', { notification: { data: payload, close() {} } });
  assert.equal(new URL(opened.at(-1)).origin, 'https://lista.example'); assert.equal(new URL(opened.at(-1)).searchParams.get('task'), payload.task_id);
});
