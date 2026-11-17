-- Instala a configuração do cron; o job só é ativado pela chamada final gerada
-- localmente por scripts/notification-keys.mjs. Nunca publique a chave do cron.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.configure_task_notification_schedule(p_project_url text, p_cron_secret text)
returns text language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; old_job record; command text;
begin
    if p_project_url is null or p_project_url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
        raise exception 'URL do projeto inválida';
    end if;
    if p_cron_secret is null or length(p_cron_secret) < 32 or length(p_cron_secret) > 256 then
        raise exception 'Chave de agendamento inválida';
    end if;
    select id into secret_id from vault.secrets where name = 'minha_lista_push_cron_secret';
    if secret_id is null then
        perform vault.create_secret(p_cron_secret, 'minha_lista_push_cron_secret', 'Autorização do cron da Minha lista');
    else
        perform vault.update_secret(secret_id, p_cron_secret, 'minha_lista_push_cron_secret', 'Autorização do cron da Minha lista');
    end if;
    for old_job in select jobid from cron.job where jobname = 'minha-lista-task-reminders' loop
        perform cron.unschedule(old_job.jobid);
    end loop;
    command := format(
        'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''minha_lista_push_cron_secret'')), body := ''{}''::jsonb, timeout_milliseconds := 60000);',
        rtrim(p_project_url, '/') || '/functions/v1/task-reminders');
    perform cron.schedule('minha-lista-task-reminders', '* * * * *', command);
    return 'Agendamento ativado: verificação a cada minuto.';
end;
$$;
revoke all on function public.configure_task_notification_schedule(text, text) from public, anon, authenticated, service_role;
commit;
