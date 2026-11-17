export function trustedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port &&
      (host === 'fcm.googleapis.com' || host.endsWith('.push.apple.com') || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createReminderHandler({ db, send, env }) {
  const appOrigin = new URL(env.PUBLIC_APP_URL || 'https://lista-de-tarefa-omega.vercel.app/').origin;
  return async (request) => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origin === appOrigin) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (origin && origin !== appOrigin) return reply(403, { error: 'Origem não autorizada.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!db || !/^[\w-]{87}$/.test(env.VAPID_PUBLIC_KEY || '') || !/^[\w-]{43}$/.test(env.VAPID_PRIVATE_KEY || '') || (env.NOTIFICATION_CRON_SECRET || '').length < 32 || !env.VAPID_SUBJECT) {
      return reply(503, { error: 'O serviço de notificações ainda precisa ser configurado.' });
    }
    if (request.method === 'GET') {
      try {
        const result = await db.rpc('task_notification_scheduler_ready');
        if (result.error) throw new Error();
        return reply(200, { ready: result.data === true, publicKey: env.VAPID_PUBLIC_KEY });
      } catch { return reply(503, { error: 'O agendamento de notificações ainda não está disponível.' }); }
    }
    if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
    if (!sameSecret(request.headers.get('x-cron-secret'), env.NOTIFICATION_CRON_SECRET)) return reply(401, { error: 'Não autorizado.' });
    let jobs;
    try {
      const result = await db.rpc('claim_task_notifications', { p_limit: 20 });
      if (result.error || !Array.isArray(result.data)) throw new Error();
      jobs = result.data;
    } catch { return reply(503, { error: 'Não foi possível consultar os avisos agendados.' }); }
    const counts = { sent: 0, failed: 0, expired: 0 };
    async function finish(job, sent, status) {
      const result = await db.rpc('finish_task_notification', { p_delivery_id: job.delivery_id, p_lease_token: job.lease_token, p_sent: sent, p_status: status });
      if (result.error || result.data !== true) throw new Error('Não foi possível confirmar o envio.');
    }
    async function process(job) {
      try {
        if (![job.delivery_id, job.lease_token, job.task_id, job.subscription_id, job.user_id].every((id) => typeof id === 'string' && uuid.test(id)) ||
            !['before', 'due'].includes(job.kind) || !Number.isFinite(Date.parse(job.due_at)) ||
            !trustedPushEndpoint(job.endpoint) || !/^[\w-]{87}$/.test(job.p256dh) || !/^[\w-]{22}$/.test(job.auth)) {
          await finish(job, false, 400); counts.failed++; return;
        }
        // Avisos discretos: título/anotações da tarefa não são enviados à tela bloqueada.
        const payload = JSON.stringify({ title: 'Minha lista',
          body: job.kind === 'before' ? 'Uma tarefa começa em dez minutos.' : 'Chegou o horário de uma tarefa.',
          task_id: job.task_id, user_id: job.user_id, subscription_id: job.subscription_id,
          kind: job.kind, due_at: job.due_at, tag: job.delivery_id });
        await send({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, payload, {
          TTL: 300, timeout: 10000, urgency: 'high', topic: job.delivery_id.replaceAll('-', ''),
          vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
        });
        await finish(job, true, 201); counts.sent++;
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) && error.statusCode >= 100 && error.statusCode <= 599 ? error.statusCode : 503;
        if ([404, 410].includes(status)) {
          try {
            const result = await db.from('task_push_subscriptions').delete().eq('id', job.subscription_id);
            if (result.error) throw new Error();
            counts.expired++;
          } catch { counts.failed++; }
        } else {
          try { await finish(job, false, status); } catch { /* A concessão expira e permite nova tentativa. */ }
          counts.failed++;
        }
      }
    }
    for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(process));
    return reply(200, counts);
  };
}
