-- Executar depois de 01_criar_tarefas.sql. Não apaga tarefas ou configurações.
begin;

create table if not exists public.task_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    endpoint text not null check (length(endpoint) between 1 and 2048 and endpoint like 'https://%'),
    p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
    auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
    created_at timestamptz not null default now(),
    unique (user_id, endpoint)
);
alter table public.task_push_subscriptions enable row level security;
alter table public.task_push_subscriptions force row level security;
revoke all on public.task_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.task_push_subscriptions to authenticated;
grant all on public.task_push_subscriptions to service_role;
drop policy if exists task_push_own on public.task_push_subscriptions;
create policy task_push_own on public.task_push_subscriptions for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.task_notification_deliveries (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.tasks(id) on delete cascade,
    subscription_id uuid not null references public.task_push_subscriptions(id) on delete cascade,
    kind text not null check (kind in ('before', 'due')),
    due_at timestamptz not null,
    scheduled_at timestamptz not null,
    attempts integer not null default 0,
    lease_until timestamptz,
    lease_token uuid,
    sent_at timestamptz,
    last_status integer,
    constraint task_notification_delivery_unique unique (task_id, subscription_id, kind, due_at)
);
alter table public.task_notification_deliveries enable row level security;
alter table public.task_notification_deliveries force row level security;
revoke all on public.task_notification_deliveries from public, anon, authenticated;
grant all on public.task_notification_deliveries to service_role;
create index if not exists task_notification_pending_idx on public.task_notification_deliveries (scheduled_at)
    where sent_at is null;

create or replace function public.claim_task_notifications(p_limit integer default 20)
returns table (delivery_id uuid, lease_token uuid, task_id uuid, subscription_id uuid,
               user_id uuid, kind text, due_at timestamptz, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
begin
    if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Limite de lote inválido'; end if;
    insert into public.task_notification_deliveries (task_id, subscription_id, kind, due_at, scheduled_at)
    select t.id, s.id, k.kind, t.due_at,
           case when k.kind = 'before' then t.due_at - interval '10 minutes' else t.due_at end
    from public.tasks t
    join public.task_push_subscriptions s on s.user_id = t.user_id
    cross join (values ('before'), ('due')) as k(kind)
    where t.completed = false and t.due_at is not null
      and (case when k.kind = 'before' then t.due_at - interval '10 minutes' else t.due_at end)
          between now() - interval '5 minutes' and now()
      and s.created_at <= (case when k.kind = 'before' then t.due_at - interval '10 minutes' else t.due_at end)
      and t.created_at <= (case when k.kind = 'before' then t.due_at - interval '10 minutes' else t.due_at end)
    on conflict on constraint task_notification_delivery_unique do nothing;

    return query
    with picked as (
        select d.id
        from public.task_notification_deliveries d
        join public.tasks t on t.id = d.task_id
        join public.task_push_subscriptions s on s.id = d.subscription_id and s.user_id = t.user_id
        where d.sent_at is null and d.attempts < 3
          and (d.lease_until is null or d.lease_until < now())
          and d.scheduled_at between now() - interval '5 minutes' and now()
          and t.completed = false and t.due_at = d.due_at
        order by d.scheduled_at, d.id
        for update of d skip locked limit p_limit
    ), claimed as (
        update public.task_notification_deliveries d
        set lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes', attempts = d.attempts + 1
        from picked where d.id = picked.id returning d.*
    )
    select d.id, d.lease_token, d.task_id, d.subscription_id, s.user_id,
           d.kind, d.due_at, s.endpoint, s.p256dh, s.auth
    from claimed d join public.task_push_subscriptions s on s.id = d.subscription_id;
end;
$$;
revoke all on function public.claim_task_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_task_notifications(integer) to service_role;

create or replace function public.finish_task_notification(p_delivery_id uuid, p_lease_token uuid,
                                                          p_sent boolean, p_status integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
    update public.task_notification_deliveries d
       set sent_at = case when p_sent then now() else null end,
           lease_until = case when p_sent then null else now() + interval '30 seconds' end,
           last_status = p_status
     where d.id = p_delivery_id and d.lease_token = p_lease_token and d.sent_at is null;
    get diagnostics changed = row_count;
    return changed > 0;
end;
$$;
revoke all on function public.finish_task_notification(uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.finish_task_notification(uuid, uuid, boolean, integer) to service_role;

create or replace function public.task_notification_scheduler_ready()
returns boolean language plpgsql security definer set search_path = '' as $$
declare configured boolean;
begin
    if to_regclass('cron.job') is null then return false; end if;
    execute 'select exists (select 1 from cron.job where jobname = ''minha-lista-task-reminders'' and active)'
        into configured;
    return configured;
end;
$$;
revoke all on function public.task_notification_scheduler_ready() from public, anon, authenticated;
grant execute on function public.task_notification_scheduler_ready() to service_role;
commit;
