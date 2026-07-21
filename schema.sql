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
