// ═══════════════════════════════════════════
//  Eventos Haru — API Backend (Vercel)
// ═══════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Conexão com o Supabase usando variáveis de ambiente do Vercel
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CORS ────────────────────────────────────
// Permite que o app no navegador acesse a API
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── RESPOSTAS PADRÃO ────────────────────────
function ok(res, data) {
  return res.status(200).json(data);
}
function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

// ── LOG DE AÇÕES ────────────────────────────
async function addLog(usuario, evento_id, acao, detalhe) {
  try {
    await supabase.from('historico').insert({
      usuario,
      evento_id: evento_id || null,
      acao,
      detalhe: detalhe || null
    });
  } catch (e) {}
}

// ── VALIDAR USUÁRIO ──────────────────────────
// Verifica se o usuário está ativo no banco
async function getUsuario(username) {
  const { data } = await supabase
    .from('usuarios')
    .select('usuario, nome, perfil, ativo, ver_relatorio')
    .eq('usuario', username)
    .eq('ativo', true)
    .single();
  return data;
}

async function validateUser(username) {
  const user = await getUsuario(username);
  return !!user;
}

// ═══════════════════════════════════════════
//  HANDLER PRINCIPAL — roteador de ações
// ═══════════════════════════════════════════
module.exports = async function handler(req, res) {
  setCors(res);

  // Responde ao preflight do navegador
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Método não permitido', 405);

  const body = req.body || {};
  const { action, username } = body;

  // Valida usuário em todas as ações exceto login e getEventoEmAndamento
  if (action !== 'login' && action !== 'getEventoEmAndamento') {
    const user = await getUsuario(username);
    if (!user) return err(res, 'Sessão inválida', 401);
    body._user = user; // injeta dados do usuário no body
  }

  try {
    switch (action) {
      // AUTH
      case 'login':           return await login(res, body);

      // EVENTOS
      case 'getEventos':      return await getEventos(res, body);
      case 'criarEvento':     return await criarEvento(res, body);
      case 'editarEvento':    return await editarEvento(res, body);
      case 'encerrarEvento':  return await encerrarEvento(res, body);
      case 'deletarEvento':   return await deletarEvento(res, body);
      case 'getEventoEmAndamento': return await getEventoEmAndamento(res, body);
      case 'setEventoEmAndamento': return await setEventoEmAndamento(res, body);

      // CATÁLOGO
      case 'getCatalogo':     return await getCatalogo(res, body);
      case 'salvarProduto':   return await salvarProduto(res, body);
      case 'deletarProduto':  return await deletarProduto(res, body);
      case 'importarCSV':     return await importarCSV(res, body);

      // EVENTO PRODUTOS
      case 'getProdutosEvento':  return await getProdutosEvento(res, body);
      case 'adicionarEntrada':   return await adicionarEntrada(res, body);
      case 'editarEntrada':      return await editarEntrada(res, body);
      case 'salvarRetorno':      return await salvarRetorno(res, body);
      case 'removerDoEvento':    return await removerDoEvento(res, body);

      // RELATÓRIO
      case 'getRelatorio':       return await getRelatorio(res, body);
      case 'getComparativo':     return await getComparativo(res, body);
      case 'registrarVenda':       return await registrarVenda(res, body);
      case 'getVendas':            return await getVendas(res, body);
      case 'cancelarVenda':        return await cancelarVenda(res, body);
      case 'getRelatorioVendedor': return await getRelatorioVendedor(res, body);

      // USUÁRIOS (admin)
      case 'getUsuarios':     return await getUsuarios(res, body);
      case 'salvarUsuario':   return await salvarUsuario(res, body);
      case 'toggleUsuario':   return await toggleUsuario(res, body);

      default:
        return err(res, 'Ação desconhecida: ' + action);
    }
  } catch (e) {
    console.error('Erro na API:', e);
    return err(res, e.message || 'Erro interno', 500);
  }
};

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
async function login(res, body) {
  const username = String(body.username || '').toLowerCase().trim();
  const senha    = String(body.senha    || '').trim();

  console.log('LOGIN body recebido:', JSON.stringify(body));
  console.log('username:', username, '| senha:', senha);

  if (!username || !senha) return err(res, 'Preencha usuário e senha');

  const { data: users, error: dbErr } = await supabase
    .from('usuarios')
    .select('usuario, nome, perfil, ativo, senha')
    .eq('usuario', username);

  console.log('Users encontrados:', JSON.stringify(users));
  console.log('DB error:', JSON.stringify(dbErr));

  if (dbErr || !users || users.length === 0)
    return err(res, 'Usuário ou senha incorretos');

  const user = users[0];

  console.log('Senha no banco:', user.senha, '| Senha enviada:', senha);

  if (user.senha !== senha)
    return err(res, 'Usuário ou senha incorretos');

  if (!user.ativo)
    return err(res, 'Usuário inativo. Fale com o administrador.');

  await supabase.from('usuarios')
    .update({ ultimo_acesso: new Date().toISOString() })
    .eq('usuario', username);

  await addLog(username, null, 'LOGIN', 'Acesso realizado');

  return ok(res, {
      ok: true,
      username: user.usuario,
      nome: user.nome,
      perfil: user.perfil,
      ver_relatorio: user.ver_relatorio || false
    });
}

// ═══════════════════════════════════════════
//  EVENTOS
// ═══════════════════════════════════════════
async function getEventos(res, body) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) return err(res, error.message);
  return ok(res, { eventos: data });
}

async function criarEvento(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem criar eventos', 403);

  const { nome, markup, arredondamento } = body;
  if (!nome) return err(res, 'Nome do evento obrigatório');

  const data_hoje = new Date().toLocaleDateString('pt-BR');

  const { data, error } = await supabase
    .from('eventos')
    .insert({
      nome,
      data: data_hoje,
      status: 'ativo',
      markup: parseFloat(markup) || 0,
      arredondamento: arredondamento !== false,
      criado_por: body.username
    })
    .select()
    .single();

  if (error) return err(res, error.message);

  await addLog(body.username, data.id, 'EVENTO_CRIADO', nome);
  return ok(res, { ok: true, evento: data });
}

async function editarEvento(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem editar eventos', 403);

  const { eventoId, nome, markup, arredondamento } = body;

  const { error } = await supabase
    .from('eventos')
    .update({ nome, markup: parseFloat(markup) || 0, arredondamento })
    .eq('id', eventoId);

  if (error) return err(res, error.message);
  await addLog(body.username, eventoId, 'EVENTO_EDITADO', nome);
  return ok(res, { ok: true });
}

async function encerrarEvento(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem encerrar eventos', 403);

  const { eventoId } = body;

  const { error } = await supabase
    .from('eventos')
    .update({ status: 'encerrado' })
    .eq('id', eventoId);

  if (error) return err(res, error.message);
  await addLog(body.username, eventoId, 'EVENTO_ENCERRADO', '');
  return ok(res, { ok: true });
}

async function deletarEvento(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem deletar eventos', 403);

  const { eventoId } = body;

  // Produtos do evento são deletados em cascade pelo FK
  const { error } = await supabase
    .from('eventos')
    .delete()
    .eq('id', eventoId);

  if (error) return err(res, error.message);
  await addLog(body.username, null, 'EVENTO_DELETADO', eventoId);
  return ok(res, { ok: true });
}

// ═══════════════════════════════════════════
//  CATÁLOGO DE PRODUTOS
// ═══════════════════════════════════════════
async function getCatalogo(res, body) {
  const { busca } = body;
  let query = supabase
    .from('produtos_catalogo')
    .select('*')
    .eq('ativo', true)
    .order('nome');

  if (busca) {
    query = query.or(`nome.ilike.%${busca}%,codigo.ilike.%${busca}%`);
  }

  const { data, error } = await query;
  if (error) return err(res, error.message);
  return ok(res, { produtos: data });
}

async function salvarProduto(res, body) {
  const { id, codigo, nome, preco_loja } = body;
  if (!nome)       return err(res, 'Nome do produto obrigatório');
  if (!preco_loja) return err(res, 'Preço de loja obrigatório');

  const registro = {
    codigo: codigo || null,
    nome,
    preco_loja: parseFloat(preco_loja)
  };

  let data, error;

  if (id) {
    // Editar produto existente
    ({ data, error } = await supabase
      .from('produtos_catalogo')
      .update(registro)
      .eq('id', id)
      .select()
      .single());
  } else {
    // Criar produto novo
    ({ data, error } = await supabase
      .from('produtos_catalogo')
      .insert(registro)
      .select()
      .single());
  }

  if (error) return err(res, error.message);
  await addLog(body.username, null, id ? 'PRODUTO_EDITADO' : 'PRODUTO_CRIADO', nome);
  return ok(res, { ok: true, produto: data });
}

async function deletarProduto(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem deletar produtos', 403);

  const { produtoId } = body;

  const { error } = await supabase
    .from('produtos_catalogo')
    .update({ ativo: false })
    .eq('id', produtoId);

  if (error) return err(res, error.message);
  await addLog(body.username, null, 'PRODUTO_DELETADO', produtoId);
  return ok(res, { ok: true });
}

async function importarCSV(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem importar produtos', 403);

  const { produtos } = body;
  if (!produtos || !produtos.length)
    return err(res, 'Nenhum produto para importar');

  let criados = 0, atualizados = 0, erros = [];

  for (const p of produtos) {
    if (!p.nome || !p.preco_loja) {
      erros.push(`Linha inválida: ${JSON.stringify(p)}`);
      continue;
    }

    const registro = {
      nome: p.nome.trim(),
      preco_loja: parseFloat(p.preco_loja),
      codigo: p.codigo?.trim() || null,
      ativo: true
    };

    // Tenta upsert pelo código se tiver, senão insere novo
    if (registro.codigo) {
      const { data: existente } = await supabase
        .from('produtos_catalogo')
        .select('id')
        .eq('codigo', registro.codigo)
        .single();

      if (existente) {
        await supabase.from('produtos_catalogo')
          .update(registro).eq('id', existente.id);
        atualizados++;
      } else {
        await supabase.from('produtos_catalogo').insert(registro);
        criados++;
      }
    } else {
      await supabase.from('produtos_catalogo').insert(registro);
      criados++;
    }
  }

  await addLog(body.username, null, 'CSV_IMPORTADO',
    `${criados} criados, ${atualizados} atualizados`);

  return ok(res, { ok: true, criados, atualizados, erros });
}

// ═══════════════════════════════════════════
//  PRODUTOS DO EVENTO
// ═══════════════════════════════════════════
async function getProdutosEvento(res, body) {
  const { eventoId } = body;
  if (!eventoId) return err(res, 'eventoId obrigatório');

  const { data, error } = await supabase
    .from('evento_produtos')
    .select(`
      *,
      produto:produto_id (id, codigo, nome, preco_loja)
    `)
    .eq('evento_id', eventoId)
    .order('atualizado_em', { ascending: false });

  if (error) return err(res, error.message);
  return ok(res, { produtos: data });
}

async function adicionarEntrada(res, body) {
  const { eventoId, produtoId, qtd_entrada, preco_venda } = body;
  if (!eventoId || !produtoId) return err(res, 'eventoId e produtoId obrigatórios');
  if (!qtd_entrada || qtd_entrada < 1) return err(res, 'Quantidade inválida');

  const { data, error } = await supabase
    .from('evento_produtos')
    .upsert({
      evento_id:     eventoId,
      produto_id:    produtoId,
      qtd_entrada:   parseInt(qtd_entrada),
      preco_venda:   parseFloat(preco_venda),
      cadastrado_por: body.username,
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'evento_id,produto_id' })
    .select()
    .single();

  if (error) return err(res, error.message);

  await addLog(body.username, eventoId, 'ENTRADA',
    `Produto ${produtoId} | Qtd: ${qtd_entrada} | R$ ${preco_venda}`);

  return ok(res, { ok: true, entrada: data });
}

async function editarEntrada(res, body) {
  const { eventoId, produtoId, qtd_entrada, preco_venda } = body;

  const { error } = await supabase
    .from('evento_produtos')
    .update({
      qtd_entrada:   parseInt(qtd_entrada),
      preco_venda:   parseFloat(preco_venda),
      atualizado_em: new Date().toISOString()
    })
    .eq('evento_id', eventoId)
    .eq('produto_id', produtoId);

  if (error) return err(res, error.message);
  await addLog(body.username, eventoId, 'ENTRADA_EDITADA',
    `Produto ${produtoId}`);
  return ok(res, { ok: true });
}

async function salvarRetorno(res, body) {
  const { eventoId, produtoId, qtd_retorno } = body;
  if (!eventoId || !produtoId) return err(res, 'eventoId e produtoId obrigatórios');
  if (qtd_retorno === undefined || qtd_retorno < 0)
    return err(res, 'Quantidade de retorno inválida');

  // Busca qtd_entrada para calcular vendido no log
  const { data: ep } = await supabase
    .from('evento_produtos')
    .select('qtd_entrada')
    .eq('evento_id', eventoId)
    .eq('produto_id', produtoId)
    .single();

  const vendido = ep ? ep.qtd_entrada - parseInt(qtd_retorno) : '?';

  const { error } = await supabase
    .from('evento_produtos')
    .update({
      qtd_retorno:   parseInt(qtd_retorno),
      retorno_por:   body.username,
      atualizado_em: new Date().toISOString()
    })
    .eq('evento_id', eventoId)
    .eq('produto_id', produtoId);

  if (error) return err(res, error.message);

  await addLog(body.username, eventoId, 'RETORNO',
    `Produto ${produtoId} | Retornou: ${qtd_retorno} | Vendido: ${vendido}`);

  return ok(res, { ok: true, vendido });
}

async function removerDoEvento(res, body) {
  const { eventoId, produtoId } = body;

  const { error } = await supabase
    .from('evento_produtos')
    .delete()
    .eq('evento_id', eventoId)
    .eq('produto_id', produtoId);

  if (error) return err(res, error.message);
  await addLog(body.username, eventoId, 'PRODUTO_REMOVIDO', produtoId);
  return ok(res, { ok: true });
}
// ── EVENTO EM ANDAMENTO ──────────────────────
async function getEventoEmAndamento(res, body) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('em_andamento', true)
    .single();

  if (error || !data) return ok(res, { evento: null });
  return ok(res, { evento: data });
}

async function setEventoEmAndamento(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Apenas administradores podem definir o evento em andamento', 403);

  const { eventoId } = body;

  // Desmarca todos
  await supabase.from('eventos')
    .update({ em_andamento: false })
    .neq('id', eventoId || '00000000-0000-0000-0000-000000000000');

  // Marca o selecionado (se vier null, apenas desmarca todos)
  if (eventoId) {
    const { error } = await supabase.from('eventos')
      .update({ em_andamento: true })
      .eq('id', eventoId);
    if (error) return err(res, error.message);
  }

  await addLog(body.username, eventoId, 'EVENTO_EM_ANDAMENTO', eventoId || 'nenhum');
  return ok(res, { ok: true });
}


// ═══════════════════════════════════════════
//  RELATÓRIO
// ═══════════════════════════════════════════
async function getRelatorio(res, body) {
  const { eventoId } = body;
  if (!eventoId) return err(res, 'eventoId obrigatório');
  if (!body._user.ver_relatorio && body._user.perfil !== 'admin')
    return err(res, 'Sem permissão para acessar o relatório', 403);

  const { data, error } = await supabase
    .from('evento_produtos')
    .select(`
      qtd_entrada, qtd_retorno, preco_venda,
      produto:produto_id (id, codigo, nome, preco_loja)
    `)
    .eq('evento_id', eventoId)
    .order('atualizado_em', { ascending: false });

  if (error) return err(res, error.message);

  // Calcula totais
  let totalEntrada = 0, totalVendido = 0, faturamento = 0;
  const produtos = data.map(p => {
    const vendido = p.qtd_retorno !== null
      ? p.qtd_entrada - p.qtd_retorno
      : null;
    const receita = vendido !== null ? vendido * p.preco_venda : 0;
    totalEntrada += p.qtd_entrada;
    if (vendido !== null) { totalVendido += vendido; faturamento += receita; }
    return { ...p, vendido, receita };
  });

  return ok(res, {
    produtos,
    totais: { totalEntrada, totalVendido, faturamento }
  });
}

async function getComparativo(res, body) {
  if (!body._user.ver_relatorio && body._user.perfil !== 'admin')
    return err(res, 'Sem permissão para acessar o relatório', 403);
  // Busca todos os eventos com seus produtos

  const { data: eventos, error: evErr } = await supabase
    .from('eventos')
    .select('id, nome, data, status')
    .order('criado_em', { ascending: false });

  if (evErr) return err(res, evErr.message);

  const { data: produtos, error: prErr } = await supabase
    .from('evento_produtos')
    .select(`
      evento_id, qtd_entrada, qtd_retorno, preco_venda,
      produto:produto_id (id, codigo, nome)
    `)
    .not('qtd_retorno', 'is', null);

  if (prErr) return err(res, prErr.message);

  // Agrupa por produto → evento
  const byProduto = {};
  produtos.forEach(p => {
    const pid = p.produto.id;
    const vendido = p.qtd_entrada - p.qtd_retorno;
    const receita = vendido * p.preco_venda;
    if (!byProduto[pid]) {
      byProduto[pid] = {
        produto: p.produto,
        totalVendido: 0,
        totalReceita: 0,
        eventos: {}
      };
    }
    byProduto[pid].eventos[p.evento_id] = { vendido, receita };
    byProduto[pid].totalVendido += vendido;
    byProduto[pid].totalReceita += receita;
  });

  const ranking = Object.values(byProduto)
    .sort((a, b) => b.totalVendido - a.totalVendido);

  return ok(res, { eventos, ranking });
}

// ═══════════════════════════════════════════
//  USUÁRIOS (apenas admin)
// ═══════════════════════════════════════════
async function getUsuarios(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Acesso negado', 403);

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, usuario, nome, perfil, ativo, ultimo_acesso, criado_em')
    .order('nome');

  if (error) return err(res, error.message);
  return ok(res, { usuarios: data });
}

async function salvarUsuario(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Acesso negado', 403);

  const { id, usuario, senha, nome, perfil } = body;
  if (!usuario || !nome || !perfil)
    return err(res, 'Usuário, nome e perfil são obrigatórios');

  const registro = {
    usuario: usuario.toLowerCase().trim(),
    nome,
    perfil,
    ativo: true,
    ver_relatorio: body.ver_relatorio === true || perfil === 'admin'
  };
  if (senha) registro.senha = senha;

  let data, error;

  if (id) {
    ({ data, error } = await supabase
      .from('usuarios')
      .update(registro)
      .eq('id', id)
      .select()
      .single());
  } else {
    if (!senha) return err(res, 'Senha obrigatória para novo usuário');
    registro.senha = senha;
    ({ data, error } = await supabase
      .from('usuarios')
      .insert(registro)
      .select()
      .single());
  }

  if (error) return err(res, error.message);
  await addLog(body.username, null,
    id ? 'USUARIO_EDITADO' : 'USUARIO_CRIADO', nome);
  return ok(res, { ok: true, usuario: data });
}

async function toggleUsuario(res, body) {
  if (body._user.perfil !== 'admin')
    return err(res, 'Acesso negado', 403);

  const { id, ativo } = body;

  const { error } = await supabase
    .from('usuarios')
    .update({ ativo })
    .eq('id', id);

  if (error) return err(res, error.message);
  await addLog(body.username, null,
    ativo ? 'USUARIO_ATIVADO' : 'USUARIO_DESATIVADO', id);
  return ok(res, { ok: true });
}

// ═══════════════════════════════════════════
//  PDV
// ═══════════════════════════════════════════
async function registrarVenda(res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { eventoId, itens, subtotal, desconto, total,
          forma_pagamento, valor_recebido } = body;

  if (!eventoId)           return err(res, 'eventoId obrigatório');
  if (!itens?.length)      return err(res, 'Carrinho vazio');
  if (!forma_pagamento)    return err(res, 'Forma de pagamento obrigatória');

  const troco = forma_pagamento === 'dinheiro' && valor_recebido
    ? parseFloat(valor_recebido) - parseFloat(total)
    : null;

  const { data, error } = await supabase
    .from('vendas')
    .insert({
      evento_id:       eventoId,
      vendedor:        body.username,
      itens,
      subtotal:        parseFloat(subtotal) || 0,
      desconto:        parseFloat(desconto) || 0,
      total:           parseFloat(total) || 0,
      forma_pagamento,
      valor_recebido:  valor_recebido ? parseFloat(valor_recebido) : null,
      troco,
      status:          'concluida'
    })
    .select()
    .single();

  if (error) return err(res, error.message);

  await addLog(body.username, eventoId, 'VENDA',
    `R$${total} | ${forma_pagamento} | ${itens.length} itens`);

  return ok(res, { ok: true, venda: data });
}

async function getVendas(res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { eventoId } = body;
  if (!eventoId) return err(res, 'eventoId obrigatório');

  const { data, error } = await supabase
    .from('vendas')
    .select('*')
    .eq('evento_id', eventoId)
    .order('criado_em', { ascending: false });

  if (error) return err(res, error.message);
  return ok(res, { vendas: data });
}

async function cancelarVenda(res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { vendaId } = body;
  if (!vendaId) return err(res, 'vendaId obrigatório');

  // Verifica se é o próprio vendedor ou admin
  const { data: venda } = await supabase
    .from('vendas')
    .select('vendedor, evento_id, total')
    .eq('id', vendaId)
    .single();

  if (!venda) return err(res, 'Venda não encontrada');

  const user = await getUsuario(body.username);
  if (venda.vendedor !== body.username && user?.perfil !== 'admin')
    return err(res, 'Sem permissão para cancelar esta venda', 403);

  const { error } = await supabase
    .from('vendas')
    .update({ status: 'cancelada' })
    .eq('id', vendaId);

  if (error) return err(res, error.message);

  await addLog(body.username, venda.evento_id, 'VENDA_CANCELADA',
    `Venda ${vendaId} | R$${venda.total}`);

  return ok(res, { ok: true });
}

async function getRelatorioVendedor(res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { eventoId } = body;
  if (!eventoId) return err(res, 'eventoId obrigatório');

  const { data, error } = await supabase
    .from('vendas')
    .select('vendedor, total, itens, status, criado_em')
    .eq('evento_id', eventoId)
    .eq('status', 'concluida');

  if (error) return err(res, error.message);

  // Agrupa por vendedor
  const byVendedor = {};
  data.forEach(v => {
    if (!byVendedor[v.vendedor]) {
      byVendedor[v.vendedor] = { vendedor: v.vendedor, totalVendas: 0, totalValor: 0, totalItens: 0 };
    }
    byVendedor[v.vendedor].totalVendas++;
    byVendedor[v.vendedor].totalValor  += parseFloat(v.total);
    byVendedor[v.vendedor].totalItens  += v.itens.reduce((s, i) => s + i.qtd, 0);
  });

  const ranking = Object.values(byVendedor)
    .sort((a, b) => b.totalValor - a.totalValor);

  return ok(res, { ranking });
}