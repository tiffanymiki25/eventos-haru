// ═══════════════════════════════════════════
//  Eventos Haru — JavaScript Principal
// ═══════════════════════════════════════════

// ── CONFIGURAÇÃO ──
const API = '/api';

// ── ESTADO GLOBAL ──
let sessao      = JSON.parse(sessionStorage.getItem('haru_sessao') || 'null');
let eventoAtivo = JSON.parse(localStorage.getItem('haru_evento')   || 'null');
let produtos    = []; // produtos do evento ativo em memória
let catalogo    = []; // catálogo global em memória

// ═══════════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Atalhos de teclado
  document.getElementById('login-senha')
    .addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-usuario')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-senha').focus();
    });

  // Fecha modais ao clicar no fundo
  document.querySelectorAll('.modal-bg').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) m.classList.remove('open');
    });
  });

  // Login desativado temporariamente
  sessao = { username: 'haru', nome: 'Haru', perfil: 'admin' };
  sessionStorage.setItem('haru_sessao', JSON.stringify(sessao));
  mostrarHome();
});

// ═══════════════════════════════════════════
//  NAVEGAÇÃO
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page')
    .forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goPage(id) {
  showPage(id);
}

function goApp(tela) {
  if (!eventoAtivo) {
    toast('Selecione um evento primeiro!', 'error');
    goPage('page-eventos');
    return;
  }
  showPage('page-' + tela);
  // Carrega dados da tela ao navegar
  if (tela === 'entrada')   carregarEntrada();
  if (tela === 'retorno')   carregarRetorno();
  if (tela === 'relatorio') carregarRelatorio();
  if (tela === 'pesquisa')  iniciarPesquisa();
}

function voltarHome() {
  stopScanner();
  showPage('page-home');
}

// ═══════════════════════════════════════════
//  API
// ═══════════════════════════════════════════
async function api(action, body = {}) {
  const payload = {
    action,
    ...body,
    username: body.username || sessao?.username || ''
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

    if (data.error === 'Sessão inválida') {
      doLogout();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (data.error) throw new Error(data.error);

    return data;

  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError')
      throw new Error('Tempo esgotado. Verifique sua conexão.');
    throw e;
  }
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
    erroEl.textContent  = 'Preencha usuário e senha.';
    erroEl.style.display = 'block';
    return;
  }

  btnEl.disabled    = true;
  btnEl.textContent = 'Entrando...';
  mostrarLoading('Autenticando...');

  try {
    const data = await api('login', { senha, username: usuario });

    // Salva sessão
    sessao = { username: data.username, nome: data.nome, perfil: data.perfil };
    sessionStorage.setItem('haru_sessao', JSON.stringify(sessao));

    mostrarHome();

  } catch (e) {
    esconderLoading();
    erroEl.textContent   = e.message;
    erroEl.style.display = 'block';
  } finally {
    btnEl.disabled    = false;
    btnEl.textContent = 'Entrar';
  }
}

function doLogout() {
  sessao      = null;
  eventoAtivo = null;
  produtos    = [];
  catalogo    = [];
  sessionStorage.removeItem('haru_sessao');
  localStorage.removeItem('haru_evento');
  fecharModal('modal-usuario');
  showPage('page-login');
  esconderLoading();
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-senha').value   = '';
}

// ═══════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════
function mostrarHome() {
  // Atualiza nome e avatar
  const nome   = sessao?.nome || '?';
  const inicial = nome.charAt(0).toUpperCase();

  document.getElementById('home-user-nome').textContent  = nome.split(' ')[0];
  document.getElementById('home-avatar').textContent     = inicial;
  document.getElementById('modal-usuario-avatar').textContent = inicial;
  document.getElementById('modal-usuario-nome').textContent   = nome;
  document.getElementById('modal-usuario-perfil').textContent =
    sessao?.perfil === 'admin' ? 'Administrador' : 'Funcionário';

  // Mostra botão admin se for admin
  document.getElementById('home-btn-admin').style.display =
    sessao?.perfil === 'admin' ? 'block' : 'none';

  // Atualiza badge do evento ativo
  atualizarBadgeEvento();

  showPage('page-home');
  esconderLoading();

  // Pré-carrega produtos em background
  if (eventoAtivo) prefetchProdutos();
}

function atualizarBadgeEvento() {
  const badge    = document.getElementById('home-evento-badge');
  const semEvento = document.getElementById('home-sem-evento');
  const resumo   = document.getElementById('home-resumo');

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
  const total     = produtos.length;
  const comRetorno = produtos.filter(p => p.qtd_retorno !== null);
  const vendidos  = comRetorno.reduce((s, p) =>
    s + (p.qtd_entrada - p.qtd_retorno), 0);
  const faturamento = comRetorno.reduce((s, p) =>
    s + (p.qtd_entrada - p.qtd_retorno) * parseFloat(p.preco_venda), 0);

  document.getElementById('stat-produtos').textContent    = total || '—';
  document.getElementById('stat-vendidos').textContent    = vendidos || '—';
  document.getElementById('stat-faturamento').textContent =
    faturamento > 0 ? 'R$' + faturamento.toFixed(2) : '—';
}

async function prefetchProdutos() {
  if (!eventoAtivo) return;
  try {
    const data = await api('getProdutosEvento', { eventoId: eventoAtivo.id });
    produtos = data.produtos || [];
    atualizarResumo();
  } catch (e) { /* silencioso */ }
}

function abrirMenuUsuario() {
  abrirModal('modal-usuario');
}

// ═══════════════════════════════════════════
//  EVENTOS
// ═══════════════════════════════════════════
let eventoSelecionadoModal = null;

async function carregarEventos() {
  // Mostra botão novo evento só para admin
  const btnNovo = document.getElementById('btn-novo-evento');
  if (btnNovo) btnNovo.style.display =
    sessao?.perfil === 'admin' ? 'block' : 'none';

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
    el.innerHTML = emptyState('Nenhum evento criado ainda.<br>Peça ao administrador para criar um evento.');
    return;
  }

  // Ordena: ativos primeiro
  const sorted = [...lista].sort((a, b) =>
    a.status === b.status ? 0 : a.status === 'ativo' ? -1 : 1
  );

  el.innerHTML = sorted.map(ev => `
    <div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer;transition:transform .15s"
         onclick="abrirOpcoesEvento(${JSON.stringify(ev).replace(/"/g, '&quot;')})"
         onmousedown="this.style.transform='scale(.98)'"
         onmouseup="this.style.transform='scale(1)'">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:var(--text);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(ev.nome)}
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">
          ${ev.data}
          ${ev.markup > 0 ? `· Markup: ${ev.markup}%` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span class="badge badge-${ev.status}">${ev.status}</span>
        ${eventoAtivo?.id === ev.id
          ? `<svg width="18" viewBox="0 0 24 24" fill="none"
               stroke="var(--verde)" stroke-width="2.5">
               <path d="M20 6L9 17l-5-5"/>
             </svg>`
          : ''}
      </div>
    </div>
  `).join('');
}

function abrirOpcoesEvento(ev) {
  eventoSelecionadoModal = ev;
  document.getElementById('modal-opcoes-evento-nome').textContent = ev.nome;

  // Mostra opções de admin apenas para admins
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
  document.getElementById('novo-evento-nome').value    = '';
  document.getElementById('novo-evento-markup').value  = '0';
  document.getElementById('novo-evento-arred').value   = 'true';
  fecharModal('modal-opcoes-evento');
  abrirModal('modal-novo-evento');
  setTimeout(() => document.getElementById('novo-evento-nome').focus(), 300);
}

async function criarEvento() {
  const nome  = document.getElementById('novo-evento-nome').value.trim();
  const markup = document.getElementById('novo-evento-markup').value;
  const arred  = document.getElementById('novo-evento-arred').value === 'true';

  if (!nome) {
    toast('Digite o nome do evento', 'error');
    return;
  }

  mostrarLoading('Criando evento...');
  try {
    const data = await api('criarEvento', { nome, markup, arredondamento: arred });
    fecharModal('modal-novo-evento');
    toast('Evento criado!', 'success');
    await carregarEventos();
    // Seleciona automaticamente o evento criado
    eventoAtivo = data.evento;
    localStorage.setItem('haru_evento', JSON.stringify(eventoAtivo));
    atualizarBadgeEvento();
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
  if (!confirm('Remover permanentemente o evento "' + eventoSelecionadoModal.nome + '"?\nTodos os produtos serão removidos.')) return;

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
//  PLACEHOLDERS (expandidos nos próx. passos)
// ═══════════════════════════════════════════
function carregarEntrada()   { /* Passo 9  */ }
function carregarRetorno()   { /* Passo 10 */ }
function carregarRelatorio() { /* Passo 11 */ }
function iniciarPesquisa()   { /* Passo 12 */ }

// ═══════════════════════════════════════════
//  SCANNER (ZXing — carregado sob demanda)
// ═══════════════════════════════════════════
let scannerAtivo  = false;
let codigoReader  = null;

function loadZXing(cb) {
  if (window.ZXing) { cb(); return; }
  const s   = document.createElement('script');
  s.src     = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
  s.onload  = cb;
  s.onerror = () => toast('Scanner indisponível', 'error');
  document.head.appendChild(s);
}

async function startScanner(videoId, onResult) {
  if (scannerAtivo) return;
  loadZXing(async () => {
    try {
      const video  = document.getElementById(videoId);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = stream;
      video.style.display = 'block';
      await video.play();
      scannerAtivo = true;

      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.QR_CODE
      ]);
      codigoReader = new ZXing.BrowserMultiFormatReader(hints);
      codigoReader.decodeFromVideoElement(video, (result) => {
        if (result) {
          stopScanner();
          onResult(result.getText());
        }
      });
    } catch (e) {
      toast('Erro ao acessar a câmera', 'error');
    }
  });
}

function stopScanner() {
  if (codigoReader) {
    try { codigoReader.reset(); } catch (e) {}
    codigoReader = null;
  }
  document.querySelectorAll('video').forEach(v => {
    if (v.srcObject) {
      v.srcObject.getTracks().forEach(t => t.stop());
      v.srcObject = null;
    }
    v.style.display = 'none';
  });
  scannerAtivo = false;
}

// ═══════════════════════════════════════════
//  CÁLCULO DE PREÇO SUGERIDO
// ═══════════════════════════════════════════
function calcularPrecoSugerido(precoLoja, markup, arredondamento) {
  let preco = parseFloat(precoLoja) * (1 + (parseFloat(markup) || 0) / 100);
  if (arredondamento) preco = Math.ceil(preco);
  return preco.toFixed(2);
}

// ═══════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════
function abrirModal(id) {
  document.getElementById(id).classList.add('open');
}
function fecharModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ═══════════════════════════════════════════
//  LOADING
// ═══════════════════════════════════════════
function mostrarLoading(msg = 'Carregando...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function esconderLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ═══════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════
function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + tipo;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 2800);
}

// ═══════════════════════════════════════════
//  UTILITÁRIOS
// ═══════════════════════════════════════════
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emptyState(msg) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8M12 8v8"/>
      </svg>
      <p>${msg}</p>
    </div>`;
}

function formatMoeda(val) {
  return 'R$ ' + parseFloat(val || 0).toFixed(2).replace('.', ',');
}

function formatData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}