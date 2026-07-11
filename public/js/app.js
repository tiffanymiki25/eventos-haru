// ═══════════════════════════════════════════
//  Eventos Haru — app.js
// ═══════════════════════════════════════════

const API = '/api';

// ── ESTADO GLOBAL ──
let sessao = JSON.parse(sessionStorage.getItem('haru_sessao') || 'null');
let eventoAtivo = JSON.parse(localStorage.getItem('haru_evento')   || 'null');
let produtos    = [];
let catalogo    = [];
let produtoEditandoId = null;
let produtoAdminEditandoId = null;
let usuarioAdminEditandoId = null;
let eventoSelecionadoModal = null;
let produtoRetornoAtual = null;
let scannerEntradaAtivo = false;
let scannerRetornoAtivo = false;
let csvDados = [];

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-user-perfil')
    .addEventListener('change', function() {
      document.getElementById('campo-ver-relatorio').style.display =
        this.value === 'admin' ? 'none' : 'block';
    });
  // Atalhos teclado login
  document.getElementById('login-senha')
    .addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-usuario')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-senha').focus();
    });

  // Fecha modal ao clicar no fundo
  document.querySelectorAll('.modal-bg').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) m.classList.remove('open');
    });
  });

  // CSV preview ao selecionar arquivo
  document.getElementById('csv-file')
    .addEventListener('change', lerCSV);

  // Garante que loading some em qualquer cenário
  try {
    iniciarMonitorOffline();
  if (sessao) {
    mostrarHome();
    } else {
      showPage('page-login');
      esconderLoading();
    }
  } catch(e) {
    console.error('Boot error:', e);
    esconderLoading();
    showPage('page-login');
  }
});

// ═══════════════════════════════════════════
//  API
// ═══════════════════════════════════════════
async function api(action, body = {}) {
  const payload = {
    action,
    username: sessao?.username || '',
    ...body
  };
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.error === 'Sessão inválida') { doLogout(); throw new Error('Sessão expirada.'); }
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Tempo esgotado. Verifique sua conexão.');
    throw e;
  }
}

// ═══════════════════════════════════════════
//  EVENTO EM ANDAMENTO
// ═══════════════════════════════════════════
async function sincronizarEventoEmAndamento() {
  try {
    const d = await api('getEventoEmAndamento');
    if (d.evento) {
      eventoAtivo = d.evento;
      localStorage.setItem('haru_evento', JSON.stringify(eventoAtivo));
    }
  } catch (e) {
    console.warn('Sync evento falhou, usando cache local');
  }
}

async function definirEventoEmAndamento(eventoId) {
  mostrarLoading(eventoId ? 'Iniciando evento...' : 'Parando evento...');
  try {
    await api('setEventoEmAndamento', { eventoId });
    if (eventoId) {
      await sincronizarEventoEmAndamento();
      atualizarBadgeEvento();
      toast('Evento iniciado! Todos os usuários verão este evento.', 'success');
    } else {
      eventoAtivo = null;
      localStorage.removeItem('haru_evento');
      atualizarBadgeEvento();
      toast('Evento parado.', 'info');
    }
    await carregarAdminEventos();
  } catch (e) { toast(e.message, 'error'); }
  finally { esconderLoading(); }
}

// ═══════════════════════════════════════════
//  NAVEGAÇÃO
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goPage(id) {
  stopScanner();
  showPage(id);
  if (id === 'page-eventos') carregarEventos();
  if (id === 'page-admin')   carregarAdmin('eventos');
  if (id === 'page-home')    sincronizarEventoEmAndamento().then(() => atualizarBadgeEvento());
}

async function goApp(tela) {
  if (!eventoAtivo) {
    toast('Selecione um evento primeiro!', 'error');
    goPage('page-eventos');
    return;
  }
  stopScanner();
  showPage('page-' + tela);
  if (tela === 'entrada')   carregarEntrada();
  if (tela === 'retorno')   carregarRetorno();
  if (tela === 'relatorio') carregarRelatorio();
  if (tela === 'pesquisa')  iniciarPesquisa();
  if (tela === 'pdv') {
    showPage('page-pdv');
    if (!produtos.length) {
      mostrarLoading('Carregando produtos...');
      try {
        const d = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
        produtos = d.produtos || [];
        // Salva cache para uso offline
        await salvarCacheLocal(eventoAtivo.id, produtos).catch(() => {});
      } catch(e) {
        // Sem conexão — usa cache local
        const cache = await getCacheLocal(eventoAtivo.id).catch(() => null);
        if (cache && cache.length) {
          produtos = cache;
          toast('Modo offline — usando produtos em cache', 'info');
        } else {
          toast('Sem conexão e sem cache disponível', 'error');
        }
      } finally { esconderLoading(); }
    } else {
      // Atualiza cache em background
      api('getProdutosEvento', { eventoId: eventoAtivo.id })
        .then(d => salvarCacheLocal(eventoAtivo.id, d.produtos || []))
        .catch(() => {});
    }
    iniciarPdv();
  }
}

function voltarHome() {
  stopScanner();
  showPage('page-home');
  atualizarResumo();
}

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
async function doLogin() {
  const usuario = document.getElementById('login-usuario').value.trim();
  const senha   = document.getElementById('login-senha').value;
  const erroEl  = document.getElementById('login-erro');
  const btnEl   = document.getElementById('btn-login');
  erroEl.style.display = 'none';
  if (!usuario || !senha) {
    erroEl.textContent = 'Preencha usuário e senha.';
    erroEl.style.display = 'block';
    return;
  }
  btnEl.disabled = true; btnEl.textContent = 'Entrando...';
  mostrarLoading('Autenticando...');
  try {
    const data = await api('login', { username: usuario, senha });
    sessao = { username: data.username, nome: data.nome, perfil: data.perfil, ver_relatorio: data.ver_relatorio };
    // Salva com validade de 7 dias
    sessionStorage.setItem('haru_sessao', JSON.stringify(sessao));
    mostrarHome();
  } catch (e) {
    esconderLoading();
    erroEl.textContent = e.message;
    erroEl.style.display = 'block';
  } finally {
    btnEl.disabled = false; btnEl.textContent = 'Entrar';
  }
}

function doLogout() {
  sessao = null; eventoAtivo = null; produtos = []; catalogo = [];
  sessionStorage.removeItem('haru_sessao');
  localStorage.removeItem('haru_evento');
  fecharModal('modal-usuario');
  showPage('page-login');
  esconderLoading();
}

// ═══════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════
function mostrarHome() {
  // Esconde loading PRIMEIRO — garante que nunca fica preso
  esconderLoading();
  try {
    const nome = sessao?.nome || '?';
    const el = (id) => document.getElementById(id);
    if (el('home-user-nome'))       el('home-user-nome').textContent = nome.split(' ')[0];
    if (el('home-avatar'))          el('home-avatar').textContent = nome.charAt(0).toUpperCase();
    if (el('modal-usuario-avatar')) el('modal-usuario-avatar').textContent = nome.charAt(0).toUpperCase();
    if (el('modal-usuario-nome'))   el('modal-usuario-nome').textContent = nome;
    if (el('modal-usuario-perfil')) el('modal-usuario-perfil').textContent =
      sessao?.perfil === 'admin' ? 'Administrador' : 'Funcionário';
    if (el('home-btn-admin'))       el('home-btn-admin').style.display =
      sessao?.perfil === 'admin' ? 'block' : 'none';
    if (el('home-btn-relatorio'))   el('home-btn-relatorio').style.display =
      (sessao?.perfil === 'admin' || sessao?.ver_relatorio) ? 'flex' : 'none';
    atualizarBadgeEvento();
    showPage('page-home');
    if (eventoAtivo) prefetchProdutos();
  } catch(e) {
    console.error('mostrarHome error:', e);
  }
}

function atualizarBadgeEvento() {
  const badge     = document.getElementById('home-evento-badge');
  const semEvento = document.getElementById('home-sem-evento');
  const resumo    = document.getElementById('home-resumo');
  if (eventoAtivo) {
    document.getElementById('home-evento-nome').textContent = eventoAtivo.nome;
    document.getElementById('home-evento-data').textContent = eventoAtivo.data;
    badge.style.display     = 'flex';
    semEvento.style.display = 'none';
    resumo.style.display    = 'block';
    atualizarResumo();
  } else {
    badge.style.display     = 'none';
    semEvento.style.display = 'flex';
    resumo.style.display    = 'none';
  }
}

function atualizarResumo() {
  const total      = produtos.length;
  const comRetorno = produtos.filter(p => p.qtd_retorno !== null);
  const vendidos   = comRetorno.reduce((s, p) => s + (p.qtd_entrada - p.qtd_retorno), 0);
  const faturamento = comRetorno.reduce((s, p) =>
    s + (p.qtd_entrada - p.qtd_retorno) * parseFloat(p.preco_venda), 0);
  document.getElementById('stat-produtos').textContent    = total || '—';
  document.getElementById('stat-vendidos').textContent    = vendidos || '—';
  document.getElementById('stat-faturamento').textContent =
    faturamento > 0 ? 'R$' + faturamento.toFixed(2) : '—';
}

async function carregarTop10() {
  const el = document.getElementById('home-top10');
  if (!el || !eventoAtivo) return;
  try {
    const d = await api('getTopProdutos', { eventoId: eventoAtivo.id, limit: 10 });
    const ranking = d.ranking || [];
    if (!ranking.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    document.getElementById('home-top10-lista').innerHTML = ranking.map((p, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:800;color:var(--rosa);width:24px;text-align:center;flex-shrink:0">${i + 1}º</div>
        <div style="flex:1;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nome)}</div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-size:13px;font-weight:700;color:var(--verde)">${p.qtd} vend.</div>
          <div style="font-size:10px;color:var(--text-4)">R$${p.receita.toFixed(2)}</div>
        </div>
      </div>`).join('');
  } catch(e) { el.style.display = 'none'; }
}

async function prefetchProdutos() {
  if (!eventoAtivo) return;
  try {
    const data = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
    produtos = data.produtos || [];
    atualizarResumo();
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  EVENTOS
// ═══════════════════════════════════════════
async function carregarEventos() {
  const btnNovo = document.getElementById('btn-novo-evento');
  if (btnNovo) btnNovo.style.display = sessao?.perfil === 'admin' ? 'block' : 'none';
  mostrarLoading('Carregando eventos...');
  try {
    const data = await api('getEventos');
    renderEventos(data.eventos || []);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

function renderEventos(lista) {
  const el = document.getElementById('eventos-lista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = emptyState('Nenhum evento criado ainda.');
    return;
  }
  const sorted = [...lista].sort((a, b) =>
    a.status === b.status ? 0 : a.status === 'ativo' ? -1 : 1);
  el.innerHTML = sorted.map(ev => `
    <div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer"
         onclick='abrirOpcoesEvento(${JSON.stringify(ev)})'>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(ev.nome)}
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">
          ${ev.data}${ev.markup > 0 ? ` · Markup: ${ev.markup}%` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span class="badge badge-${ev.status}">${ev.status}</span>
        ${eventoAtivo?.id === ev.id
          ? `<svg width="18" viewBox="0 0 24 24" fill="none" stroke="var(--verde)" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`
          : ''}
      </div>
    </div>`).join('');
}

function abrirOpcoesEvento(ev) {
  eventoSelecionadoModal = ev;
  document.getElementById('modal-opcoes-evento-nome').textContent = ev.nome;
  const isAdmin = sessao?.perfil === 'admin';
  document.getElementById('btn-encerrar-evento').style.display =
    isAdmin && ev.status === 'ativo' ? 'flex' : 'none';
  document.getElementById('btn-deletar-evento').style.display =
    isAdmin ? 'flex' : 'none';
  abrirModal('modal-opcoes-evento');
}

function confirmarSelecaoEvento() {
  if (!eventoSelecionadoModal) return;
  eventoAtivo = eventoSelecionadoModal;
  localStorage.setItem('haru_evento', JSON.stringify(eventoAtivo));
  produtos = [];
  fecharModal('modal-opcoes-evento');
  atualizarBadgeEvento();
  toast('Evento "' + eventoAtivo.nome + '" selecionado!', 'success');
  setTimeout(() => voltarHome(), 600);
}

function abrirModalNovoEvento() {
  document.getElementById('novo-evento-nome').value   = '';
  document.getElementById('novo-evento-markup').value = '0';
  document.getElementById('novo-evento-arred').value  = 'true';
  fecharModal('modal-opcoes-evento');
  abrirModal('modal-novo-evento');
  setTimeout(() => document.getElementById('novo-evento-nome').focus(), 300);
}

async function criarEvento() {
  const nome = document.getElementById('novo-evento-nome').value.trim();
  const markup = document.getElementById('novo-evento-markup').value;
  const arred  = document.getElementById('novo-evento-arred').value === 'true';
  if (!nome) { toast('Digite o nome do evento', 'error'); return; }
  mostrarLoading('Criando evento...');
  try {
    const data = await api('criarEvento', { nome, markup, arredondamento: arred });
    fecharModal('modal-novo-evento');
    eventoAtivo = data.evento;
    localStorage.setItem('haru_evento', JSON.stringify(eventoAtivo));
    atualizarBadgeEvento();
    toast('Evento criado!', 'success');
    await carregarEventos();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

async function encerrarEvento() {
  if (!eventoSelecionadoModal) return;
  if (!confirm('Encerrar o evento "' + eventoSelecionadoModal.nome + '"?')) return;
  mostrarLoading('Encerrando...');
  try {
    await api('encerrarEvento', { eventoId: eventoSelecionadoModal.id });
    if (eventoAtivo?.id === eventoSelecionadoModal.id) {
      eventoAtivo = null;
      localStorage.removeItem('haru_evento');
      atualizarBadgeEvento();
    }
    fecharModal('modal-opcoes-evento');
    toast('Evento encerrado', 'info');
    await carregarEventos();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

async function deletarEvento() {
  if (!eventoSelecionadoModal) return;
  if (!confirm('Remover permanentemente "' + eventoSelecionadoModal.nome + '"?\nTodos os produtos serão removidos.')) return;
  mostrarLoading('Removendo...');
  try {
    await api('deletarEvento', { eventoId: eventoSelecionadoModal.id });
    if (eventoAtivo?.id === eventoSelecionadoModal.id) {
      eventoAtivo = null;
      localStorage.removeItem('haru_evento');
      atualizarBadgeEvento();
    }
    fecharModal('modal-opcoes-evento');
    toast('Evento removido', 'info');
    await carregarEventos();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ═══════════════════════════════════════════
//  ENTRADA
// ═══════════════════════════════════════════
async function carregarEntrada() {
  const el = document.getElementById('entrada-evento-nome');
  if (el) el.textContent = eventoAtivo?.nome || '';
  const buscaEl = document.getElementById('entrada-busca');
  if (buscaEl) buscaEl.value = '';
  mostrarLoading('Carregando produtos...');
  try {
    const data = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
    produtos = data.produtos || [];
    renderEntrada();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

function renderEntrada() {
  const el    = document.getElementById('entrada-lista');
  const busca = (document.getElementById('entrada-busca')?.value || '').toLowerCase();
  const lista = busca
    ? produtos.filter(p =>
        (p.produto?.nome   || '').toLowerCase().includes(busca) ||
        (p.produto?.codigo || '').toLowerCase().includes(busca))
    : produtos;
  if (!lista.length) {
    el.innerHTML = busca ? emptyState('Nenhum produto encontrado') : emptyState('Nenhum produto cadastrado');
    return;
  }
  el.innerHTML = lista.map(p => `
    <div class="product-card">
      <div class="product-card-info">
        <div class="product-name">${esc(p.produto?.nome || '')}</div>
        <div class="product-code">${esc(p.produto?.codigo || 'sem código')}</div>
        <div class="product-pills">
          <span class="pill pill-azul">Entrada: ${p.qtd_entrada}</span>
          <span class="pill pill-verde">R$ ${parseFloat(p.preco_venda).toFixed(2)}</span>
          ${p.qtd_retorno !== null
            ? `<span class="pill pill-rosa">Retorno: ${p.qtd_retorno}</span>`
            : ''}
        </div>
        ${p.cadastrado_por ? `<div class="product-by">por <span>${esc(p.cadastrado_por)}</span></div>` : ''}
      </div>
      <div class="product-actions">
        <button class="btn btn-icon btn-secondary" title="Repor estoque" onclick='abrirModalReposicao(${JSON.stringify(p)})'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10"/></svg>
        </button>
        <button class="btn btn-icon btn-secondary" onclick='abrirModalEntrada(${JSON.stringify(p)})'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-icon btn-danger" onclick="removerProdutoEvento('${p.produto_id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function abrirModalEntrada(produtoExistente = null) {
  produtoEditandoId = null;
  document.getElementById('modal-entrada-titulo').textContent  = 'Adicionar Produto';
  document.getElementById('entrada-codigo').value              = '';
  document.getElementById('entrada-nome').value                = '';
  document.getElementById('entrada-preco-loja').value          = '';
  document.getElementById('entrada-preco-venda').value         = '';
  document.getElementById('entrada-qtd').value                 = '';
  document.getElementById('entrada-hint-sugerido').textContent = '';
  document.getElementById('entrada-scanned').style.display     = 'none';
  // Reset categoria e favorito
  const catEl  = document.getElementById('entrada-categoria');
  const favBtn = document.getElementById('btn-entrada-favorito');
  if (catEl)  catEl.value          = '';
  entradaFavorito = false;
  if (favBtn) favBtn.textContent   = '☆';

  if (produtoExistente) {
    produtoEditandoId = produtoExistente.produto_id;
    document.getElementById('modal-entrada-titulo').textContent  = 'Editar Produto';
    document.getElementById('entrada-codigo').value              = produtoExistente.produto?.codigo    || '';
    document.getElementById('entrada-nome').value                = produtoExistente.produto?.nome      || '';
    document.getElementById('entrada-preco-loja').value          = produtoExistente.produto?.preco_loja || '';
    document.getElementById('entrada-preco-venda').value         = produtoExistente.preco_venda         || '';
    document.getElementById('entrada-qtd').value                 = produtoExistente.qtd_entrada         || '';
    if (catEl)  catEl.value        = produtoExistente.produto?.categoria || '';
    entradaFavorito                = produtoExistente.produto?.favorito  || false;
    if (favBtn) favBtn.textContent = entradaFavorito ? '⭐' : '☆';
  }
  abrirModal('modal-entrada');
}

function fecharModalEntrada() {
  stopScanner();
  fecharModal('modal-entrada');
}

async function buscarNoCatalogo() {
  const codigo = document.getElementById('entrada-codigo').value.trim();
  if (!codigo || codigo.length < 3) return;
  try {
    const data = await api('getCatalogo', { busca: codigo });
    const prod = data.produtos?.find(p => p.codigo === codigo);
    if (prod) {
      document.getElementById('entrada-nome').value       = prod.nome;
      document.getElementById('entrada-preco-loja').value = prod.preco_loja;
      atualizarPrecoSugerido();
      toast('Produto encontrado no catálogo!', 'success');
    }
  } catch (e) {}
}

function atualizarPrecoSugerido() {
  const precoLoja = parseFloat(document.getElementById('entrada-preco-loja').value);
  if (!precoLoja || !eventoAtivo) return;
  const sugerido = calcularPrecoSugerido(precoLoja, eventoAtivo.markup, eventoAtivo.arredondamento);
  document.getElementById('entrada-preco-venda').value = sugerido;
  document.getElementById('entrada-hint-sugerido').textContent =
    `Sugerido: R$ ${sugerido} (loja R$ ${precoLoja.toFixed(2)} + ${eventoAtivo.markup || 0}%)`;
}

async function salvarEntrada() {
  const codigo    = document.getElementById('entrada-codigo').value.trim();
  const nome      = document.getElementById('entrada-nome').value.trim();
  const precoLoja = parseFloat(document.getElementById('entrada-preco-loja').value);
  const precoVenda = parseFloat(document.getElementById('entrada-preco-venda').value);
  const qtd       = parseInt(document.getElementById('entrada-qtd').value);

  if (!nome)            { toast('Digite o nome do produto', 'error');    return; }
  if (isNaN(precoLoja)) { toast('Digite o preço de loja', 'error');      return; }
  if (isNaN(precoVenda)){ toast('Digite o preço de venda', 'error');     return; }
  if (!qtd || qtd < 1)  { toast('Digite a quantidade de entrada', 'error'); return; }

  mostrarLoading('Salvando...');
  try {
    // 1. Salva/atualiza no catálogo
    const categoria = document.getElementById('entrada-categoria')?.value.trim() || null;
    const catData = await api('salvarProduto', {
      id: produtoEditandoId || undefined,
      codigo: codigo || null,
      nome,
      preco_loja: precoLoja,
      categoria
    });
    const produtoId = catData.produto.id;

    // 2. Adiciona ao evento
    if (produtoEditandoId) {
      await api('editarEntrada', { eventoId: eventoAtivo.id, produtoId, qtd_entrada: qtd, preco_venda: precoVenda });
    } else {
      await api('adicionarEntrada', { eventoId: eventoAtivo.id, produtoId, qtd_entrada: qtd, preco_venda: precoVenda });
    }

    await aplicarFavoritoSeNecessario(produtoId);
    fecharModalEntrada(); toast('Produto salvo!', 'success'); await carregarEntrada();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}


// ── REPOSIÇÃO DE ESTOQUE ──
let produtoReposicaoAtual = null;

function abrirModalReposicao(p) {
  produtoReposicaoAtual = p;
  document.getElementById('rep-produto-nome').textContent   = p.produto?.nome || '—';
  document.getElementById('rep-produto-atual').textContent  = p.qtd_entrada;
  document.getElementById('rep-qtd').value                  = '';
  document.getElementById('rep-resultado').textContent      = p.qtd_entrada;
  document.getElementById('rep-resultado').style.color      = 'var(--text-3)';
  abrirModal('modal-reposicao');
  setTimeout(() => document.getElementById('rep-qtd').focus(), 300);
}

function atualizarPreviewReposicao() {
  if (!produtoReposicaoAtual) return;
  const qtdAtual  = produtoReposicaoAtual.qtd_entrada;
  const adicional = parseInt(document.getElementById('rep-qtd').value) || 0;
  const novo      = qtdAtual + adicional;
  const el        = document.getElementById('rep-resultado');
  el.textContent  = novo;
  el.style.color  = adicional > 0 ? 'var(--verde)' : 'var(--text-3)';
}

async function confirmarReposicao() {
  if (!produtoReposicaoAtual) return;
  const adicional = parseInt(document.getElementById('rep-qtd').value) || 0;
  if (adicional <= 0) { toast('Digite uma quantidade maior que zero', 'error'); return; }

  const novaQtd = produtoReposicaoAtual.qtd_entrada + adicional;

  mostrarLoading('Repondo estoque...');
  try {
    await api('editarEntrada', {
      eventoId:    eventoAtivo.id,
      produtoId:   produtoReposicaoAtual.produto_id,
      qtd_entrada: novaQtd,
      preco_venda: produtoReposicaoAtual.preco_venda
    });
    fecharModal('modal-reposicao');
    toast(`+${adicional} unidades adicionadas! Total: ${novaQtd}`, 'success');
    await carregarEntrada();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

async function removerProdutoEvento(produtoId) {
  if (!confirm('Remover este produto do evento?')) return;
  mostrarLoading('Removendo...');
  try {
    await api('removerDoEvento', { eventoId: eventoAtivo.id, produtoId });
    toast('Produto removido', 'info');
    await carregarEntrada();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ═══════════════════════════════════════════
//  RETORNO
// ═══════════════════════════════════════════
async function carregarRetorno() {
  mostrarLoading('Carregando...');
  try {
    const data = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
    produtos = data.produtos || [];
    renderListaRetorno();
    renderLancados();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

function switchRetTab(tab) {
  const isScanner = tab === 'scanner';
  document.getElementById('ret-painel-scanner').style.display = isScanner ? 'block' : 'none';
  document.getElementById('ret-painel-lista').style.display   = isScanner ? 'none'  : 'block';
  document.getElementById('tab-scanner').className = 'tab' + (isScanner ? ' active' : '');
  document.getElementById('tab-lista').className   = 'tab' + (!isScanner ? ' active' : '');
  if (!isScanner) { stopScanner(); renderListaRetorno(); }
}

function renderListaRetorno() {
  const el    = document.getElementById('ret-lista-produtos');
  const busca = (document.getElementById('ret-busca')?.value || '').toLowerCase();
  const lista = produtos.filter(p => {
    const nome   = (p.produto?.nome   || '').toLowerCase();
    const codigo = (p.produto?.codigo || '').toLowerCase();
    return !busca || nome.includes(busca) || codigo.includes(busca);
  });
  if (!lista.length) { el.innerHTML = emptyState('Nenhum produto encontrado'); return; }
  el.innerHTML = lista.map(p => {
    const done = p.qtd_retorno !== null;
    return `<div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer;${done ? 'opacity:.6' : ''}"
                 onclick='abrirCardRetorno(${JSON.stringify(p)})'>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.produto?.nome || '')}</div>
        <div style="font-size:11px;color:var(--text-4);font-family:monospace">${esc(p.produto?.codigo || 'sem código')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;color:var(--text-3)">Entrada: <strong>${p.qtd_entrada}</strong></div>
        ${done
          ? `<span class="badge badge-ativo" style="font-size:10px;margin-top:4px">Lançado: ${p.qtd_retorno}</span>`
          : `<span class="badge" style="background:var(--rosa-light);color:var(--rosa);border-color:var(--rosa-border);font-size:10px;margin-top:4px">Pendente</span>`}
      </div>
    </div>`;
  }).join('');
}

function renderLancados() {
  const lancados = produtos.filter(p => p.qtd_retorno !== null);
  const titulo   = document.getElementById('ret-titulo-lancados');
  const el       = document.getElementById('ret-lista-lancados');
  if (titulo) titulo.style.display = lancados.length ? 'block' : 'none';
  if (!lancados.length) { if (el) el.innerHTML = ''; return; }
  el.innerHTML = lancados.map(p => {
    const vendido = p.qtd_entrada - p.qtd_retorno;
    return `<div class="product-card">
      <div class="product-card-info">
        <div class="product-name">${esc(p.produto?.nome || '')}</div>
        <div class="product-pills">
          <span class="pill pill-azul">Entrada: ${p.qtd_entrada}</span>
          <span class="pill pill-rosa">Retorno: ${p.qtd_retorno}</span>
          <span class="pill pill-verde">Vendido: ${vendido}</span>
        </div>
      </div>
      <div class="product-actions">
        <button class="btn btn-icon btn-secondary" onclick='abrirCardRetorno(${JSON.stringify(p)})'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function abrirCardRetorno(p) {
  produtoRetornoAtual = p;
  document.getElementById('ret-card-nome').textContent    = p.produto?.nome || '—';
  document.getElementById('ret-card-codigo').textContent  = p.produto?.codigo || 'sem código';
  document.getElementById('ret-card-entrada').textContent = p.qtd_entrada;
  document.getElementById('ret-card-preco').textContent   = 'R$ ' + parseFloat(p.preco_venda).toFixed(2);
  document.getElementById('ret-qtd').value = p.qtd_retorno ?? 0;
  document.getElementById('ret-card').style.display = 'block';
  document.getElementById('ret-card').scrollIntoView({ behavior: 'smooth' });
  fecharModal('modal-opcoes-evento');
}

function ajustarQtdRetorno(d) {
  const inp = document.getElementById('ret-qtd');
  inp.value = Math.max(0, parseInt(inp.value || 0) + d);
}

async function salvarRetorno() {
  if (!produtoRetornoAtual) return;
  const qtd = parseInt(document.getElementById('ret-qtd').value);
  if (isNaN(qtd) || qtd < 0) { toast('Quantidade inválida', 'error'); return; }
  if (qtd > produtoRetornoAtual.qtd_entrada) {
    toast('Retorno não pode ser maior que a entrada', 'error'); return;
  }
  mostrarLoading('Salvando retorno...');
  try {
    await api('salvarRetorno', {
      eventoId:   eventoAtivo.id,
      produtoId:  produtoRetornoAtual.produto_id,
      qtd_retorno: qtd
    });
    document.getElementById('ret-card').style.display = 'none';
    produtoRetornoAtual = null;
    toast('Retorno salvo!', 'success');
    await carregarRetorno();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

function toggleScannerRetorno() {
  if (scannerRetornoAtivo) {
    stopScanner();
    document.getElementById('ret-scanner-idle').style.display    = 'flex';
    document.getElementById('ret-scanner-overlay').style.display = 'none';
    document.getElementById('btn-scanner-retorno-label').textContent = 'Escanear Produto';
    scannerRetornoAtivo = false;
  } else {
    document.getElementById('ret-scanner-idle').style.display = 'none';
    document.getElementById('ret-scanner-overlay').style.display = 'flex';
    document.getElementById('btn-scanner-retorno-label').textContent = 'Parar câmera';
    scannerRetornoAtivo = true;
    startScanner('video-retorno', (codigo) => {
      scannerRetornoAtivo = false;
      document.getElementById('ret-scanner-idle').style.display    = 'flex';
      document.getElementById('ret-scanner-overlay').style.display = 'none';
      document.getElementById('btn-scanner-retorno-label').textContent = 'Escanear Produto';
      const prod = produtos.find(p => p.produto?.codigo === codigo);
      if (prod) {
        abrirCardRetorno(prod);
        switchRetTab('scanner');
      } else {
        toast('Produto não encontrado neste evento', 'error');
      }
    });
  }
}

function toggleScannerEntrada() {
  if (scannerEntradaAtivo) {
    stopScanner();
    document.getElementById('entrada-scanner-idle').style.display    = 'flex';
    document.getElementById('entrada-scanner-overlay').style.display = 'none';
    document.getElementById('btn-scanner-entrada-label').textContent = 'Escanear Código';
    scannerEntradaAtivo = false;
  } else {
    document.getElementById('entrada-scanner-idle').style.display = 'none';
    document.getElementById('entrada-scanner-overlay').style.display = 'flex';
    document.getElementById('btn-scanner-entrada-label').textContent = 'Parar câmera';
    scannerEntradaAtivo = true;
    startScanner('video-entrada', (codigo) => {
      stopScanner();
      scannerEntradaAtivo = false;
      document.getElementById('entrada-scanner-idle').style.display    = 'flex';
      document.getElementById('entrada-scanner-overlay').style.display = 'none';
      document.getElementById('btn-scanner-entrada-label').textContent = 'Escanear Código';
      document.getElementById('entrada-codigo').value = codigo;
      document.getElementById('entrada-scanned').style.display = 'flex';
      document.getElementById('entrada-scanned-code').textContent = codigo;
      buscarNoCatalogo();
    });
  }
}

// ═══════════════════════════════════════════
//  RELATÓRIO
// ═══════════════════════════════════════════
async function carregarRelatorio() {
  mostrarLoading('Carregando relatório...');
  try {
    const data = await api('getRelatorio', { eventoId: eventoAtivo.id });
    renderRelatorio(data);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

function switchRelTab(tab) {
  const isEvento = tab === 'evento';
  document.getElementById('rel-painel-evento').style.display = isEvento ? 'block' : 'none';
  document.getElementById('rel-painel-comp').style.display   = isEvento ? 'none'  : 'block';
  document.getElementById('tab-rel-evento').className = 'tab' + (isEvento ? ' active' : '');
  document.getElementById('tab-rel-comp').className   = 'tab' + (!isEvento ? ' active' : '');
  if (!isEvento) carregarComparativo();
}

function renderRelatorio(data) {
  const { produtos: prods, totais } = data;

  // Stats
  document.getElementById('rel-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-val azul">${prods.length}</div>
      <div class="stat-lbl">Produtos</div>
    </div>
    <div class="stat-card">
      <div class="stat-val rosa">${totais.totalVendidoPdv}</div>
      <div class="stat-lbl">Vendido PDV</div>
    </div>
    <div class="stat-card">
      <div class="stat-val verde" style="font-size:13px">R$${totais.faturamentoPdv.toFixed(2)}</div>
      <div class="stat-lbl">Fat. PDV</div>
    </div>`;

  const tabela = document.getElementById('rel-tabela');
  if (!prods.length) { tabela.innerHTML = emptyState('Nenhum produto cadastrado'); return; }

  const semRetorno = prods.filter(p => p.qtd_retorno === null).length;

  // Ordena por mais vendido no PDV
  const sorted = [...prods].sort((a, b) => b.vendido_pdv - a.vendido_pdv);

  tabela.innerHTML = `
    ${semRetorno > 0 ? `
      <div style="background:var(--rosa-light);border:1px solid var(--rosa-border);border-radius:var(--radius-sm);padding:10px 13px;font-size:12px;color:var(--vermelho);margin-bottom:12px">
        ⚠️ ${semRetorno} produto(s) sem retorno físico lançado
      </div>` : ''}

    <!-- Totais por fonte -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <div class="card" style="background:var(--rosa-light);border-color:var(--rosa-border)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--rosa);margin-bottom:4px">📱 PDV</div>
        <div style="font-size:18px;font-weight:800;color:var(--rosa)">${totais.totalVendidoPdv} <span style="font-size:11px;font-weight:400">unid.</span></div>
        <div style="font-size:12px;color:var(--text-3)">R$${totais.faturamentoPdv.toFixed(2)}</div>
      </div>
      <div class="card" style="background:var(--azul-light);border-color:var(--azul-border)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--azul);margin-bottom:4px">📦 Retorno</div>
        <div style="font-size:18px;font-weight:800;color:var(--azul)">${totais.totalVendidoRetorno} <span style="font-size:11px;font-weight:400">unid.</span></div>
        <div style="font-size:12px;color:var(--text-3)">R$${totais.faturamentoRetorno.toFixed(2)}</div>
      </div>
    </div>

    <!-- Tabela por produto -->
    <div class="table-wrap">
      <div class="table-header" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr">
        <span>Produto</span>
        <span>Entrada</span>
        <span>🛒 PDV</span>
        <span>📦 Retorno</span>
        <span>Dif.</span>
      </div>
      ${sorted.map(p => {
        const difOk   = p.diferenca === null || p.diferenca === 0;
        const difPos  = p.diferenca > 0;
        const difCor  = p.diferenca === null ? 'var(--text-4)'
                      : p.diferenca === 0    ? 'var(--verde)'
                      : p.diferenca > 0      ? 'var(--azul)'
                      : 'var(--vermelho)';
        return `
        <div class="table-row" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(p.produto?.nome || '')}</div>
            <div style="font-size:10px;color:var(--text-4);font-family:monospace">${esc(p.produto?.codigo || '')}</div>
          </div>
          <div style="font-family:monospace;font-size:13px">${p.qtd_entrada}</div>
          <div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--rosa)">
            ${p.vendido_pdv || 0}
            ${p.vendido_pdv > 0 ? `<div style="font-size:10px;color:var(--text-4)">R$${p.receita_pdv.toFixed(2)}</div>` : ''}
          </div>
          <div style="font-family:monospace;font-size:13px;color:var(--azul)">
            ${p.vendido_retorno !== null ? p.vendido_retorno : '<span style="color:var(--text-4)">—</span>'}
          </div>
          <div style="font-family:monospace;font-size:13px;font-weight:700;color:${difCor}">
            ${p.diferenca === null ? '—'
              : p.diferenca === 0  ? '✓'
              : p.diferenca > 0    ? '+' + p.diferenca
              : p.diferenca}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function carregarComparativo() {
  const el = document.getElementById('rel-comp-conteudo');
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-4)">Carregando...</div>';
  try {
    const data = await api('getComparativo');
    renderComparativo(data, el);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderComparativo(data, el) {
  const { eventos, ranking } = data;
  if (!ranking.length) { el.innerHTML = emptyState('Nenhum dado disponível'); return; }
  const evAtivos = eventos.filter(e => ranking.some(r => r.eventos[e.id]));
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-header" style="grid-template-columns:2fr ${evAtivos.map(() => '1fr').join(' ')} 1fr">
        <span>Produto</span>
        ${evAtivos.map(e => `<span style="font-size:9px">${esc(e.nome.substring(0, 8))}</span>`).join('')}
        <span>Total</span>
      </div>
      ${ranking.slice(0, 20).map((r, i) => `
        <div class="table-row" style="grid-template-columns:2fr ${evAtivos.map(() => '1fr').join(' ')} 1fr">
          <div>
            <span style="font-size:10px;font-weight:800;color:var(--rosa);margin-right:5px">${i + 1}º</span>
            <span style="font-size:13px;font-weight:600">${esc(r.produto.nome)}</span>
          </div>
          ${evAtivos.map(e => `<div style="font-family:monospace;font-size:13px;color:var(--text-3)">${r.eventos[e.id]?.vendido ?? '—'}</div>`).join('')}
          <div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--verde)">${r.totalVendido}</div>
        </div>`).join('')}
    </div>`;
}

function exportarCSV() {
  if (!produtos.length) { toast('Nenhum produto para exportar', 'error'); return; }
  const header = 'Produto,Código,Entrada,Retorno,Vendido,Preço Venda,Faturamento';
  const rows = produtos.map(p => {
    const vendido = p.qtd_retorno !== null ? p.qtd_entrada - p.qtd_retorno : '';
    const fat = p.qtd_retorno !== null ? (p.qtd_entrada - p.qtd_retorno) * parseFloat(p.preco_venda) : '';
    return [
      `"${p.produto?.nome || ''}"`,
      p.produto?.codigo || '',
      p.qtd_entrada,
      p.qtd_retorno ?? '',
      vendido,
      parseFloat(p.preco_venda).toFixed(2),
      fat !== '' ? fat.toFixed(2) : ''
    ].join(',');
  });
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `haru_${(eventoAtivo?.nome || 'evento').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exportado!', 'success');
}

// ═══════════════════════════════════════════
//  PESQUISA
// ═══════════════════════════════════════════
function iniciarPesquisa() {
  document.getElementById('pesquisa-input').value = '';
  document.getElementById('pesquisa-scanner-wrap').style.display = 'none';
  renderPesquisa(); // mostra lista completa imediatamente
}

let scannerPesquisaAtivo = false;

function toggleScannerPesquisa() {
  if (scannerPesquisaAtivo) {
    stopScanner();
    scannerPesquisaAtivo = false;
    document.getElementById('pesquisa-scanner-wrap').style.display = 'none';
    document.getElementById('pesquisa-scan-btn').style.color = 'var(--text-4)';
    return;
  }
  scannerPesquisaAtivo = true;
  document.getElementById('pesquisa-scanner-wrap').style.display = 'block';
  document.getElementById('pesquisa-scan-btn').style.color = 'var(--rosa)';
  document.getElementById('pesquisa-scanner-idle').style.display = 'flex';
  document.getElementById('pesquisa-scanner-overlay').style.display = 'none';
  startScanner('video-pesquisa', (codigo) => {
    scannerPesquisaAtivo = false;
    document.getElementById('pesquisa-scanner-wrap').style.display = 'none';
    document.getElementById('pesquisa-scan-btn').style.color = 'var(--text-4)';
    document.getElementById('pesquisa-input').value = codigo;
    renderPesquisa();
    toast('Código lido: ' + codigo, 'success');
  });
}

function renderPesquisa() {
  const busca = document.getElementById('pesquisa-input').value.toLowerCase().trim();
  const el    = document.getElementById('pesquisa-resultados');
  const lista = busca
    ? produtos.filter(p =>
        (p.produto?.nome   || '').toLowerCase().includes(busca) ||
        (p.produto?.codigo || '').toLowerCase().includes(busca))
    : [...produtos].sort((a, b) =>
        (a.produto?.nome || '').localeCompare(b.produto?.nome || '', 'pt-BR'));

  if (!lista.length) {
    el.innerHTML = emptyState(busca ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado');
    return;
  }

  el.innerHTML = lista.map(p => {
    const vendido   = p.qtd_retorno !== null ? p.qtd_entrada - p.qtd_retorno : null;
    const estoqueAt = p.qtd_retorno !== null ? p.qtd_retorno : p.qtd_entrada;
    return `<div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;margin-bottom:2px">${esc(p.produto?.nome || '')}</div>
          ${p.produto?.codigo ? `<div style="font-size:10px;color:var(--text-4);font-family:monospace;margin-bottom:6px">${esc(p.produto.codigo)}</div>` : ''}
          ${p.produto?.categoria ? `<span style="font-size:10px;background:var(--surface2);color:var(--text-3);padding:2px 8px;border-radius:20px">${esc(p.produto.categoria)}</span>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:15px;font-weight:800;color:var(--rosa)">R$${parseFloat(p.preco_venda).toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-4)">loja: R$${parseFloat(p.produto?.preco_loja || 0).toFixed(2)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px">
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px;text-align:center">
          <div style="font-size:15px;font-weight:800;color:var(--azul)">${p.qtd_entrada}</div>
          <div style="font-size:10px;color:var(--text-4)">Entrada</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px;text-align:center">
          <div style="font-size:15px;font-weight:800;color:${estoqueAt > 0 ? 'var(--verde)' : 'var(--vermelho)'}">${estoqueAt}</div>
          <div style="font-size:10px;color:var(--text-4)">Estoque</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px;text-align:center">
          <div style="font-size:15px;font-weight:800;color:var(--rosa)">${vendido !== null ? vendido : '—'}</div>
          <div style="font-size:10px;color:var(--text-4)">Vendido</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════
function switchAdminTab(tab) {
  ['eventos', 'catalogo', 'usuarios'].forEach(t => {
    document.getElementById('admin-painel-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('admin-tab-' + t).className =
      'admin-nav-btn' + (t === tab ? ' active' : '');
  });
  if (tab === 'eventos')  carregarAdminEventos();
  if (tab === 'catalogo') carregarAdminCatalogo();
  if (tab === 'usuarios') carregarAdminUsuarios();
}

function carregarAdmin(tab) {
  switchAdminTab(tab || 'eventos');
}

async function carregarAdminEventos() {
  const el = document.getElementById('admin-painel-eventos');
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-4)">Carregando...</div>';
  try {
    const data = await api('getEventos');
    const lista = data.eventos || [];
    el.innerHTML = `
      <button class="btn btn-primary mb-12" onclick="abrirModalNovoEvento()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Novo Evento
      </button>
      <div class="gap-10">
        ${lista.length ? lista.map(ev => `
          <div class="card" style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700">${esc(ev.nome)}</div>
              <div style="font-size:11px;color:var(--text-4)">${ev.data} · Markup: ${ev.markup || 0}%</div>
              ${ev.em_andamento ? `<span class="badge badge-ativo" style="margin-top:4px">▶ Em andamento</span>` : ''}
            </div>
            <span class="badge badge-${ev.status}">${ev.status}</span>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${ev.status === 'ativo' && !ev.em_andamento
                ? `<button class="btn btn-success btn-sm" style="font-size:11px;width:auto;padding:5px 10px" onclick="definirEventoEmAndamento('${ev.id}')">▶ Iniciar</button>`
                : ev.em_andamento
                ? `<button class="btn btn-secondary btn-sm" style="font-size:11px;width:auto;padding:5px 10px" onclick="definirEventoEmAndamento(null)">⏹ Parar</button>`
                : ''}
              <button class="btn btn-icon btn-secondary" onclick='abrirOpcoesEvento(${JSON.stringify(ev)})'>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
              </button>
            </div>
          </div>`).join('') : emptyState('Nenhum evento criado')}
      </div>`;
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function carregarAdminCatalogo() {
  const el = document.getElementById('admin-painel-catalogo');
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-4)">Carregando...</div>';
  try {
    const data = await api('getCatalogo');
    catalogo = data.produtos || [];
    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-primary" style="flex:1" onclick="abrirModalProdutoAdmin()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Novo Produto
        </button>
        <button class="btn btn-secondary" style="flex:1" onclick="abrirModal('modal-csv')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          Importar CSV
        </button>
      </div>
      <div class="product-list">
        ${catalogo.length ? catalogo.map(p => `
          <div class="product-card">
            <div class="product-card-info">
              <div class="product-name">${esc(p.nome)}</div>
              <div class="product-code">${esc(p.codigo || 'sem código')}</div>
              <div class="product-pills">
                <span class="pill pill-verde">Loja: R$${parseFloat(p.preco_loja).toFixed(2)}</span>
              </div>
            </div>
            <div class="product-actions">
              <button class="btn btn-icon btn-secondary" onclick='abrirModalProdutoAdmin(${JSON.stringify(p)})'>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
          </div>`).join('') : emptyState('Nenhum produto no catálogo')}
      </div>`;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function abrirModalProdutoAdmin(prod = null) {
  produtoAdminEditandoId = prod?.id || null;
  document.getElementById('modal-produto-admin-titulo').textContent = prod ? 'Editar Produto' : 'Novo Produto';
  document.getElementById('admin-prod-codigo').value = prod?.codigo     || '';
  document.getElementById('admin-prod-nome').value   = prod?.nome       || '';
  document.getElementById('admin-prod-preco').value  = prod?.preco_loja  || '';
  const catEl = document.getElementById('admin-prod-categoria');
  if (catEl) catEl.value = prod?.categoria || '';
  abrirModal('modal-produto-admin');
}

async function salvarProdutoAdmin() {
  const codigo    = document.getElementById('admin-prod-codigo').value.trim();
  const nome      = document.getElementById('admin-prod-nome').value.trim();
  const precoLoja = document.getElementById('admin-prod-preco').value;
  const categoria = document.getElementById('admin-prod-categoria')?.value.trim() || null;
  if (!nome)      { toast('Digite o nome do produto', 'error'); return; }
  if (!precoLoja) { toast('Digite o preço de loja', 'error');   return; }
  mostrarLoading('Salvando...');
  try {
    await api('salvarProduto', {
      id: produtoAdminEditandoId,
      codigo: codigo || null,
      nome,
      preco_loja: parseFloat(precoLoja),
      categoria
    });
    fecharModal('modal-produto-admin');
    toast('Produto salvo!', 'success');
    await carregarAdminCatalogo();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

async function carregarAdminUsuarios() {
  const el = document.getElementById('admin-painel-usuarios');
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-4)">Carregando...</div>';
  try {
    const data = await api('getUsuarios');
    const lista = data.usuarios || [];
    el.innerHTML = `
      <button class="btn btn-primary mb-12" onclick="abrirModalUsuarioAdmin()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Novo Usuário
      </button>
      <div class="gap-10">
        ${lista.map(u => `
          <div class="card" style="display:flex;align-items:center;gap:12px">
            <div class="avatar" style="width:38px;height:38px;font-size:14px;flex-shrink:0">${u.nome.charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700">${esc(u.nome)}</div>
              <div style="font-size:11px;color:var(--text-4)">@${esc(u.usuario)}</div>
            </div>
            <span class="badge badge-${u.perfil === 'admin' ? 'admin' : 'func'}">${u.perfil}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-icon btn-secondary" onclick='abrirModalUsuarioAdmin(${JSON.stringify(u)})'>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-icon ${u.ativo ? 'btn-danger' : 'btn-success'}"
                      onclick="toggleUsuario('${u.id}', ${!u.ativo})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${u.ativo
                    ? '<path d="M18.36 6.64A9 9 0 115.64 18.36M12 2v4"/>'
                    : '<path d="M20 6L9 17l-5-5"/>'}
                </svg>
              </button>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function abrirModalUsuarioAdmin(user = null) {
  usuarioAdminEditandoId = user?.id || null;
  document.getElementById('modal-usuario-admin-titulo').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('admin-user-id').value     = user?.id     || '';
  document.getElementById('admin-user-login').value  = user?.usuario || '';
  document.getElementById('admin-user-nome').value   = user?.nome    || '';
  document.getElementById('admin-user-senha').value  = '';
  document.getElementById('admin-user-perfil').value     = user?.perfil        || 'funcionario';
  document.getElementById('admin-user-relatorio').checked = user?.ver_relatorio || false;
  // Admin sempre vê relatório — esconde o campo
  document.getElementById('campo-ver-relatorio').style.display =
    (user?.perfil === 'admin') ? 'none' : 'block';
  abrirModal('modal-usuario-admin');
  document.getElementById('admin-user-perfil')
    .addEventListener('change', function() {
      document.getElementById('campo-ver-relatorio').style.display =
        this.value === 'admin' ? 'none' : 'block';
    });
}

async function salvarUsuarioAdmin() {
  const login  = document.getElementById('admin-user-login').value.trim();
  const nome   = document.getElementById('admin-user-nome').value.trim();
  const senha  = document.getElementById('admin-user-senha').value;
  const perfil = document.getElementById('admin-user-perfil').value;
  if (!login || !nome) { toast('Preencha login e nome', 'error'); return; }
  mostrarLoading('Salvando...');
  const verRelatorio = document.getElementById('admin-user-relatorio').checked;
  try {
    await api('salvarUsuario', {
      id: usuarioAdminEditandoId,
      usuario: login, nome, senha, perfil,
      ver_relatorio: verRelatorio
    });
    fecharModal('modal-usuario-admin');
    toast('Usuário salvo!', 'success');
    await carregarAdminUsuarios();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

async function toggleUsuario(id, ativo) {
  mostrarLoading(ativo ? 'Ativando...' : 'Desativando...');
  try {
    await api('toggleUsuario', { id, ativo });
    toast(ativo ? 'Usuário ativado' : 'Usuário desativado', 'info');
    await carregarAdminUsuarios();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ═══════════════════════════════════════════
//  CSV
// ═══════════════════════════════════════════
function lerCSV() {
  const file = document.getElementById('csv-file').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const linhas = e.target.result.split('\n').filter(l => l.trim());
    const header = linhas[0].toLowerCase().split(',').map(h => h.trim());
    const iCodigo = header.indexOf('codigo');
    const iNome   = header.indexOf('nome');
    const iPreco  = header.indexOf('preco_loja');
    if (iNome === -1 || iPreco === -1) {
      toast('CSV inválido. Precisa ter colunas: codigo, nome, preco_loja', 'error');
      return;
    }
    csvDados = linhas.slice(1).map(linha => {
      const cols = linha.split(',');
      return {
        codigo:    iCodigo >= 0 ? cols[iCodigo]?.trim() : '',
        nome:      cols[iNome]?.trim() || '',
        preco_loja: cols[iPreco]?.trim() || ''
      };
    }).filter(p => p.nome && p.preco_loja);

    document.getElementById('csv-count').textContent = csvDados.length;
    document.getElementById('csv-preview-lista').innerHTML =
      csvDados.slice(0, 5).map(p =>
        `<div style="padding:3px 0;border-bottom:1px solid var(--border)">${p.codigo || '—'} | ${p.nome} | R$${p.preco_loja}</div>`
      ).join('') + (csvDados.length > 5 ? `<div style="color:var(--text-4);padding-top:4px">...e mais ${csvDados.length - 5} produtos</div>` : '');
    document.getElementById('csv-preview').style.display   = 'block';
    document.getElementById('btn-importar-csv').style.display = 'flex';
  };
  reader.readAsText(file);
}

async function importarCSV() {
  if (!csvDados.length) { toast('Nenhum produto para importar', 'error'); return; }
  mostrarLoading(`Importando ${csvDados.length} produtos...`);
  try {
    const data = await api('importarCSV', { produtos: csvDados });
    fecharModal('modal-csv');
    toast(`Importado: ${data.criados} criados, ${data.atualizados} atualizados`, 'success');
    csvDados = [];
    await carregarAdminCatalogo();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ═══════════════════════════════════════════
//  PDV — OFFLINE + REDESIGN
// ═══════════════════════════════════════════

// ── OFFLINE / INDEXEDDB ──
const DB_NAME    = 'haruDB';
const DB_VERSION = 1;
let   db         = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('vendas_pendentes')) {
        d.createObjectStore('vendas_pendentes', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('produtos_cache')) {
        d.createObjectStore('produtos_cache', { keyPath: 'evento_id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e);
  });
}

async function salvarVendaPendente(venda) {
  const d = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = d.transaction('vendas_pendentes', 'readwrite');
    const store = tx.objectStore('vendas_pendentes');
    const req   = store.add({ ...venda, _pendente: true, _ts: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e);
  });
}

async function getVendasPendentes() {
  const d = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = d.transaction('vendas_pendentes', 'readonly');
    const store = tx.objectStore('vendas_pendentes');
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e);
  });
}

async function deletarVendaPendente(id) {
  const d = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = d.transaction('vendas_pendentes', 'readwrite');
    const store = tx.objectStore('vendas_pendentes');
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e);
  });
}

async function salvarCacheLocal(eventoId, prods) {
  const d = await abrirDB();
  return new Promise((resolve) => {
    const tx    = d.transaction('produtos_cache', 'readwrite');
    const store = tx.objectStore('produtos_cache');
    store.put({ evento_id: eventoId, produtos: prods, ts: Date.now() });
    tx.oncomplete = () => resolve();
  });
}

async function getCacheLocal(eventoId) {
  const d = await abrirDB();
  return new Promise((resolve) => {
    const tx    = d.transaction('produtos_cache', 'readonly');
    const store = tx.objectStore('produtos_cache');
    const req   = store.get(eventoId);
    req.onsuccess = () => resolve(req.result?.produtos || null);
    req.onerror   = () => resolve(null);
  });
}

// ── DETECÇÃO OFFLINE ──
let isOnline = navigator.onLine;

function iniciarMonitorOffline() {
  window.addEventListener('online',  () => { isOnline = true;  atualizarBadgeOffline(); sincronizarPendentes(); });
  window.addEventListener('offline', () => { isOnline = false; atualizarBadgeOffline(); });
  atualizarBadgeOffline();
  // Tenta sincronizar pendentes a cada 30 segundos automaticamente
  setInterval(() => {
    sincronizarPendentes();
  }, 30000);
}

function atualizarBadgeOffline() {
  const badge = document.getElementById('offline-badge');
  if (badge) badge.classList.toggle('show', !isOnline);
}

async function atualizarBadgePendentes() {
  try {
    const pendentes = await getVendasPendentes();
    const count     = pendentes.length;
    const badge     = document.getElementById('pdv-sync-badge');
    const countEl   = document.getElementById('pdv-pendentes-count');
    if (badge)   badge.classList.toggle('show', count > 0);
    if (countEl) countEl.textContent = count;
  } catch(e) {}
}

async function sincronizarPendentes() {
  try {
    const pendentes = await getVendasPendentes();
    if (!pendentes.length) return;
    let sincronizadas = 0;
    for (const v of pendentes) {
      try {
        const { id: localId, _pendente, _ts, ...venda } = v;
        await api('registrarVenda', venda);
        await deletarVendaPendente(localId);
        sincronizadas++;
      } catch(e) {
        console.warn('Erro ao sincronizar venda:', e);
        break; // Para se não tiver conexão
      }
    }
    if (sincronizadas > 0) {
      isOnline = true;
      atualizarBadgeOffline();
      await atualizarBadgePendentes();
      toast(`${sincronizadas} venda(s) sincronizada(s)!`, 'success');
      await carregarVendas();
    }
  } catch(e) {}
}

// ── PDV STATE ──
let carrinho           = [];
let pagamentoSelecionado = null;
let scannerSorvAtivo   = false;
let pdvTelaAnterior    = 'home';

// ── NAVEGAÇÃO PDV ──
function goSubPdv(sub) {
  stopScanner();
  const pages = ['page-pdv','page-pdv-venda','page-pdv-rapido',
                 'page-pdv-sorvetes','page-pdv-historico','page-pdv-carrinho'];
  pages.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.remove('active');
  });

  if (sub === 'home') {
    document.getElementById('page-pdv').classList.add('active');
    atualizarBadgePendentes();
    return;
  }
  if (sub === 'nova-venda') {
    pdvTelaAnterior = 'nova-venda';
    document.getElementById('page-pdv-venda').classList.add('active');
    const busEl = document.getElementById('venda-busca');
    if (busEl) busEl.value = '';
    renderGradeProdutos();
    renderAtalhosVenda();
    atualizarFab();
    return;
  }
  if (sub === 'rapido') {
    pdvTelaAnterior = 'rapido';
    document.getElementById('page-pdv-rapido').classList.add('active');
    renderRapido();
    atualizarFab();
    return;
  }
  if (sub === 'sorvetes') {
    pdvTelaAnterior = 'sorvetes';
    document.getElementById('page-pdv-sorvetes').classList.add('active');
    renderSorvetes();
    atualizarFab();
    return;
  }
  if (sub === 'historico') {
    document.getElementById('page-pdv-historico').classList.add('active');
    carregarVendas();
    return;
  }
}

function iniciarPdv() {
  const el = document.getElementById('pdv-evento-nome');
  if (el) el.textContent = eventoAtivo?.nome || '';
  atualizarBadgePendentes();
}

// ── CARRINHO ──
function adicionarAoCarrinho(produto) {
  const existing = carrinho.find(i => i.produto_id === produto.produto_id);
  if (existing) {
    existing.qtd++;
  } else {
    carrinho.push({
      produto_id: produto.produto_id,
      nome:       produto.produto?.nome || produto.nome || '',
      preco_unit: parseFloat(produto.preco_venda),
      qtd:        1
    });
  }
  atualizarFab();
  toast((produto.produto?.nome || produto.nome || '') + ' adicionado!', 'success');
}

function atualizarFab() {
  const total = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const qtd   = carrinho.reduce((s, i) => s + i.qtd, 0);
  const show  = carrinho.length > 0;

  ['venda','rapido','sorv'].forEach(prefix => {
    const fab   = document.getElementById(prefix + '-fab');
    const qtdEl = document.getElementById(prefix + '-fab-qtd');
    const totEl = document.getElementById(prefix + '-fab-total');
    if (fab)   fab.style.display   = show ? 'flex' : 'none';
    if (qtdEl) qtdEl.textContent   = qtd;
    if (totEl) totEl.textContent   = 'R$ ' + total.toFixed(2);
  });
}

function abrirCarrinho() {
  const pages = ['page-pdv-venda','page-pdv-rapido','page-pdv-sorvetes'];
  pages.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.remove('active');
  });
  document.getElementById('page-pdv-carrinho').classList.add('active');
  renderCarrinhoCompleto();
}

function voltarDaCarrinho() {
  document.getElementById('page-pdv-carrinho').classList.remove('active');
  goSubPdv(pdvTelaAnterior || 'nova-venda');
}

function limparCarrinho() {
  if (!carrinho.length) return;
  if (!confirm('Limpar o carrinho?')) return;
  carrinho = [];
  pagamentoSelecionado = null;
  renderCarrinhoCompleto();
  atualizarFab();
}

function renderCarrinhoCompleto() {
  const el = document.getElementById('carrinho-itens');
  if (!carrinho.length) {
    el.innerHTML = emptyState('Carrinho vazio');
    document.getElementById('btn-confirmar-venda').disabled = true;
    return;
  }
  el.innerHTML = carrinho.map((item, idx) => `
    <div class="card" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${esc(item.nome)}</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:2px">
          ${item.qtd}x R$${item.preco_unit.toFixed(2)} =
          <strong style="color:var(--rosa)">R$${(item.qtd * item.preco_unit).toFixed(2)}</strong>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="qty-btn" style="width:30px;height:30px;font-size:16px"
                onclick="ajustarCarrinho(${idx},-1)">−</button>
        <span style="font-family:monospace;font-weight:700;min-width:20px;text-align:center">${item.qtd}</span>
        <button class="qty-btn" style="width:30px;height:30px;font-size:16px"
                onclick="ajustarCarrinho(${idx},1)">+</button>
        <button class="btn btn-icon btn-danger" onclick="removerDoCarrinho(${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>
    </div>`).join('');
  atualizarTotalPdv();
}

function ajustarCarrinho(idx, delta) {
  carrinho[idx].qtd = Math.max(1, carrinho[idx].qtd + delta);
  renderCarrinhoCompleto();
  atualizarFab();
}

function removerDoCarrinho(idx) {
  carrinho.splice(idx, 1);
  renderCarrinhoCompleto();
  atualizarFab();
}

function atualizarTotalPdv() {
  const subtotal = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const desconto = parseFloat(document.getElementById('carr-desconto')?.value) || 0;
  const total    = Math.max(0, subtotal - desconto);
  const sub = document.getElementById('carr-subtotal');
  const tot = document.getElementById('carr-total');
  if (sub) sub.textContent = 'R$ ' + subtotal.toFixed(2);
  if (tot) tot.textContent = 'R$ ' + total.toFixed(2);
  calcularTroco();
  verificarConfirmar();
}

// ── PAGAMENTO ──
function selecionarPagamento(forma) {
  pagamentoSelecionado = forma;
  document.querySelectorAll('.pdv-pag-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById('pag-' + forma);
  if (btn) btn.classList.add('selected');
  const wrap = document.getElementById('pdv-troco-wrap');
  if (wrap) wrap.style.display = forma === 'dinheiro' ? 'block' : 'none';
  if (forma !== 'dinheiro') {
    const rec = document.getElementById('pdv-recebido');
    const trv = document.getElementById('pdv-troco-val');
    if (rec) rec.value = '';
    if (trv) trv.textContent = 'R$ 0,00';
  }
  verificarConfirmar();
}

function calcularTroco() {
  if (pagamentoSelecionado !== 'dinheiro') return;
  const desconto = parseFloat(document.getElementById('carr-desconto')?.value) || 0;
  const subtotal = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total    = Math.max(0, subtotal - desconto);
  const recebido = parseFloat(document.getElementById('pdv-recebido')?.value) || 0;
  const troco    = recebido - total;
  const el       = document.getElementById('pdv-troco-val');
  if (el) {
    el.textContent   = troco >= 0 ? 'R$ ' + troco.toFixed(2) : 'Valor insuficiente';
    el.style.color   = troco >= 0 ? 'var(--verde)' : 'var(--vermelho)';
  }
  verificarConfirmar();
}

function verificarConfirmar() {
  const btn = document.getElementById('btn-confirmar-venda');
  if (!btn) return;
  const temItens    = carrinho.length > 0;
  const temPag      = !!pagamentoSelecionado;
  const desconto    = parseFloat(document.getElementById('carr-desconto')?.value) || 0;
  const subtotal    = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total       = Math.max(0, subtotal - desconto);
  const trocoOk     = pagamentoSelecionado !== 'dinheiro' ||
    (parseFloat(document.getElementById('pdv-recebido')?.value) || 0) >= total;
  btn.disabled = !(temItens && temPag && trocoOk);
}

// ── CONFIRMAR VENDA ──
async function confirmarVenda() {
  if (!carrinho.length || !pagamentoSelecionado) return;
  const desconto       = parseFloat(document.getElementById('carr-desconto')?.value) || 0;
  const subtotal       = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total          = Math.max(0, subtotal - desconto);
  const valor_recebido = pagamentoSelecionado === 'dinheiro'
    ? parseFloat(document.getElementById('pdv-recebido')?.value) || 0 : null;
  const itens = carrinho.map(i => ({
    produto_id: i.produto_id, nome: i.nome,
    qtd: i.qtd, preco_unit: i.preco_unit, subtotal: i.qtd * i.preco_unit
  }));
  const venda = {
    eventoId: eventoAtivo.id, itens, subtotal, desconto, total,
    forma_pagamento: pagamentoSelecionado, valor_recebido
  };

  mostrarLoading('Registrando venda...');
  let vendaSalva = false;
  try {
    // Tenta salvar online primeiro
    await api('registrarVenda', venda);
    toast('Venda registrada!', 'success');
    vendaSalva = true;
  } catch (e) {
    // Se falhar por rede/timeout, salva localmente
    const erroRede = e.name === 'AbortError' ||
      e.message?.includes('Tempo esgotado') ||
      e.message?.includes('Failed to fetch') ||
      e.message?.includes('NetworkError') ||
      e.message?.includes('Network request failed');

    if (erroRede) {
      try {
        await salvarVendaPendente(venda);
        await atualizarBadgePendentes();
        isOnline = false;
        atualizarBadgeOffline();
        toast('Sem conexão — venda salva localmente e será sincronizada depois ✓', 'info');
        vendaSalva = true;
      } catch (dbErr) {
        toast('Erro ao salvar venda offline: ' + dbErr.message, 'error');
      }
    } else {
      toast(e.message, 'error');
    }
  } finally {
    esconderLoading();
  }

  if (vendaSalva) {
    // Reset carrinho
    carrinho = []; pagamentoSelecionado = null;
    const desc = document.getElementById('carr-desconto');
    const rec  = document.getElementById('pdv-recebido');
    const trv  = document.getElementById('pdv-troco-val');
    const wrap = document.getElementById('pdv-troco-wrap');
    if (desc) desc.value = '0';
    if (rec)  rec.value  = '';
    if (trv)  trv.textContent = 'R$ 0,00';
    if (wrap) wrap.style.display = 'none';
    document.querySelectorAll('.pdv-pag-btn').forEach(b => b.classList.remove('selected'));
    atualizarFab();
    goSubPdv('home');
  }
}

// ── GRADE DE PRODUTOS (Nova Venda) ──
function renderGradeProdutos() {
  const el    = document.getElementById('venda-grade');
  const busca = (document.getElementById('venda-busca')?.value || '').toLowerCase();

  // Sem busca: mostra mensagem orientativa
  if (!busca) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px 0;color:var(--text-4);font-size:13px">
      Digite para buscar ou escaneie o código de barras
    </div>`;
    return;
  }

  const lista = produtos.filter(p =>
    (p.produto?.nome   || '').toLowerCase().includes(busca) ||
    (p.produto?.codigo || '').toLowerCase().includes(busca)
  );
  if (!lista.length) { el.innerHTML = emptyState('Nenhum produto encontrado'); return; }
  el.innerHTML = lista.map(p => `
    <div class="pdv-grade-item" onclick='adicionarAoCarrinho(${JSON.stringify(p)})'>
      <div class="pgi-nome">${esc(p.produto?.nome || '')}</div>
      ${p.produto?.codigo ? `<div class="pgi-codigo">${esc(p.produto.codigo)}</div>` : ''}
      <div class="pgi-preco">R$ ${parseFloat(p.preco_venda).toFixed(2)}</div>
      <div class="pgi-estoque">Estoque: ${p.qtd_entrada}</div>
    </div>`).join('');
}

// ── SCANNER NOVA VENDA ──
let scannerVendaAtivo = false;

function toggleScannerVenda() {
  if (scannerVendaAtivo) {
    stopScanner();
    scannerVendaAtivo = false;
    document.getElementById('venda-scanner-wrap').style.display   = 'none';
    document.getElementById('btn-scanner-venda-label').textContent = 'Escanear Produto';
  } else {
    scannerVendaAtivo = true;
    document.getElementById('venda-scanner-wrap').style.display    = 'block';
    document.getElementById('venda-scanner-idle').style.display    = 'flex';
    document.getElementById('venda-scanner-overlay').style.display = 'none';
    document.getElementById('btn-scanner-venda-label').textContent = 'Parar câmera';
    startScanner('video-venda', (codigo) => {
      scannerVendaAtivo = false;
      document.getElementById('venda-scanner-wrap').style.display   = 'none';
      document.getElementById('btn-scanner-venda-label').textContent = 'Escanear Produto';
      const prod = produtos.find(p => p.produto?.codigo === codigo);
      if (prod) {
        adicionarAoCarrinho(prod);
      } else {
        toast('Produto não encontrado neste evento', 'error');
      }
    });
  }
}

// ── ATALHOS DENTRO DE NOVA VENDA ──
function renderAtalhosVenda() {
  const el = document.getElementById('venda-atalhos');
  if (!el) return;
  const temFav = produtos.some(p => p.produto?.favorito === true || !p.produto?.codigo);
  const temSorv = produtos.some(p => (p.produto?.categoria || '').toLowerCase().includes('sorvete'));
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      ${temFav ? `<button class="pdv-home-btn nova-venda" style="padding:12px" onclick="goSubPdv('rapido')">
        <div class="phb-icon" style="width:36px;height:36px;font-size:18px">⚡</div>
        <div class="phb-text">
          <span class="phb-title" style="font-size:13px">Acesso Rápido</span>
          <span class="phb-desc" style="font-size:11px">Favoritos</span>
        </div>
      </button>` : ''}
      ${temSorv ? `<button class="pdv-home-btn sorvetes" style="padding:12px" onclick="goSubPdv('sorvetes')">
        <div class="phb-icon" style="width:36px;height:36px;font-size:18px">🍨</div>
        <div class="phb-text">
          <span class="phb-title" style="font-size:13px">Sorvetes</span>
          <span class="phb-desc" style="font-size:11px">Por categoria</span>
        </div>
      </button>` : ''}
    </div>`;
}

// ── ACESSO RÁPIDO ──
function renderRapido() {
  const el    = document.getElementById('rapido-grade');
  const lista = produtos.filter(p =>
    p.produto?.favorito === true || !p.produto?.codigo
  );
  if (!lista.length) {
    el.innerHTML = `<div style="grid-column:1/-1">${emptyState('Nenhum favorito cadastrado.<br>Marque produtos como favorito na tela de Entrada.')}</div>`;
    return;
  }
  el.innerHTML = lista.map(p => `
    <div class="pdv-rapido-item" onclick='adicionarAoCarrinho(${JSON.stringify(p)})'>
      <div class="pri-icon">${p.produto?.categoria?.toLowerCase().includes('sorvete') ? '🍨' : '🛒'}</div>
      <div class="pri-nome">${esc(p.produto?.nome || '')}</div>
      <div class="pri-preco">R$ ${parseFloat(p.preco_venda).toFixed(2)}</div>
    </div>`).join('');
}

// ── SORVETES ──
function renderSorvetes() {
  const el   = document.getElementById('sorvetes-conteudo');
  const list = produtos.filter(p =>
    (p.produto?.categoria || '').toLowerCase().includes('sorvete')
  );
  if (!list.length) {
    el.innerHTML = emptyState('Nenhum produto com categoria "sorvete" cadastrado.');
    return;
  }
  // Agrupa por categoria
  const grupos = {};
  list.forEach(p => {
    const cat = p.produto?.categoria || 'Sorvetes';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(p);
  });

  el.innerHTML = Object.entries(grupos).map(([cat, items]) => `
    <div class="sorvete-categoria">
      <div class="sorvete-categoria-titulo">${esc(cat)}</div>
      <div class="pdv-grade">
        ${items.map(p => `
          <div class="pdv-grade-item" onclick='adicionarAoCarrinho(${JSON.stringify(p)})'>
            <div class="pgi-nome">${esc(p.produto?.nome || '')}</div>
            <div class="pgi-preco">R$ ${parseFloat(p.preco_venda).toFixed(2)}</div>
            <div class="pgi-estoque">Estoque: ${p.qtd_entrada}</div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// ── HISTÓRICO DE VENDAS ──
async function carregarVendas() {
  const el = document.getElementById('pdv-historico');
  if (!el || !eventoAtivo) return;

  // Mostra pendentes offline primeiro
  const pendentes = await getVendasPendentes().catch(() => []);
  let html = '';

  if (pendentes.length) {
    html += `<div style="background:var(--laranja-light);border:1px solid var(--laranja-border);border-radius:var(--radius);padding:12px;margin-bottom:10px;font-size:13px;color:var(--laranja)">
      ⚠️ ${pendentes.length} venda(s) pendente(s) de sincronização
      ${isOnline ? '<button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="sincronizarPendentes()">Sincronizar agora</button>' : ''}
    </div>`;
  }

  if (!isOnline) {
    el.innerHTML = html + emptyState('Sem conexão — histórico indisponível offline');
    return;
  }

  try {
    const d = await api('getVendas', { eventoId: eventoAtivo.id });
    const vendas = d.vendas || [];
    if (!vendas.length && !pendentes.length) {
      el.innerHTML = emptyState('Nenhuma venda registrada');
      return;
    }
    const icones = { dinheiro:'💵', pix:'📱', credito:'💳', debito:'💳' };
    html += vendas.map(v => {
      const cancelada = v.status === 'cancelada';
      return `<div class="card" style="opacity:${cancelada ? '.5' : '1'}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;font-weight:600;color:var(--text-3)">${icones[v.forma_pagamento] || ''} ${v.forma_pagamento}</span>
            ${cancelada ? `<span class="badge" style="background:var(--rosa-light);color:var(--vermelho);border-color:var(--rosa-border);font-size:10px">Cancelada</span>` : ''}
          </div>
          <span style="font-size:15px;font-weight:800;color:${cancelada ? 'var(--text-4)' : 'var(--rosa)'}">R$ ${parseFloat(v.total).toFixed(2)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-bottom:6px">
          por <strong>${esc(v.vendedor)}</strong> ·
          ${new Date(v.criado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:${!cancelada ? '10px' : '0'}">
          ${v.itens.map(i => `${i.qtd}x ${esc(i.nome)}`).join(' · ')}
        </div>
        ${!cancelada ? `
        <button class="btn btn-danger btn-sm" onclick="cancelarVenda('${v.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px"><path d="M18 6L6 18M6 6l12 12"/></svg>
          Cancelar venda
        </button>` : ''}
      </div>`;
    }).join('');
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = html + emptyState('Erro ao carregar vendas');
  }
}

async function cancelarVenda(vendaId) {
  if (!confirm('Cancelar esta venda?')) return;
  mostrarLoading('Cancelando...');
  try {
    await api('cancelarVenda', { vendaId });
    toast('Venda cancelada', 'info');
    await carregarVendas();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ── SCANNER SORVETES ──
let scannerSorvetes = false;
function toggleScannerSorvetes() {
  if (scannerSorvetes) {
    stopScanner();
    scannerSorvetes = false;
    document.getElementById('sorv-scanner-wrap').style.display  = 'none';
    document.getElementById('btn-scanner-sorv-label').textContent = 'Escanear outro produto';
  } else {
    scannerSorvetes = true;
    document.getElementById('sorv-scanner-wrap').style.display = 'block';
    document.getElementById('sorv-scanner-idle').style.display = 'flex';
    document.getElementById('sorv-scanner-overlay').style.display = 'none';
    document.getElementById('btn-scanner-sorv-label').textContent = 'Parar câmera';
    startScanner('video-sorvetes', (codigo) => {
      scannerSorvetes = false;
      document.getElementById('sorv-scanner-wrap').style.display  = 'none';
      document.getElementById('btn-scanner-sorv-label').textContent = 'Escanear outro produto';
      const prod = produtos.find(p => p.produto?.codigo === codigo);
      if (prod) adicionarAoCarrinho(prod);
      else toast('Produto não encontrado', 'error');
    });
  }
}

// ── FAVORITO NA ENTRADA ──
let entradaFavorito = false;

function toggleEntradaFavorito() {
  entradaFavorito = !entradaFavorito;
  const btn = document.getElementById('btn-entrada-favorito');
  if (btn) btn.textContent = entradaFavorito ? '⭐' : '☆';
}

// Salva favorito ao salvar entrada (chamar após salvarEntrada ter sucesso)
async function aplicarFavoritoSeNecessario(produtoId) {
  if (!entradaFavorito) return;
  try {
    await api('toggleFavorito', { produtoId, favorito: true });
  } catch(e) {}
  entradaFavorito = false;
  const btn = document.getElementById('btn-entrada-favorito');
  if (btn) btn.textContent = '☆';
}

// ═══════════════════════════════════════════
//  SCANNER
// ═══════════════════════════════════════════
let _scannerReader = null;

function loadZXing(cb) {
  if (window.ZXing) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
  s.onload = cb;
  s.onerror = () => toast('Scanner indisponível', 'error');
  document.head.appendChild(s);
}

function startScanner(videoId, onResult) {
  loadZXing(async () => {
    try {
      const video = document.getElementById(videoId);
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.QR_CODE
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

      _scannerReader = new ZXing.BrowserMultiFormatReader(hints);

      await _scannerReader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720 }
          }
        },
        videoId,
        (result, err) => {
          if (result) {
            stopScanner();
            onResult(result.getText());
          }
        }
      );
      video.style.display = 'block';
    } catch (e) {
      console.error('Scanner error:', e);
      toast('Erro ao acessar a câmera: ' + e.message, 'error');
    }
  });
}

function stopScanner() {
  if (_scannerReader) {
    try { _scannerReader.reset(); } catch (e) {}
    _scannerReader = null;
  }
  document.querySelectorAll('video').forEach(v => {
    try {
      if (v.srcObject) {
        v.srcObject.getTracks().forEach(t => t.stop());
        v.srcObject = null;
      }
      v.style.display = 'none';
    } catch(e) {}
  });
  scannerEntradaAtivo  = false;
  scannerRetornoAtivo  = false;
  scannerPesquisaAtivo = false;
}

// ═══════════════════════════════════════════
//  PREÇO SUGERIDO
// ═══════════════════════════════════════════
function calcularPrecoSugerido(precoLoja, markup, arredondamento) {
  let preco = parseFloat(precoLoja) * (1 + (parseFloat(markup) || 0) / 100);
  if (arredondamento) preco = Math.ceil(preco);
  return preco.toFixed(2);
}

// ═══════════════════════════════════════════
//  MODAL / LOADING / TOAST / UTILS
// ═══════════════════════════════════════════
function abrirModal(id)  { document.getElementById(id).classList.add('open'); }
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }

function mostrarLoading(msg = 'Carregando...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function esconderLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + tipo;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 2800);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyState(msg) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>
    </svg>
    <p>${msg}</p>
  </div>`;
}