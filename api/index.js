// ═══════════════════════════════════════════════
//  Eventos Haru — API Serverless (Vercel)
//  api/index.js
// ═══════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key (backend only)
);

// ── CORS ────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function ok(res, data) {
  return res.status(200).json(data);
}

function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

// ── VALIDAR USUÁRIO ──────────────────────────────
async function validateUser(username) {
  if (!username) return false;
  const { data } = await supabase
    .from('usuarios')
    .select('usuario')
    .eq('usuario', username.toLowerCase())
    .eq('ativo', true)
    .single();
  return !!data;
}

// ── LOG ─────────────────────────────────────────
async function addLog(usuario, evento_id, acao, codigo, detalhe) {
  await supabase.from('historico').insert({
    usuario, evento_id: evento_id || null, acao, codigo: codigo || null, detalhe
  }).catch(() => {});
}

// ── HANDLER PRINCIPAL ────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Método não permitido', 405);

  const body = req.body || {};
  const { action } = body;

  try {
    switch (action) {
      case 'login':         return await login(req, res, body);
      case 'getEvents':     return await getEvents(req, res, body);
      case 'createEvent':   return await createEvent(req, res, body);
      case 'closeEvent':    return await closeEvent(req, res, body);
      case 'deleteEvent':   return await deleteEvent(req, res, body);
      case 'getAll':        return await getAll(req, res, body);
      case 'upsert':        return await upsert(req, res, body);
      case 'saveReturn':    return await saveReturn(req, res, body);
      case 'delete':        return await deleteProduct(req, res, body);
      case 'getComparison': return await getComparison(req, res, body);
      case 'getLog':        return await getLog(req, res, body);
      default:              return err(res, 'Ação desconhecida: ' + action);
    }
  } catch (e) {
    console.error('API error:', e);
    return err(res, e.message || 'Erro interno', 500);
  }
};

// ── LOGIN ────────────────────────────────────────
async function login(req, res, body) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!username || !password)
    return err(res, 'Usuário e senha obrigatórios');

  const { data: user, error } = await supabase
    .from('usuarios')
    .select('usuario, nome, ativo')
    .eq('usuario', username)
    .eq('senha', password)
    .single();

  if (error || !user) return err(res, 'Usuário ou senha incorretos');
  if (!user.ativo)   return err(res, 'Usuário inativo.');

  // Atualiza último acesso
  await supabase.from('usuarios')
    .update({ ultimo_acesso: new Date().toISOString() })
    .eq('usuario', username);

  await addLog(username, null, 'LOGIN', null, 'Acesso realizado');
  return ok(res, { ok: true, username: user.usuario, name: user.nome });
}

// ── EVENTS ───────────────────────────────────────
async function getEvents(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { data, error } = await supabase
    .from('eventos')
    .select('id, nome, data, status, criado_por')
    .order('criado_em', { ascending: false });

  if (error) return err(res, error.message);

  return ok(res, {
    events: data.map(e => ({
      id: e.id, name: e.nome, date: e.data,
      status: e.status, createdBy: e.criado_por
    }))
  });
}

async function createEvent(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);
  if (!body.name) return err(res, 'Nome do evento obrigatório');

  const date = new Date().toLocaleDateString('pt-BR');
  const { data, error } = await supabase
    .from('eventos')
    .insert({ nome: body.name, data: date, status: 'ativo', criado_por: body.username })
    .select()
    .single();

  if (error) return err(res, error.message);

  await addLog(body.username, data.id, 'EVENTO CRIADO', null, body.name);
  return ok(res, { ok: true, id: data.id, name: data.nome, date: data.data, status: 'ativo' });
}

async function closeEvent(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { error } = await supabase
    .from('eventos')
    .update({ status: 'encerrado' })
    .eq('id', body.eventId);

  if (error) return err(res, error.message);

  await addLog(body.username, body.eventId, 'EVENTO ENCERRADO', null, '');
  return ok(res, { ok: true });
}

async function deleteEvent(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  // Produtos são deletados em cascade pelo FK
  const { error } = await supabase
    .from('eventos')
    .delete()
    .eq('id', body.eventId);

  if (error) return err(res, error.message);

  await addLog(body.username, null, 'EVENTO REMOVIDO', null, body.eventId);
  return ok(res, { ok: true });
}

// ── PRODUCTS ─────────────────────────────────────
async function getAll(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);
  if (!body.eventId) return err(res, 'eventId obrigatório');

  const { data, error } = await supabase
    .from('produtos')
    .select('codigo, nome, preco, qtd_entrada, qtd_retorno, criado_por, retorno_por, atualizado_em')
    .eq('evento_id', body.eventId)
    .order('criado_em', { ascending: true });

  if (error) return err(res, error.message);

  return ok(res, {
    products: data.map(p => ({
      code:      p.codigo,
      name:      p.nome,
      price:     parseFloat(p.preco) || 0,
      qtyIn:     p.qtd_entrada || 0,
      qtyReturn: p.qtd_retorno ?? null,
      createdBy: p.criado_por || '',
      returnBy:  p.retorno_por || '',
      updatedAt: p.atualizado_em || ''
    }))
  });
}

async function upsert(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);
  if (!body.eventId || !body.code) return err(res, 'eventId e code obrigatórios');

  const record = {
    evento_id:    body.eventId,
    codigo:       String(body.code),
    nome:         body.name,
    preco:        parseFloat(body.price) || 0,
    qtd_entrada:  parseInt(body.qtyIn) || 0,
    criado_por:   body.username,
    atualizado_em: new Date().toISOString()
  };

  const { error } = await supabase
    .from('produtos')
    .upsert(record, { onConflict: 'evento_id,codigo' });

  if (error) return err(res, error.message);

  await addLog(body.username, body.eventId, 'ENTRADA', body.code,
    `${body.name} | Qtd: ${body.qtyIn} | R$ ${body.price}`);

  return ok(res, { ok: true });
}

async function saveReturn(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  // Busca qtd_entrada para calcular vendido no log
  const { data: prod } = await supabase
    .from('produtos')
    .select('qtd_entrada')
    .eq('evento_id', body.eventId)
    .eq('codigo', String(body.code))
    .single();

  const { error } = await supabase
    .from('produtos')
    .update({
      qtd_retorno:  parseInt(body.qtyReturn),
      retorno_por:  body.username,
      atualizado_em: new Date().toISOString()
    })
    .eq('evento_id', body.eventId)
    .eq('codigo', String(body.code));

  if (error) return err(res, error.message);

  const sold = prod ? (prod.qtd_entrada - parseInt(body.qtyReturn)) : '?';
  await addLog(body.username, body.eventId, 'RETORNO', body.code,
    `Retornou: ${body.qtyReturn} | Vendido: ${sold}`);

  return ok(res, { ok: true });
}

async function deleteProduct(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { error } = await supabase
    .from('produtos')
    .delete()
    .eq('evento_id', body.eventId)
    .eq('codigo', String(body.code));

  if (error) return err(res, error.message);

  await addLog(body.username, body.eventId, 'REMOÇÃO', body.code, '');
  return ok(res, { ok: true });
}

// ── COMPARATIVO ──────────────────────────────────
async function getComparison(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const [evResult, prResult] = await Promise.all([
    supabase.from('eventos').select('id, nome, data, status'),
    supabase.from('produtos')
      .select('evento_id, codigo, nome, preco, qtd_entrada, qtd_retorno')
      .not('qtd_retorno', 'is', null)
  ]);

  if (evResult.error) return err(res, evResult.error.message);
  if (prResult.error) return err(res, prResult.error.message);

  const events = {};
  evResult.data.forEach(e => {
    events[e.id] = { id: e.id, name: e.nome, date: e.data, status: e.status };
  });

  const byCode = {};
  prResult.data.forEach(p => {
    const sold    = (p.qtd_entrada || 0) - (p.qtd_retorno || 0);
    const revenue = sold * (parseFloat(p.preco) || 0);
    if (!byCode[p.codigo]) byCode[p.codigo] = { code: p.codigo, name: p.nome, events: {} };
    byCode[p.codigo].events[p.evento_id] = { sold, revenue, qtyIn: p.qtd_entrada };
  });

  const products = Object.values(byCode).map(p => {
    const totalSold    = Object.values(p.events).reduce((s, e) => s + e.sold, 0);
    const totalRevenue = Object.values(p.events).reduce((s, e) => s + e.revenue, 0);
    return { ...p, totalSold, totalRevenue };
  }).sort((a, b) => b.totalSold - a.totalSold);

  return ok(res, { events, products });
}

// ── LOG ─────────────────────────────────────────
async function getLog(req, res, body) {
  if (!await validateUser(body.username)) return err(res, 'Sessão inválida', 401);

  const { data, error } = await supabase
    .from('historico')
    .select('data_hora, usuario, acao, codigo, detalhe')
    .order('data_hora', { ascending: false })
    .limit(100);

  if (error) return err(res, error.message);

  return ok(res, {
    log: data.map(l => ({
      date:   new Date(l.data_hora).toLocaleString('pt-BR'),
      user:   l.usuario,
      action: l.acao,
      code:   l.codigo || '',
      detail: l.detalhe || ''
    }))
  });
}
