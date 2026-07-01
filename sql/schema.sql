-- ═══════════════════════════════════════════════
--  Eventos Haru — Schema Supabase
--  Execute no SQL Editor do Supabase
-- ═══════════════════════════════════════════════

-- Extensão para UUID
create extension if not exists "pgcrypto";

-- ── USUÁRIOS ────────────────────────────────────
create table if not exists usuarios (
  id         uuid primary key default gen_random_uuid(),
  usuario    text unique not null,
  senha      text not null,
  nome       text not null,
  ativo      boolean default true,
  ultimo_acesso timestamptz,
  criado_em  timestamptz default now()
);

-- Usuário admin padrão (senha: admin123)
insert into usuarios (usuario, senha, nome, ativo)
values ('admin', 'admin123', 'Administrador', true)
on conflict (usuario) do nothing;

-- ── EVENTOS ─────────────────────────────────────
create table if not exists eventos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  data       text not null,
  status     text default 'ativo' check (status in ('ativo','encerrado')),
  criado_por text not null,
  criado_em  timestamptz default now()
);

-- ── PRODUTOS ────────────────────────────────────
create table if not exists produtos (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references eventos(id) on delete cascade,
  codigo       text not null,
  nome         text not null,
  preco        numeric(10,2) default 0,
  qtd_entrada  integer default 0,
  qtd_retorno  integer,
  criado_por   text,
  retorno_por  text,
  atualizado_em timestamptz default now(),
  unique(evento_id, codigo)
);

-- Índice para buscas rápidas por evento
create index if not exists idx_produtos_evento on produtos(evento_id);

-- ── HISTÓRICO ───────────────────────────────────
create table if not exists historico (
  id         uuid primary key default gen_random_uuid(),
  data_hora  timestamptz default now(),
  usuario    text,
  evento_id  uuid,
  acao       text,
  codigo     text,
  detalhe    text
);

create index if not exists idx_historico_evento on historico(evento_id);
create index if not exists idx_historico_data on historico(data_hora desc);

-- ── RLS (Row Level Security) ─────────────────────
-- Desabilitado pois usamos autenticação própria via API
alter table usuarios  disable row level security;
alter table eventos   disable row level security;
alter table produtos  disable row level security;
alter table historico disable row level security;
