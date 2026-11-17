import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(await readFile(new URL('../supabase/01_criar_tarefas.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/02_notificacoes.sql', import.meta.url), 'utf8'));
  return db;
}

test('SQL real: RLS, horários, dispositivos do dono, leases e deduplicação', async () => {
  const db = await database();
  try {
    const a = randomUUID(), b = randomUUID(), task = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [a,b]);
    for (const [user, endpoint] of [[a,'a'],[b,'b']]) {
      await db.query("insert into public.task_push_subscriptions(user_id,endpoint,p256dh,auth,created_at) values ($1,$2,$3,$4,now()-interval '1 day')", [user,`https://web.push.apple.com/${endpoint}`,'A'.repeat(87),'A'.repeat(22)]);
    }
    await db.query("insert into public.tasks(id,user_id,text,due_at,created_at) values ($1,$2,'Compromisso',now()+interval '10 minutes'-interval '10 seconds',now()-interval '1 day')", [task,a]);
    await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[b]);
    const rows = await db.query('select user_id from public.task_push_subscriptions');
    assert.equal(rows.rows.length,1); assert.equal(rows.rows[0].user_id,b);
    await assert.rejects(() => db.query('select * from public.claim_task_notifications()'), /permission denied/);
    await db.exec('reset role; set role service_role');
    let jobs = (await db.query('select * from public.claim_task_notifications()')).rows;
    assert.equal(jobs.length,1); assert.equal(jobs[0].kind,'before'); assert.equal(jobs[0].user_id,a);
    assert.equal((await db.query('select * from public.claim_task_notifications()')).rows.length,0);
    const first = jobs[0];
    assert.equal((await db.query('select public.finish_task_notification($1,$2,true,201) as ok',[first.delivery_id,randomUUID()])).rows[0].ok,false);
    assert.equal((await db.query('select public.finish_task_notification($1,$2,true,201) as ok',[first.delivery_id,first.lease_token])).rows[0].ok,true);
    assert.equal((await db.query('select * from public.claim_task_notifications()')).rows.length,0);
    await db.exec('reset role');
    await db.query("update public.tasks set due_at=now()-interval '10 seconds' where id=$1",[task]);
    await db.exec('set role service_role');
    jobs=(await db.query('select * from public.claim_task_notifications()')).rows;
    assert.equal(jobs.length,1); assert.equal(jobs[0].kind,'due');
    let retry=jobs[0];
    for(let attempt=1;attempt<3;attempt++) {
      await db.query('select public.finish_task_notification($1,$2,false,503)',[retry.delivery_id,retry.lease_token]);
      await db.query("update public.task_notification_deliveries set lease_until=now()-interval '1 second' where id=$1",[retry.delivery_id]);
      const next=(await db.query('select * from public.claim_task_notifications()')).rows;
      assert.equal(next.length,1); assert.notEqual(next[0].lease_token,retry.lease_token); retry=next[0];
    }
    await db.query('select public.finish_task_notification($1,$2,false,503)',[retry.delivery_id,retry.lease_token]);
    await db.query("update public.task_notification_deliveries set lease_until=now()-interval '1 second' where id=$1",[retry.delivery_id]);
    assert.equal((await db.query('select * from public.claim_task_notifications()')).rows.length,0);
    await db.exec('reset role');
    await db.query("update public.tasks set completed=true,due_at=now()+interval '10 minutes'-interval '5 seconds' where id=$1",[task]);
    assert.equal((await db.query('select * from public.claim_task_notifications()')).rows.length,0);
    await db.query('update public.tasks set completed=false where id=$1',[task]);
    assert.equal((await db.query('select * from public.claim_task_notifications()')).rows.length,1);
  } finally { await db.close(); }
});

test('SQL de agendamento: guarda segredo no Vault e ativa somente um job', async () => {
  const db = await database();
  try {
    assert.equal((await db.query('select public.task_notification_scheduler_ready() as ready')).rows[0].ready,false);
    // Contratos das extensões são simulados; funções PL/pgSQL rodam no PostgreSQL real (WASM).
    await db.exec(`create schema vault; create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text);
      create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
      create function vault.create_secret(s text,n text,d text) returns uuid language sql as $$ insert into vault.secrets(name,secret) values(n,s) returning id $$;
      create function vault.update_secret(i uuid,s text,n text,d text) returns void language sql as $$ update vault.secrets set name=n,secret=s where id=i $$;
      create schema cron; create table cron.job(jobid serial primary key,jobname text,schedule text,command text,active boolean default true);
      create function cron.schedule(n text,s text,c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid::bigint $$;
      create function cron.unschedule(i integer) returns boolean language plpgsql as $$ begin delete from cron.job where jobid=i; return true; end $$;
      create schema net; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;`);
    const sql=(await readFile(new URL('../supabase/03_agendamento_notificacoes.sql', import.meta.url),'utf8')).replace(/^create extension .*;\n/gm,'');
    await db.exec(sql);
    const secret='chave-ficticia-para-teste-'.repeat(3);
    await db.query('select public.configure_task_notification_schedule($1,$2)',['https://fixture.supabase.co',secret]);
    await db.query('select public.configure_task_notification_schedule($1,$2)',['https://fixture.supabase.co',secret]);
    const jobs=(await db.query('select * from cron.job')).rows;
    assert.equal(jobs.length,1); assert.equal(jobs[0].schedule,'* * * * *'); assert.ok(!jobs[0].command.includes(secret));
    assert.ok(jobs[0].command.includes('/functions/v1/task-reminders')); await db.exec(jobs[0].command);
    assert.equal((await db.query('select public.task_notification_scheduler_ready() as ready')).rows[0].ready,true);
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('select public.configure_task_notification_schedule($1,$2)',['https://fixture.supabase.co',secret]), /permission denied/);
  } finally { await db.close(); }
});
