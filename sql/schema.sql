create extension if not exists "pgcrypto";

create table if not exists usuarios (
  id            uuid primary key default gen_random_uuid(),
  usuario       text unique not null,
  senha         text not null,
  nome          text not null,
  perfil        text not null default 'funcionario'
                check (perfil in ('admin','funcionario')),
  ativo         boolean default true,
  ultimo_acesso timestamptz,
  criado_em     timestamptz default now()
);

create table if not exists produtos_catalogo (
  id          uuid primary key default gen_random_uuid(),
  codigo      text unique,
  nome        text not null,
  preco_loja  numeric(10,2) not null default 0,
  ativo       boolean default true,
  criado_em   timestamptz default now()
);

create table if not exists eventos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  data            text not null,
  status          text default 'ativo'
                  check (status in ('ativo','encerrado')),
  markup          numeric(5,2) default 0,
  arredondamento  boolean default true,
  criado_por      text,
  criado_em       timestamptz default now()
);

create table if not exists evento_produtos (
  id             uuid primary key default gen_random_uuid(),
  evento_id      uuid not null references eventos(id) on delete cascade,
  produto_id     uuid not null references produtos_catalogo(id),
  qtd_entrada    integer not null default 0,
  qtd_retorno    integer,
  preco_venda    numeric(10,2) not null default 0,
  cadastrado_por text,
  retorno_por    text,
  atualizado_em  timestamptz default now(),
  unique(evento_id, produto_id)
);

create index if not exists idx_evento_produtos_evento
  on evento_produtos(evento_id);

create table if not exists historico (
  id        uuid primary key default gen_random_uuid(),
  data_hora timestamptz default now(),
  usuario   text,
  evento_id uuid,
  acao      text,
  detalhe   text
);

create index if not exists idx_historico_data
  on historico(data_hora desc);

alter table usuarios          disable row level security;
alter table produtos_catalogo disable row level security;
alter table eventos           disable row level security;
alter table evento_produtos   disable row level security;
alter table historico         disable row level security;