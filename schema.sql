-- Schema do sistema de conciliação CNAB 400 (remessa x retorno)
-- Rodar isso no SQL Editor do Supabase antes de usar o app

create extension if not exists "pgcrypto";

create table if not exists remessas (
  id uuid primary key default gen_random_uuid(),
  portador_codigo text not null,
  portador_nome text,
  cnpj_cedente text not null,
  nome_empresa text,
  codigo_transmissao text,
  data_geracao date,
  nome_arquivo text,
  criado_em timestamptz default now()
);

create table if not exists titulos (
  id uuid primary key default gen_random_uuid(),
  remessa_id uuid references remessas(id) on delete cascade,
  nosso_numero text not null,
  seu_numero text,
  titulo_g3 text,
  carteira text,
  cnpj_sacado text,
  nome_sacado text,
  endereco_sacado text,
  bairro_sacado text,
  cep_sacado text,
  cidade_sacado text,
  uf_sacado text,
  valor_titulo numeric(14,2),
  data_vencimento date,
  data_emissao date,
  status text default 'aguardando_retorno',
  criado_em timestamptz default now(),
  unique (remessa_id, nosso_numero)
);

create table if not exists retornos (
  id uuid primary key default gen_random_uuid(),
  portador_codigo text not null,
  portador_nome text,
  cnpj_cedente text,
  data_geracao date,
  nome_arquivo text,
  criado_em timestamptz default now()
);

create table if not exists movimentos_retorno (
  id uuid primary key default gen_random_uuid(),
  retorno_id uuid references retornos(id) on delete cascade,
  titulo_id uuid references titulos(id),
  nosso_numero text not null,
  ocorrencia_codigo text not null,
  ocorrencia_descricao text,
  data_ocorrencia date,
  valor_pago numeric(14,2),
  data_credito date,
  sacado_nome text,
  seu_numero_raw text,
  gera_baixa boolean default false,
  criado_em timestamptz default now()
);

create table if not exists ocorrencias_ref (
  codigo text primary key,
  descricao text not null,
  gera_baixa boolean default false
);

insert into ocorrencias_ref (codigo, descricao, gera_baixa) values
  ('02', 'Entrada Confirmada', false),
  ('03', 'Entrada Rejeitada', false),
  ('06', 'Liquidação Normal', true),
  ('09', 'Baixa Simples', false),
  ('15', 'Baixa Rejeitada', false)
on conflict (codigo) do nothing;

create index if not exists idx_titulos_nosso_numero on titulos (nosso_numero);
create index if not exists idx_titulos_status on titulos (status);
create index if not exists idx_movimentos_titulo on movimentos_retorno (titulo_id);

-- Dashboard em tempo real
--
-- Tabela agregada (1 linha por status, só contagem) em vez de expor `titulos`
-- via Realtime pro navegador: `titulos` tem CNPJ, nome do sacado e valores —
-- dado sensível de uma operação de factoring. `dashboard_stats` nunca guarda
-- nada além de status + contagem, então pode ser lida com a chave anon
-- (pública) sem vazar nada. Ela é recalculada por trigger sempre que
-- `titulos` muda, e o Supabase Realtime notifica o navegador quando ela muda.
create table if not exists dashboard_stats (
  status text primary key,
  quantidade integer not null default 0,
  atualizado_em timestamptz default now()
);

create or replace function recalcular_dashboard_stats() returns trigger as $$
begin
  -- "where true" não é decoração: o Supabase bloqueia DELETE/UPDATE sem
  -- WHERE para roles não-superuser (inclusive service_role, usada pelo
  -- servidor) mesmo dentro de uma trigger SECURITY DEFINER - sem isso, todo
  -- upload de remessa/retorno quebra com "DELETE requires a WHERE clause"
  -- assim que a trigger dispara.
  delete from dashboard_stats where true;
  insert into dashboard_stats (status, quantidade, atualizado_em)
  select status, count(*), now() from titulos group by status;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_recalcular_dashboard_stats on titulos;
create trigger trg_recalcular_dashboard_stats
  after insert or delete or update of status on titulos
  for each statement
  execute function recalcular_dashboard_stats();

-- popula/atualiza a contagem inicial (idempotente, seguro rodar de novo)
insert into dashboard_stats (status, quantidade, atualizado_em)
select status, count(*), now() from titulos group by status
on conflict (status) do update set quantidade = excluded.quantidade, atualizado_em = excluded.atualizado_em;

-- RLS: habilitado em tudo. As tabelas com dado do negócio (remessas, titulos,
-- retornos, movimentos_retorno, ocorrencias_ref) não ganham nenhuma policy de
-- leitura pública de propósito — RLS habilitado sem policy = acesso negado
-- pra qualquer role, exceto service_role (que ignora RLS e é o único usado
-- pelo servidor, via SUPABASE_SERVICE_ROLE_KEY). Só dashboard_stats, que não
-- tem dado sensível, ganha policy de leitura pública pro Realtime funcionar
-- no navegador com a chave anon.
alter table remessas enable row level security;
alter table titulos enable row level security;
alter table retornos enable row level security;
alter table movimentos_retorno enable row level security;
alter table ocorrencias_ref enable row level security;
alter table dashboard_stats enable row level security;

drop policy if exists "dashboard_stats: leitura publica" on dashboard_stats;
create policy "dashboard_stats: leitura publica"
  on dashboard_stats for select
  to anon, authenticated
  using (true);

-- Adiciona dashboard_stats à publicação do Realtime (idempotente - só roda
-- se ainda não tiver sido adicionada, senão o ALTER PUBLICATION dá erro de
-- "relation already member" ao rodar o schema de novo).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dashboard_stats'
  ) then
    alter publication supabase_realtime add table dashboard_stats;
  end if;
end $$;
