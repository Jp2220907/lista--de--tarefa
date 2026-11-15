-- Minha lista: estrutura inicial para um projeto novo do Supabase.
-- Execute UMA VEZ no SQL Editor. Nenhuma senha ou chave é necessária aqui.
-- Se public.tasks já existir, a transação falha sem substituir ou apagar dados.

begin;

create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    text text not null check (char_length(btrim(text)) between 1 and 500),
    notes text not null default '' check (char_length(notes) <= 5000),
    completed boolean not null default false,
    due_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index tasks_user_created_idx on public.tasks (user_id, created_at, id);
create index tasks_user_due_idx on public.tasks (user_id, due_at)
    where completed = false and due_at is not null;

alter table public.tasks enable row level security;
alter table public.tasks force row level security;

-- A chave pública, sozinha, não permite ler ou escrever tarefas.
revoke all on table public.tasks from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.tasks to authenticated;
grant insert (id, text, notes, completed, due_at, created_at)
    on table public.tasks to authenticated;
grant update (text, notes, completed, due_at)
    on table public.tasks to authenticated;

create policy tasks_select_own on public.tasks
    for select to authenticated
    using ((select auth.uid()) = user_id);

create policy tasks_insert_own on public.tasks
    for insert to authenticated
    with check ((select auth.uid()) = user_id);

create policy tasks_update_own on public.tasks
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

-- O aplicativo ainda não oferece exclusão: não concedemos DELETE.
-- O proprietário, identificador e data de criação não podem ser alterados
-- pela conta autenticada. A data de atualização é gerada pelo banco.
create function public.minha_lista_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at := clock_timestamp();
    return new;
end;
$$;

revoke all on function public.minha_lista_touch_updated_at() from public;

create trigger tasks_touch_updated_at
before update on public.tasks
for each row execute function public.minha_lista_touch_updated_at();

comment on table public.tasks is
    'Minha lista: tarefas privadas por conta. Migração inicial 01.';

commit;

-- Resultado esperado: tabela = tasks, rls_ativa = true, rls_forcada = true,
-- politicas = 3, acesso_anonimo = false. Não retorna dados de usuários.
select
    c.relname as tabela,
    c.relrowsecurity as rls_ativa,
    c.relforcerowsecurity as rls_forcada,
    (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'tasks') as politicas,
    has_table_privilege('anon', 'public.tasks', 'SELECT') as acesso_anonimo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tasks';
