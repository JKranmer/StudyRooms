-- Papéis da coleta antecipada no Neon (F1-48). Aplicado por `pnpm --filter @studyrooms/db neon roles`,
-- com o papel dono do banco (neondb_owner), depois das migrations. Pode rodar de novo: só ajusta.
-- As senhas não ficam aqui: o comando as gera e define à parte, junto com o LOGIN.
--
-- studyrooms_bot: só insere em raw_voice_events, sem escolher id nem recorded_at. Não lê, não
--   altera, não apaga. Exceção da D-26, revogada na F1-20.
-- studyrooms_backup: só lê (backup local da F1-24), inclusive tabelas criadas por migrations futuras.
--
-- Cada `-- etapa:` abre um bloco rodado à parte, para o comando dizer em qual deles falhou. Tudo
-- roda numa só transação: se um bloco falhar, nada fica.

-- etapa: criar os papéis
-- Nascem sem LOGIN: o LOGIN só vem junto com a senha, no mesmo comando.
do $$
begin
  if not exists (select from pg_roles where rolname = 'studyrooms_bot') then
    create role studyrooms_bot nologin noinherit connection limit 3;
  end if;
  if not exists (select from pg_roles where rolname = 'studyrooms_backup') then
    create role studyrooms_backup nologin noinherit connection limit 2;
  end if;
end
$$;

-- etapa: ajustar NOINHERIT e o limite de conexões
alter role studyrooms_bot noinherit connection limit 3;
alter role studyrooms_backup noinherit connection limit 2;

-- etapa: deixar o backup só leitura
-- Mesmo que alguém conceda escrita por engano, as transações do backup são só leitura.
alter role studyrooms_backup set default_transaction_read_only = on;

-- etapa: aplicar as permissões do bot
-- Começa do zero a cada execução, para nenhuma permissão antiga sobrar.
revoke all on all tables in schema public from studyrooms_bot;
revoke all on all sequences in schema public from studyrooms_bot;
grant usage on schema public to studyrooms_bot;
grant insert (idempotency_key, event_type, discord_user_id, guild_id, from_channel_id, to_channel_id, occurred_at)
  on raw_voice_events to studyrooms_bot;

-- etapa: aplicar as permissões do backup
-- Leitura de tudo o que as migrations criam hoje.
grant usage on schema public to studyrooms_backup;
grant usage on schema drizzle to studyrooms_backup;
grant select on all tables in schema public to studyrooms_backup;
grant select on all sequences in schema public to studyrooms_backup;
grant select on all tables in schema drizzle to studyrooms_backup;

-- etapa: aplicar as permissões padrão do backup (ALTER DEFAULT PRIVILEGES)
-- Leitura das tabelas que migrations futuras criarem.
alter default privileges in schema public grant select on tables to studyrooms_backup;
alter default privileges in schema public grant select on sequences to studyrooms_backup;
alter default privileges in schema drizzle grant select on tables to studyrooms_backup;
