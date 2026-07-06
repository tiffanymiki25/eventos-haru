// ═══════════════════════════════════════════
//  Eventos Haru — app.js
// ═══════════════════════════════════════════

const API = '/api';

// ── ESTADO GLOBAL ──
let sessao      = JSON.parse(sessionStorage.getItem('haru_sessao') || 'null');
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

  if (sessao) {
    mostrarHome();
  } else {
    showPage('page-login');
    esconderLoading();
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
  const timeout = setTimeout(() => ctrl.abort(), 15000);
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
    // Silencioso — usa evento salvo localmente
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

function goApp(tela) {
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
    // Carrega produtos se ainda não foram carregados
    if (!produtos.length) {
      mostrarLoading('Carregando produtos...');
      try {
        const d = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
        produtos = d.produtos || [];
      } catch(e) {}
      esconderLoading();
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
    sessionStorage.setItem('haru_sessao', JSON.stringify(sessao));
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
    <div class="stat-card"><div class="stat-val azul">${prods.length}</div><div class="stat-lbl">Produtos</div></div>
    <div class="stat-card"><div class="stat-val rosa">${totais.totalVendido}</div><div class="stat-lbl">Vendidos</div></div>
    <div class="stat-card"><div class="stat-val verde" style="font-size:14px">R$${totais.faturamento.toFixed(2)}</div><div class="stat-lbl">Faturado</div></div>`;

  const semRetorno = prods.filter(p => p.qtd_retorno === null).length;
  const tabela = document.getElementById('rel-tabela');

  if (!prods.length) { tabela.innerHTML = emptyState('Nenhum produto cadastrado'); return; }

  const comRetorno = prods.filter(p => p.qtd_retorno !== null)
    .sort((a, b) => b.vendido - a.vendido);

  tabela.innerHTML = `
    ${semRetorno > 0 ? `<div style="background:var(--rosa-light);border:1px solid var(--rosa-border);border-radius:var(--radius-sm);padding:10px 13px;font-size:12px;color:var(--vermelho);margin-bottom:12px">
      ⚠️ ${semRetorno} produto(s) sem retorno lançado
    </div>` : ''}
    <div class="table-wrap">
      <div class="table-header" style="grid-template-columns:2fr 1fr 1fr 1fr">
        <span>Produto</span><span>Entrou</span><span>Vendido</span><span>Faturou</span>
      </div>
      ${comRetorno.map(p => `
        <div class="table-row" style="grid-template-columns:2fr 1fr 1fr 1fr">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(p.produto?.nome || '')}</div>
            <div style="font-size:10px;color:var(--text-4);font-family:monospace">${esc(p.produto?.codigo || '')}</div>
          </div>
          <div style="font-family:monospace;font-size:13px">${p.qtd_entrada}</div>
          <div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--rosa)">${p.vendido}</div>
          <div style="font-family:monospace;font-size:12px;color:var(--verde)">R$${p.receita.toFixed(2)}</div>
        </div>`).join('')}
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
  document.getElementById('pesquisa-resultados').innerHTML =
    emptyState('Digite para pesquisar');
  document.getElementById('pesquisa-scanner-wrap').style.display = 'none';
  setTimeout(() => document.getElementById('pesquisa-input').focus(), 300);
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
  if (!busca) { el.innerHTML = emptyState('Digite para pesquisar'); return; }
  const results = produtos.filter(p =>
    (p.produto?.nome || '').toLowerCase().includes(busca) ||
    (p.produto?.codigo || '').toLowerCase().includes(busca)
  );
  if (!results.length) { el.innerHTML = emptyState('Nenhum produto encontrado'); return; }
  el.innerHTML = results.map(p => {
    const vendido = p.qtd_retorno !== null ? p.qtd_entrada - p.qtd_retorno : null;
    return `<div class="card" style="margin-bottom:10px">
      <div style="font-size:15px;font-weight:700;margin-bottom:2px">${esc(p.produto?.nome || '')}</div>
      <div style="font-size:11px;color:var(--text-4);font-family:monospace;margin-bottom:12px">${esc(p.produto?.codigo || 'sem código')}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--rosa)">R$${parseFloat(p.preco_venda).toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-4);text-transform:uppercase;letter-spacing:.05em">Preço Venda</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--azul)">${p.qtd_entrada}</div>
          <div style="font-size:10px;color:var(--text-4);text-transform:uppercase;letter-spacing:.05em">Entrada</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--verde)">${vendido !== null ? vendido : '—'}</div>
          <div style="font-size:10px;color:var(--text-4);text-transform:uppercase;letter-spacing:.05em">Vendido</div>
        </div>
      </div>
      ${vendido !== null ? `<div style="margin-top:8px;font-size:12px;color:var(--text-3);text-align:center">
        Retornou: <strong>${p.qtd_retorno}</strong> · Preço loja: <strong>R$${parseFloat(p.produto?.preco_loja || 0).toFixed(2)}</strong>
      </div>` : ''}
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
  document.getElementById('admin-prod-codigo').value = prod?.codigo || '';
  document.getElementById('admin-prod-nome').value   = prod?.nome   || '';
  document.getElementById('admin-prod-preco').value  = prod?.preco_loja || '';
  abrirModal('modal-produto-admin');
}

async function salvarProdutoAdmin() {
  const codigo    = document.getElementById('admin-prod-codigo').value.trim();
  const nome      = document.getElementById('admin-prod-nome').value.trim();
  const precoLoja = document.getElementById('admin-prod-preco').value;
  if (!nome)      { toast('Digite o nome do produto', 'error'); return; }
  if (!precoLoja) { toast('Digite o preço de loja', 'error');   return; }
  mostrarLoading('Salvando...');
  try {
    await api('salvarProduto', {
      id: produtoAdminEditandoId,
      codigo: codigo || null,
      nome,
      preco_loja: parseFloat(precoLoja)
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
//  PDV
// ═══════════════════════════════════════════
let carrinho = [];
let pagamentoSelecionado = null;
let scannerPdvAtivo = false;

function iniciarPdv() {
  const el = document.getElementById('pdv-evento-nome');
  if (el) el.textContent = eventoAtivo?.nome || '';
  carrinho = [];
  pagamentoSelecionado = null;
  document.getElementById('pdv-desconto').value  = '0';
  document.getElementById('pdv-recebido').value  = '';
  document.getElementById('pdv-troco-val').textContent = 'R$ 0,00';
  document.getElementById('pdv-troco-wrap').style.display = 'none';
  document.getElementById('btn-confirmar-venda').disabled = true;
  // Desmarca pagamento
  document.querySelectorAll('.pdv-pag-btn').forEach(b => b.classList.remove('selected'));
  renderCarrinho();
  carregarVendas();
}

// ── CARRINHO ──
function renderCarrinho() {
  const vazio   = document.getElementById('pdv-carrinho-vazio');
  const lista   = document.getElementById('pdv-carrinho-lista');
  const resumo  = document.getElementById('pdv-resumo');
  const itensEl = document.getElementById('pdv-itens');

  if (!carrinho.length) {
    vazio.style.display  = 'block';
    lista.style.display  = 'none';
    resumo.style.display = 'none';
    return;
  }

  vazio.style.display  = 'none';
  lista.style.display  = 'block';
  resumo.style.display = 'block';

  itensEl.innerHTML = carrinho.map((item, idx) => `
    <div class="card" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.nome)}</div>
        <div style="font-size:11px;color:var(--text-4);font-family:monospace;margin-top:2px">
          ${item.qtd}x R$${parseFloat(item.preco_unit).toFixed(2)} = <strong>R$${(item.qtd * item.preco_unit).toFixed(2)}</strong>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="qty-btn" style="width:30px;height:30px;font-size:16px" onclick="ajustarCarrinho(${idx}, -1)">−</button>
        <span style="font-family:monospace;font-weight:700;min-width:24px;text-align:center">${item.qtd}</span>
        <button class="qty-btn" style="width:30px;height:30px;font-size:16px" onclick="ajustarCarrinho(${idx}, 1)">+</button>
        <button class="btn btn-icon btn-danger" onclick="removerDoCarrinho(${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`).join('');

  atualizarTotalPdv();
}

function ajustarCarrinho(idx, delta) {
  carrinho[idx].qtd = Math.max(1, carrinho[idx].qtd + delta);
  renderCarrinho();
}

function removerDoCarrinho(idx) {
  carrinho.splice(idx, 1);
  renderCarrinho();
}

function adicionarAoCarrinho(produto) {
  const existing = carrinho.find(i => i.produto_id === produto.produto_id);
  if (existing) {
    existing.qtd++;
  } else {
    carrinho.push({
      produto_id: produto.produto_id,
      nome:       produto.produto?.nome || produto.nome,
      preco_unit: parseFloat(produto.preco_venda),
      qtd:        1
    });
  }
  fecharModal('modal-pdv-produto');
  renderCarrinho();
  toast(produto.produto?.nome || produto.nome + ' adicionado!', 'success');
}

function atualizarTotalPdv() {
  const subtotal = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const desconto = parseFloat(document.getElementById('pdv-desconto').value) || 0;
  const total    = Math.max(0, subtotal - desconto);

  document.getElementById('pdv-subtotal').textContent = 'R$ ' + subtotal.toFixed(2);
  document.getElementById('pdv-total').textContent    = 'R$ ' + total.toFixed(2);

  calcularTroco();
  verificarConfirmar();
}

// ── PAGAMENTO ──
function selecionarPagamento(forma) {
  pagamentoSelecionado = forma;
  document.querySelectorAll('.pdv-pag-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('pag-' + forma).classList.add('selected');

  const trocoWrap = document.getElementById('pdv-troco-wrap');
  trocoWrap.style.display = forma === 'dinheiro' ? 'block' : 'none';
  if (forma !== 'dinheiro') {
    document.getElementById('pdv-recebido').value = '';
    document.getElementById('pdv-troco-val').textContent = 'R$ 0,00';
  }
  verificarConfirmar();
}

function calcularTroco() {
  if (pagamentoSelecionado !== 'dinheiro') return;
  const desconto  = parseFloat(document.getElementById('pdv-desconto').value) || 0;
  const subtotal  = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total     = Math.max(0, subtotal - desconto);
  const recebido  = parseFloat(document.getElementById('pdv-recebido').value) || 0;
  const troco     = recebido - total;
  document.getElementById('pdv-troco-val').textContent =
    troco >= 0 ? 'R$ ' + troco.toFixed(2) : 'Valor insuficiente';
  document.getElementById('pdv-troco-val').style.color =
    troco >= 0 ? 'var(--verde)' : 'var(--vermelho)';
  verificarConfirmar();
}

function verificarConfirmar() {
  const btn = document.getElementById('btn-confirmar-venda');
  if (!btn) return;
  const temItens    = carrinho.length > 0;
  const temPagamento = !!pagamentoSelecionado;
  const desconto    = parseFloat(document.getElementById('pdv-desconto').value) || 0;
  const subtotal    = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total       = Math.max(0, subtotal - desconto);
  const trocoOk     = pagamentoSelecionado !== 'dinheiro' ||
    (parseFloat(document.getElementById('pdv-recebido').value) || 0) >= total;
  btn.disabled = !(temItens && temPagamento && trocoOk);
}

// ── CONFIRMAR VENDA ──
async function confirmarVenda() {
  if (!carrinho.length || !pagamentoSelecionado) return;

  const desconto       = parseFloat(document.getElementById('pdv-desconto').value) || 0;
  const subtotal       = carrinho.reduce((s, i) => s + i.qtd * i.preco_unit, 0);
  const total          = Math.max(0, subtotal - desconto);
  const valor_recebido = pagamentoSelecionado === 'dinheiro'
    ? parseFloat(document.getElementById('pdv-recebido').value) || 0
    : null;

  const itens = carrinho.map(i => ({
    produto_id: i.produto_id,
    nome:       i.nome,
    qtd:        i.qtd,
    preco_unit: i.preco_unit,
    subtotal:   i.qtd * i.preco_unit
  }));

  mostrarLoading('Registrando venda...');
  try {
    await api('registrarVenda', {
      eventoId:        eventoAtivo.id,
      itens,
      subtotal,
      desconto,
      total,
      forma_pagamento: pagamentoSelecionado,
      valor_recebido
    });
    toast('Venda registrada!', 'success');
    // Limpa carrinho
    carrinho = [];
    pagamentoSelecionado = null;
    document.getElementById('pdv-desconto').value = '0';
    document.getElementById('pdv-recebido').value = '';
    document.getElementById('pdv-troco-val').textContent = 'R$ 0,00';
    document.getElementById('pdv-troco-wrap').style.display = 'none';
    document.getElementById('btn-confirmar-venda').disabled = true;
    document.querySelectorAll('.pdv-pag-btn').forEach(b => b.classList.remove('selected'));
    renderCarrinho();
    await carregarVendas();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    esconderLoading();
  }
}

// ── HISTÓRICO DE VENDAS ──
async function carregarVendas() {
  const el = document.getElementById('pdv-historico');
  if (!el || !eventoAtivo) return;
  try {
    const d = await api('getVendas', { eventoId: eventoAtivo.id });
    const vendas = d.vendas || [];
    if (!vendas.length) {
      el.innerHTML = emptyState('Nenhuma venda registrada');
      return;
    }
    const icones = { dinheiro: '💵', pix: '📱', credito: '💳', debito: '💳' };
    el.innerHTML = vendas.map(v => {
      const cancelada = v.status === 'cancelada';
      return `<div class="card" style="opacity:${cancelada ? '.5' : '1'}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <span style="font-size:12px;font-weight:600;color:var(--text-3)">${icones[v.forma_pagamento] || ''} ${v.forma_pagamento}</span>
            ${cancelada ? `<span class="badge" style="background:var(--rosa-light);color:var(--vermelho);border-color:var(--rosa-border);margin-left:6px;font-size:10px">Cancelada</span>` : ''}
          </div>
          <span style="font-size:15px;font-weight:800;color:${cancelada ? 'var(--text-4)' : 'var(--rosa)'}">R$ ${parseFloat(v.total).toFixed(2)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-bottom:6px">
          por <strong>${esc(v.vendedor)}</strong> · ${new Date(v.criado_em).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:${!cancelada ? '10px' : '0'}">
          ${v.itens.map(i => `${i.qtd}x ${esc(i.nome)}`).join(' · ')}
        </div>
        ${!cancelada ? `
        <button class="btn btn-danger btn-sm" onclick="cancelarVenda('${v.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          Cancelar venda
        </button>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    toast(e.message, 'error');
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

// ── MODAL ADICIONAR PRODUTO PDV ──
function abrirModalPdvProduto() {
  document.getElementById('pdv-busca').value = '';
  renderPdvLista();
  abrirModal('modal-pdv-produto');
  setTimeout(() => document.getElementById('pdv-busca').focus(), 300);
}

function renderPdvLista() {
  const busca = (document.getElementById('pdv-busca')?.value || '').toLowerCase();
  const el    = document.getElementById('pdv-lista-produtos');
  const lista = produtos.filter(p =>
    !busca ||
    (p.produto?.nome   || '').toLowerCase().includes(busca) ||
    (p.produto?.codigo || '').toLowerCase().includes(busca)
  );
  if (!lista.length) { el.innerHTML = emptyState('Nenhum produto encontrado'); return; }
  el.innerHTML = lista.map(p => `
    <div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer"
         onclick='adicionarAoCarrinho(${JSON.stringify(p)})'>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${esc(p.produto?.nome || '')}</div>
        <div style="font-size:11px;color:var(--text-4);font-family:monospace">${esc(p.produto?.codigo || 'sem código')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:14px;font-weight:700;color:var(--rosa)">R$ ${parseFloat(p.preco_venda).toFixed(2)}</div>
        <div style="font-size:10px;color:var(--text-4)">Estoque: ${p.qtd_entrada}</div>
      </div>
    </div>`).join('');
}

function toggleScannerPdv() {
  if (scannerPdvAtivo) {
    stopScanner();
    document.getElementById('pdv-scanner-idle').style.display    = 'flex';
    document.getElementById('pdv-scanner-overlay').style.display = 'none';
    document.getElementById('btn-scanner-pdv-label').textContent = 'Escanear Código';
    scannerPdvAtivo = false;
  } else {
    document.getElementById('pdv-scanner-idle').style.display    = 'none';
    document.getElementById('pdv-scanner-overlay').style.display = 'flex';
    document.getElementById('btn-scanner-pdv-label').textContent = 'Parar câmera';
    scannerPdvAtivo = true;
    startScanner('video-pdv', (codigo) => {
      scannerPdvAtivo = false;
      document.getElementById('pdv-scanner-idle').style.display    = 'flex';
      document.getElementById('pdv-scanner-overlay').style.display = 'none';
      document.getElementById('btn-scanner-pdv-label').textContent = 'Escanear Código';
      const prod = produtos.find(p => p.produto?.codigo === codigo);
      if (prod) {
        adicionarAoCarrinho(prod);
      } else {
        toast('Produto não encontrado neste evento', 'error');
      }
    });
  }
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