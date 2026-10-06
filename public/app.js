'use strict';

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const diaMes = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const pct = (v) => `${Math.abs(v).toFixed(1).replace('.', ',')} %`;
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

let usuario = null;
let fontes = {};
let grafico = null;
let atualizar = null; // timer da tela atual
// Desafio de código em andamento (cadastro, login ou senha); some ao recarregar a página.
let desafio = null;

const SVG = 'http://www.w3.org/2000/svg';
function icone(nome, classe = 'ic') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', classe);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `#i-${nome}`);
  s.append(u);
  return s;
}

// --- Tema ---------------------------------------------------------------------------------------
// Sem escolha guardada vale o tema do aparelho; tema.js aplica a escolha antes da primeira pintura.
const midiaEscura = matchMedia('(prefers-color-scheme: dark)');
const temaEscolhido = () => document.documentElement.dataset.tema || 'auto';
const temaEfetivo = () => document.documentElement.dataset.tema || (midiaEscura.matches ? 'escuro' : 'claro');

function aplicarTema(escolha) {
  const raiz = document.documentElement;
  if (escolha === 'auto') delete raiz.dataset.tema;
  else raiz.dataset.tema = escolha;
  try {
    if (escolha === 'auto') localStorage.removeItem('tema');
    else localStorage.setItem('tema', escolha);
  } catch { /* armazenamento bloqueado: vale só nesta visita */ }
  temaMudou();
}

function temaMudou() {
  const outro = temaEfetivo() === 'escuro' ? 'claro' : 'escuro';
  for (const b of $$('[data-tema-botao]')) {
    b.setAttribute('aria-label', `Mudar para o tema ${outro}`);
    b.title = `Mudar para o tema ${outro}`;
  }
  for (const r of $$('input[name="tema"]')) r.checked = r.value === temaEscolhido();
  window.dispatchEvent(new Event('tema'));
}

$('[data-tema-botao]').addEventListener('click', () => aplicarTema(temaEfetivo() === 'escuro' ? 'claro' : 'escuro'));
midiaEscura.addEventListener('change', () => { if (temaEscolhido() === 'auto') temaMudou(); });

// Mostrar/ocultar senha em qualquer campo de senha.
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.ver-senha');
  if (!b) return;
  const i = b.parentElement.querySelector('input');
  const mostrar = i.type === 'password';
  i.type = mostrar ? 'text' : 'password';
  b.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  b.classList.toggle('ligado', mostrar);
});

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) e.append(f);
  return e;
}

async function api(caminho, { method = 'GET', body } = {}) {
  const r = await fetch(`/api/${caminho}`, {
    method,
    // Toda requisição que altera algo vai como JSON, mesmo sem corpo (DELETE, POST sem dados):
    // o servidor recusa com 403 qualquer POST/PUT/DELETE que não seja JSON do próprio site.
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && usuario && !caminho.startsWith('login') && !caminho.startsWith('eu/senha')) {
    usuario = null;
    ir('/entrar');
    throw new Error(corpo.erro || 'Sessão expirada.');
  }
  if (!r.ok) {
    const e = new Error(corpo.erro || `Erro ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return corpo;
}

let sinalTela = new AbortController(); // ouvintes globais da tela atual (ex.: troca de tema)

function montar(id) {
  if (atualizar) clearInterval(atualizar);
  atualizar = null;
  if (grafico) { grafico.destroy(); grafico = null; }
  sinalTela.abort();
  sinalTela = new AbortController();
  const tela = $('#tela');
  tela.replaceChildren($(`#${id}`).content.cloneNode(true));
  document.body.classList.toggle('logado', !!usuario);
  document.body.classList.toggle('admin', !!usuario?.admin);
  const h = location.pathname;
  const secao = /^\/conta(\/|$)/.test(h) ? 'conta' : /^\/admin(\/|$)/.test(h) ? 'admin' : /^\/empregos(\/|$)/.test(h) ? 'empregos' : 'passagens';
  for (const a of $$('[data-nav]')) {
    if (a.dataset.nav === secao) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  // Marca e título seguem a aba principal: Empregos ou Passagens.
  const empregos = secao === 'empregos';
  $('.marca').href = empregos ? '/empregos' : '/passagens';
  $('.marca-nome').textContent = empregos ? 'Buscador de Empregos' : 'Buscador de Passagens';
  $('[data-marca-icone]').setAttribute('href', empregos ? '#i-maleta' : '#i-aviao');
  $('.marca-logo').classList.toggle('emp-marca', empregos);
  document.title = empregos ? 'Buscador de Empregos' : 'Buscador de Passagens';
  window.scrollTo(0, 0);
  return tela;
}

// Telas de acesso: formulário dentro da moldura com a apresentação.
function montarAcesso(id) {
  const tela = montar('t-acesso');
  $('[data-acesso-lugar]', tela).replaceChildren($(`#${id}`).content.cloneNode(true));
  return tela;
}

// Navegação por caminho (History API): o servidor devolve index.html para qualquer caminho do app.
function ir(caminho) {
  if (`${location.pathname}${location.search}` !== caminho) history.pushState(null, '', caminho);
  rota();
}

// Link interno (href="/…") navega sem recarregar a página; nova aba, download e /api seguem o navegador.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href]');
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  if (a.target && a.target !== '_self') return;
  if (a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
  ev.preventDefault();
  ir(`${url.pathname}${url.search}`);
});

function erroEm(form, e) {
  const p = $('[data-erro]', form) || $('[data-msg]', form);
  if (p) { p.className = p.hasAttribute('data-erro') ? 'erro' : 'msg erro'; p.textContent = e.message; }
}

function ocupado(form, sim) {
  for (const b of form.querySelectorAll('button')) b.disabled = sim;
}

async function enviar(form, fn) {
  const p = $('[data-erro]', form); if (p) p.textContent = '';
  ocupado(form, true);
  try { await fn(); } catch (e) { erroEm(form, e); } finally { ocupado(form, false); }
}

// --- Acesso -------------------------------------------------------------------------------------

function telaEntrar() {
  const t = montarAcesso('t-entrar');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('login', { method: 'POST', body: { telefone: f.telefone.value, senha: f.senha.value, lembrar: f.lembrar.checked } });
      if (r.precisa_codigo) {
        desafio = { tipo: 'login', id: r.desafio, tel: r.telefone };
        ir('/codigo');
      } else {
        usuario = r.usuario;
        irDepoisDoLogin();
      }
    });
  });
}

function telaCadastro() {
  const t = montarAcesso('t-cadastro');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('cadastro', { method: 'POST', body: { nome: f.nome.value, telefone: f.telefone.value, senha: f.senha.value } });
      desafio = { tipo: 'cadastro', id: r.desafio, tel: r.telefone };
      ir('/codigo');
    });
  });
}

function telaEsqueci() {
  const t = montarAcesso('t-esqueci');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('senha/esqueci', { method: 'POST', body: { telefone: f.telefone.value } });
      desafio = { tipo: 'senha', id: r.desafio, tel: r.telefone };
      ir('/codigo');
    });
  });
}

function telaCodigo() {
  if (!desafio) return ir('/entrar');
  const t = montarAcesso('t-codigo');
  const f = $('form', t);
  $('[data-tel]', t).textContent = desafio.tel;
  const novaSenha = desafio.tipo === 'senha';
  $('[data-nova-senha]', t).hidden = !novaSenha;
  f.senha.required = novaSenha;
  f.codigo.focus();

  const reenviar = $('[data-reenviar]', t);
  let espera = 60;
  const contar = () => {
    reenviar.disabled = espera > 0;
    reenviar.textContent = espera > 0 ? `Reenviar código (${espera} s)` : 'Reenviar código';
    espera -= 1;
  };
  contar();
  atualizar = setInterval(contar, 1000);
  reenviar.addEventListener('click', () => enviar(f, async () => {
    const r = await api('codigo/reenviar', { method: 'POST', body: { desafio: desafio.id } });
    desafio.id = r.desafio;
    espera = 60;
    contar();
  }));

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const caminho = { cadastro: 'cadastro/confirmar', login: 'login/confirmar', senha: 'senha/redefinir' }[desafio.tipo];
      const body = { desafio: desafio.id, codigo: f.codigo.value };
      if (novaSenha) body.senha = f.senha.value;
      const r = await api(caminho, { method: 'POST', body });
      usuario = r.usuario;
      desafio = null;
      irDepoisDoLogin();
    });
  });
}

$('#btn-sair').addEventListener('click', async () => {
  await api('sair', { method: 'POST', body: {} }).catch(() => {});
  usuario = null;
  depoisDoLogin = null;
  ir('/entrar');
});

// --- Aeroportos ---------------------------------------------------------------------------------

// Lista vem do backend uma vez por sessão, já na ordem: Brasil, depois países em ordem alfabética.
let aeroportos = null; // { lista: [{codigo, cidade, nome, pais, nomePais, palavras}], porCodigo: Map }
let carregandoAeroportos = null;

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavrasDe = (s) => semAcento(s).split(/[^a-z0-9]+/).filter(Boolean);

function carregarAeroportos() {
  if (aeroportos) return Promise.resolve(aeroportos);
  carregandoAeroportos ??= api('aeroportos').then((d) => {
    const lista = d.aeroportos.map(([codigo, cidade, nome, pais, extras, porte, cidadeAlt]) => {
      const nomePais = d.paises[pais] || pais;
      return {
        codigo, cidade, nome, pais, nomePais, porte, extras: [cidadeAlt, ...(extras ? extras.split(', ') : [])].filter(Boolean),
        cidadesN: [semAcento(cidade), semAcento(cidadeAlt)].filter(Boolean),
        palavrasCidade: palavrasDe(`${cidade} ${cidadeAlt}`),
        palavras: [codigo.toLowerCase(), ...new Set(palavrasDe(`${nome} ${extras}`))],
        palavrasPais: palavrasDe(nomePais),
      };
    });
    aeroportos = { lista, porCodigo: new Map(lista.map((a) => [a.codigo, a])) };
    return aeroportos;
  }).finally(() => { carregandoAeroportos = null; });
  return carregandoAeroportos;
}

const aeroporto = (codigo) => aeroportos?.porCodigo.get(codigo) || null;
const cidadeDe = (codigo) => aeroporto(codigo)?.cidade || codigo;

// Relevância (menor = melhor): código exato, começo do código, começo da cidade, palavra da cidade,
// nome do aeroporto ou nome alternativo, país. null = não casa.
function relevancia(a, termos, consulta) {
  const codigo = a.codigo.toLowerCase();
  if (termos.length === 1 && codigo === termos[0]) return 0;
  if (termos.length === 1 && codigo.startsWith(termos[0])) return 1;
  let pior = a.cidadesN.some((c) => c.startsWith(consulta)) ? 2 : 3;
  for (const t of termos) {
    if (a.palavrasCidade.some((p) => p.startsWith(t))) continue;
    if (a.palavras.some((p) => p.startsWith(t))) pior = Math.max(pior, 4);
    else if (a.palavrasPais.some((p) => p.startsWith(t))) pior = Math.max(pior, 5);
    else return null;
  }
  return pior;
}

// Resultado agrupado por país, mantendo a ordem dos países (Brasil primeiro, depois alfabética).
function buscarAeroportos(texto, limite) {
  const consulta = semAcento(texto).trim();
  const termos = palavrasDe(consulta);
  const grupos = new Map();
  let total = 0;
  for (const a of aeroportos.lista) {
    const r = termos.length ? relevancia(a, termos, consulta) : 6;
    if (r == null) continue;
    total += 1;
    if (!grupos.has(a.pais)) grupos.set(a.pais, []);
    grupos.get(a.pais).push({ a, r });
  }
  const saida = [];
  let n = 0;
  for (const [pais, itens] of grupos) {
    if (n >= limite) break;
    itens.sort((x, y) => x.r - y.r); // estável: empate mantém a ordem da lista (cidade, código)
    const cabem = itens.slice(0, limite - n);
    n += cabem.length;
    saida.push({ pais, nomePais: cabem[0].a.nomePais, itens: cabem.map((x) => x.a), relevancias: cabem.map((x) => x.r), total: itens.length });
  }
  return { grupos: saida, mostrados: n, total };
}

// Realça o começo das palavras que casam com a busca, sem perder os acentos do texto original.
function realcar(texto, termos) {
  const frag = document.createDocumentFragment();
  if (!termos.length) { frag.append(texto); return frag; }
  const marcas = new Array(texto.length).fill(false);
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(texto))) {
    const palavra = semAcento(m[0]);
    const t = termos.filter((x) => palavra.startsWith(x)).sort((x, y) => y.length - x.length)[0];
    if (t) for (let i = 0; i < t.length && i < m[0].length; i++) marcas[m.index + i] = true;
  }
  let i = 0;
  while (i < texto.length) {
    let j = i;
    while (j < texto.length && marcas[j] === marcas[i]) j++;
    frag.append(marcas[i] ? el('mark', {}, texto.slice(i, j)) : texto.slice(i, j));
    i = j;
  }
  return frag;
}

let idCombo = 0;

// Campo de aeroporto: digita cidade, aeroporto, país ou código; escolhe na lista agrupada por país.
function campoAeroporto(caixa, { rotulo, aoEscolher }) {
  caixa.replaceChildren($('#t-campo-aeroporto').content.cloneNode(true));
  const n = ++idCombo;
  const entrada = $('.combo-entrada', caixa);
  const lista = $('.combo-lista', caixa);
  const chip = $('[data-codigo]', caixa);
  const detalhe = $('[data-detalhe]', caixa);
  const lab = $('[data-rotulo]', caixa);
  entrada.id = `aeroporto-${n}`;
  lista.id = `aeroporto-${n}-lista`;
  detalhe.id = `aeroporto-${n}-detalhe`;
  lab.htmlFor = entrada.id;
  lab.textContent = rotulo;
  entrada.setAttribute('aria-controls', lista.id);
  entrada.setAttribute('aria-describedby', detalhe.id);

  let valor = '';
  let opcoes = [];
  let ativa = -1;
  const LIMITE = 250;

  const mostrarDetalhe = (erro) => {
    const a = aeroporto(valor);
    detalhe.className = `combo-detalhe${erro ? ' erro' : ''}`;
    detalhe.textContent = erro || (a ? `${a.nome} · ${a.nomePais}` : '');
    entrada.setAttribute('aria-invalid', erro ? 'true' : 'false');
  };

  const definir = (codigo, { avisar = true } = {}) => {
    valor = codigo || '';
    const a = aeroporto(valor);
    entrada.value = a ? a.cidade : valor;
    chip.textContent = valor;
    chip.hidden = !valor;
    mostrarDetalhe();
    if (avisar && aoEscolher) aoEscolher(valor);
  };

  const fechar = () => {
    lista.hidden = true;
    entrada.setAttribute('aria-expanded', 'false');
    entrada.removeAttribute('aria-activedescendant');
    ativa = -1;
  };

  const marcar = (i, rolar = true) => {
    if (ativa >= 0 && opcoes[ativa]) opcoes[ativa].li.classList.remove('ativa');
    ativa = i;
    const o = opcoes[i];
    if (!o) { entrada.removeAttribute('aria-activedescendant'); return; }
    o.li.classList.add('ativa');
    entrada.setAttribute('aria-activedescendant', o.li.id);
    if (rolar) {
      // Rola só a lista (scrollIntoView rolaria a página junto); o cabeçalho do país fica fixo no topo.
      const cab = $('.combo-pais', o.li.closest('.combo-grupo'))?.offsetHeight || 0;
      const topo = o.li.offsetTop;
      const fim = topo + o.li.offsetHeight;
      if (topo - cab < lista.scrollTop) lista.scrollTop = topo - cab;
      else if (fim > lista.scrollTop + lista.clientHeight) lista.scrollTop = fim - lista.clientHeight;
    }
  };

  const abrir = async (texto) => {
    if (!aeroportos) {
      lista.replaceChildren(el('li', { class: 'combo-aviso' }, 'Carregando aeroportos…'));
      lista.hidden = false;
      try { await carregarAeroportos(); } catch {
        lista.replaceChildren(el('li', { class: 'combo-aviso erro' }, 'Não foi possível carregar a lista. Tente de novo.'));
        return;
      }
      if (document.activeElement !== entrada) return;
      texto = valor ? '' : entrada.value;
    }
    const termos = palavrasDe(texto);
    const r = buscarAeroportos(texto, LIMITE);
    lista.replaceChildren();
    opcoes = [];
    if (!r.total) {
      lista.append(el('li', { class: 'combo-aviso' }, 'Nenhum aeroporto encontrado. Tente o nome da cidade, do país ou o código (ex.: GRU).'));
    }
    for (const g of r.grupos) {
      const idGrupo = `${lista.id}-${g.pais}`;
      const itens = el('ul', { role: 'group', 'aria-labelledby': idGrupo });
      lista.append(el('li', { role: 'presentation', class: 'combo-grupo' },
        el('div', { class: 'combo-pais', id: idGrupo }, g.nomePais, el('span', {}, `${g.total}`)),
        itens));
      g.itens.forEach((a, k) => {
        const casa = (txt) => termos.length && termos.every((t) => palavrasDe(txt).some((p) => p.startsWith(t)));
        const outroNome = termos.length && !casa(`${a.codigo} ${a.cidade} ${a.nome} ${a.nomePais}`) ? a.extras.find(casa) : null;
        const li = el('li', { role: 'option', id: `${lista.id}-${a.codigo}`, class: 'combo-opcao', 'aria-selected': a.codigo === valor ? 'true' : 'false' },
          el('span', { class: 'combo-opcao-codigo' }, a.codigo),
          el('span', { class: 'combo-opcao-texto' },
            el('span', { class: 'combo-opcao-cidade' }, realcar(a.cidade, termos)),
            el('span', { class: 'combo-opcao-nome' }, realcar(a.nome, termos), outroNome ? ' · ' : null, outroNome ? realcar(outroNome, termos) : null)));
        li.addEventListener('mousedown', (ev) => ev.preventDefault()); // não tira o foco do campo
        li.addEventListener('click', () => escolher(a.codigo));
        const i = opcoes.push({ li, a, r: g.relevancias[k] }) - 1;
        li.addEventListener('mousemove', () => { if (ativa !== i) marcar(i, false); });
        itens.append(li);
      });
    }
    if (r.mostrados < r.total) {
      lista.append(el('li', { class: 'combo-aviso' }, termos.length
        ? `Mostrando ${r.mostrados} de ${r.total}. Continue digitando para refinar.`
        : 'Digite para buscar em todos os países.'));
    }
    lista.hidden = false;
    entrada.setAttribute('aria-expanded', 'true');
    lista.scrollTop = 0;
    // Países ficam na ordem fixa; a opção já marcada (Enter) é a mais relevante, onde quer que esteja.
    let sel = opcoes.findIndex((o) => o.a.codigo === valor);
    const melhor = (o, m) => o.r < m.r || (o.r === m.r && o.a.porte < m.a.porte);
    if (sel < 0 && termos.length && opcoes.length) sel = opcoes.reduce((m, o, i) => (melhor(o, opcoes[m]) ? i : m), 0);
    marcar(sel);
  };

  const escolher = (codigo) => {
    definir(codigo);
    fechar();
  };

  // Saiu do campo sem escolher: aceita o código digitado ou o único resultado; senão avisa.
  const resolver = () => {
    const texto = entrada.value.trim();
    if (!texto) { if (valor) definir(''); return; }
    const a = aeroporto(valor);
    if (a && entrada.value === a.cidade) return;
    if (!aeroportos) return;
    const exato = aeroporto(texto.toUpperCase());
    const r = buscarAeroportos(texto, 2);
    if (exato) definir(exato.codigo);
    else if (r.total === 1) definir(r.grupos[0].itens[0].codigo);
    else { valor = ''; chip.hidden = true; if (aoEscolher) aoEscolher(''); mostrarDetalhe(r.total ? 'Escolha um aeroporto da lista.' : 'Aeroporto não encontrado.'); }
  };

  entrada.addEventListener('focus', () => { entrada.select(); abrir(valor ? '' : entrada.value); });
  entrada.addEventListener('click', () => { if (lista.hidden) abrir(valor ? '' : entrada.value); });
  entrada.addEventListener('input', () => {
    if (valor) { valor = ''; chip.hidden = true; if (aoEscolher) aoEscolher(''); }
    mostrarDetalhe();
    abrir(entrada.value);
  });
  entrada.addEventListener('blur', () => { fechar(); resolver(); });
  entrada.addEventListener('keydown', (ev) => {
    const aberta = !lista.hidden;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!aberta) { abrir(valor ? '' : entrada.value); return; }
      if (!opcoes.length) return;
      const passo = ev.key === 'ArrowDown' ? 1 : -1;
      marcar(ativa < 0 ? (passo > 0 ? 0 : opcoes.length - 1) : (ativa + passo + opcoes.length) % opcoes.length);
    } else if (ev.key === 'PageDown' || ev.key === 'PageUp') {
      if (!aberta || !opcoes.length) return;
      ev.preventDefault();
      marcar(Math.max(0, Math.min(opcoes.length - 1, ativa + (ev.key === 'PageDown' ? 8 : -8))));
    } else if (ev.key === 'Enter') {
      if (aberta && opcoes[ativa]) { ev.preventDefault(); escolher(opcoes[ativa].a.codigo); }
      else if (aberta) ev.preventDefault();
    } else if (ev.key === 'Escape') {
      if (aberta) { ev.preventDefault(); fechar(); if (!valor) return; definir(valor, { avisar: false }); entrada.select(); }
    } else if (ev.key === 'Tab' && aberta && opcoes[ativa] && !valor && entrada.value.trim()) {
      escolher(opcoes[ativa].a.codigo);
    }
  });

  return {
    get valor() { return valor; },
    definir,
    focar: () => entrada.focus(),
    erro: (msg) => mostrarDetalhe(msg),
  };
}

// --- Alertas ------------------------------------------------------------------------------------

function descricao(a) {
  const volta = a.data_volta ? ` a ${diaMes(a.data_volta)}` : ' (só ida)';
  const voos = a.so_diretos === false ? 'com escalas' : 'só diretos';
  return `${diaMes(a.data_ida)}${volta} · ${voos} · a cada ${rotuloIntervalo(a.intervalo_min)} · alerta ${Math.round(a.desconto_min * 100)} % abaixo da média`;
}

const textoEscalas = (n) => (!n ? 'direto' : n === 1 ? '1 escala' : `${n} escalas`);

// Situação do alerta para selo e cor do bilhete.
function situacao(a) {
  if (a.data_ida < hojeISO()) return { classe: 'passou', texto: 'Data passou' };
  return a.ativo ? { classe: 'ligado', texto: 'Ligado' } : { classe: 'pausado', texto: 'Pausado' };
}

// Trecho sem nenhum voo nos sites que responderam: frase curta para cartão e selo.
function textoSemVoos(sv) {
  return `${sv.so_diretos ? 'Sem voo direto' : 'Nenhum voo'} em ${dataCompacta(sv.data)} · ${sv.origem} → ${sv.destino}`;
}

// Diferença da última consulta para a média: texto e classe (abaixo/acima).
function comparacao(ultima, media, semVoos) {
  if (!ultima && semVoos) return { texto: textoSemVoos(semVoos), classe: 'sem-voos' };
  if (ultima && media) {
    const dif = (ultima.total / media - 1) * 100;
    return { texto: `${pct(dif)} ${dif < 0 ? 'abaixo' : 'acima'} da média`, classe: dif < 0 ? 'abaixo' : 'acima' };
  }
  return { texto: ultima ? 'Montando a média' : 'Aguardando a primeira consulta', classe: 'neutro' };
}

function datasTexto(a) {
  return a.data_volta ? `${dataCompacta(a.data_ida)} → ${dataCompacta(a.data_volta)}` : `${dataCompacta(a.data_ida)} · só ida`;
}

function cartaoAlerta(x) {
  const a = x.alerta;
  const sit = situacao(a);
  const cmp = comparacao(x.ultima, x.media, x.sem_voos);
  const ponta = (codigo, fim) => el('div', { class: `fa-ponta${fim ? ' fim' : ''}` }, el('strong', {}, codigo), el('span', {}, cidadeDe(codigo)));
  return el('a', { class: `cartao-alerta ${sit.classe}`, href: `/passagens/${a.id}` },
    el('div', { class: 'ca-bilhete' },
      el('div', { class: 'ca-cabeca' },
        el('span', { class: 'selo-bilhete' }, sit.texto),
        a.nome ? el('span', { class: 'ca-nome' }, a.nome) : null),
      el('div', { class: 'det-trajeto' },
        ponta(a.origem),
        el('div', { class: 'fa-linha', 'aria-hidden': 'true' }, icone('aviao', '')),
        ponta(a.destino, true))),
    el('div', { class: 'ca-corpo' },
      el('div', { class: 'ca-chips' },
        el('span', { class: 'chip' }, icone('calendario'), datasTexto(a)),
        el('span', { class: 'chip' }, icone('escala'), a.so_diretos === false ? 'Com escalas' : 'Só diretos'),
        el('span', { class: 'chip' }, icone('relogio'), rotuloIntervalo(a.intervalo_min)),
        el('span', { class: 'chip' }, icone('sino'), `${Math.round(a.desconto_min * 100)} % abaixo`)),
      el('div', { class: 'ca-preco' },
        el('div', {}, el('span', { class: 'rotulo' }, a.data_volta ? 'Total ida + volta' : 'Preço da ida'), el('strong', {}, x.ultima ? brl(x.ultima.total) : '—')),
        el('span', { class: `variacao ${cmp.classe}` }, cmp.texto))));
}

function titulo(a) {
  return `${a.origem} ${a.data_volta ? '⇄' : '→'} ${a.destino}`;
}

function cidades(a) {
  return `${cidadeDe(a.origem)} ${a.data_volta ? '⇄' : '→'} ${cidadeDe(a.destino)}`;
}

async function telaAlertas() {
  const t = montar('t-alertas');
  const carregar = async () => {
    const [r] = await Promise.all([api('alertas'), carregarAeroportos().catch(() => null)]);
    const n = r.alertas.length;
    $('[data-limite]', t).textContent = r.limite ? `${n} de ${r.limite} alertas` : `${n} ${n === 1 ? 'alerta' : 'alertas'}`;
    $('[data-novo]', t).hidden = r.limite != null && n >= r.limite;
    const lista = $('[data-lista]', t);
    lista.replaceChildren();
    if (!r.alertas.length) {
      lista.append(el('div', { class: 'vazio-grande' },
        el('span', { class: 'vazio-icone' }, icone('aviao', '')),
        el('h2', {}, 'Nenhum alerta ainda'),
        el('p', { class: 'nota' }, 'Escolha a rota e as datas: os preços passam a ser pesquisados sozinhos e o aviso chega no WhatsApp quando o total fica abaixo da média.'),
        el('a', { class: 'btn primario grande', href: '/passagens/nova' }, icone('mais'), 'Criar o primeiro alerta')));
      return;
    }
    for (const x of r.alertas) lista.append(cartaoAlerta(x));
    lista.append(el('a', { class: 'cartao-novo', href: '/passagens/nova' }, icone('mais', 'cartao-novo-icone'), el('strong', {}, 'Novo alerta'), el('span', {}, 'Outra rota ou outras datas')));
  };
  await carregar();
  atualizar = setInterval(() => carregar().catch(() => {}), 60e3);
}

const dataCurta = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
const dataCompacta = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${semana} ${d.getDate()} ${mes}`;
};
const diaSemana = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });
const INTERVALOS = [30, 60, 180, 360, 720, 1440];
const rotuloIntervalo = (m) => (m < 60 ? `${m} min` : m === 1440 ? '1 dia' : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const noitesEntre = (ida, volta) => Math.round((new Date(`${volta}T12:00:00`) - new Date(`${ida}T12:00:00`)) / 864e5);
const textoNoites = (n) => (n === 0 ? 'bate e volta' : `${n} ${n === 1 ? 'noite' : 'noites'}`);

// --- Campo de data (dd/mm/aaaa + calendário em português) ---------------------------------------
// O campo nativo segue o idioma do navegador (mm/dd em inglês); este é sempre brasileiro.
// A data fica em ISO no input escondido (name=data_ida/data_volta), que recebe 'change' ao mudar.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const isoDe = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const partes = (iso) => iso.split('-').map(Number); // [ano, mês 1-12, dia]
const somaDias = (iso, n) => { const [a, m, d] = partes(iso); const x = new Date(Date.UTC(a, m - 1, d + n)); return x.toISOString().slice(0, 10); };
const brDe = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
function isoDeBr(txt) {
  const m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const [a, mm, d] = partes(iso);
  const x = new Date(Date.UTC(a, mm - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === mm - 1 && x.getUTCDate() === d ? iso : null;
}

let idData = 0;

// caixa: .campo-data com o input escondido; faixa(): [ida, volta] para destacar o período.
function campoData(caixa, { rotulo, faixa }) {
  const oculto = $('input[type=hidden]', caixa);
  const dia = $('.campo-data-dia', caixa);
  const n = ++idData;
  const entrada = el('input', {
    type: 'text', class: 'data-entrada', id: `data-${n}`, inputmode: 'numeric', autocomplete: 'off',
    placeholder: 'dd/mm/aaaa', maxlength: '10', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-describedby': `data-${n}-dia`,
  });
  const botao = el('button', { type: 'button', class: 'data-abrir', 'aria-label': `Abrir calendário: ${rotulo}`, tabindex: '-1' }, icone('calendario'));
  const cal = el('div', { class: 'calendario', role: 'dialog', 'aria-label': `Calendário: ${rotulo}`, hidden: '' });
  dia.id = `data-${n}-dia`;
  $('.rotulo', caixa).replaceWith(el('label', { class: 'rotulo', for: entrada.id }, rotulo));
  oculto.before(el('div', { class: 'data-caixa' }, entrada, botao, cal));

  let mes = null; // [ano, mês 0-11] exibido
  let erroAtual = null; // texto digitado inválido: fica na tela com a mensagem até ser corrigido
  let foco = null; // ISO com o foco no calendário
  const limites = () => [oculto.min || hojeISO(), oculto.max || somaDias(hojeISO(), 365)];
  const valido = (iso) => { const [ini, fim] = limites(); return iso >= ini && iso <= fim; };

  const mostrar = (msg) => {
    const v = oculto.value;
    dia.className = `campo-data-dia${msg ? ' erro' : ''}`;
    dia.textContent = msg || (v ? diaSemana(v) : '');
    entrada.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  const definir = (iso, { avisar = true } = {}) => {
    erroAtual = null;
    oculto.value = iso || '';
    entrada.value = brDe(iso);
    mostrar();
    if (avisar) oculto.dispatchEvent(new Event('change'));
  };

  const desenhar = () => {
    const [ini, fim] = limites();
    const [a, m] = mes;
    const [fi, fv] = faixa ? faixa() : [null, null];
    const primeiro = new Date(Date.UTC(a, m, 1)).getUTCDay();
    const diasNoMes = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    const hoje = hojeISO();
    const antes = el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mês anterior' }, '‹');
    const depois = el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Próximo mês' }, '›');
    antes.disabled = isoDe(a, m, 1) <= ini.slice(0, 8) + '01';
    depois.disabled = isoDe(a, m, diasNoMes) >= fim;
    antes.addEventListener('click', () => mudarMes(-1));
    depois.addEventListener('click', () => mudarMes(1));
    const grade = el('div', { class: 'cal-grade', role: 'grid' });
    for (const s of SEMANA) grade.append(el('span', { class: 'cal-semana', 'aria-hidden': 'true' }, s));
    for (let i = 0; i < primeiro; i++) grade.append(el('span', { class: 'cal-vazio' }));
    for (let d = 1; d <= diasNoMes; d++) {
      const iso = isoDe(a, m, d);
      const cls = ['cal-dia'];
      if (iso === hoje) cls.push('hoje');
      if (iso === oculto.value) cls.push('escolhido');
      if (fi && fv && iso > fi && iso < fv) cls.push('entre');
      if (iso === fi && fv) cls.push('inicio');
      if (iso === fv && fi) cls.push('fim');
      const b = el('button', {
        type: 'button', class: cls.join(' '), 'data-iso': iso, role: 'gridcell', tabindex: iso === foco ? '0' : '-1',
        'aria-label': `${d} de ${MESES[m]} de ${a}, ${SEMANA_LONGA[new Date(`${iso}T12:00:00`).getDay()]}`,
        'aria-selected': iso === oculto.value ? 'true' : 'false',
      }, String(d));
      b.disabled = iso < ini || iso > fim;
      b.addEventListener('click', () => escolher(iso));
      grade.append(b);
    }
    cal.replaceChildren(
      el('div', { class: 'cal-topo' }, antes, el('strong', { 'aria-live': 'polite' }, `${MESES[m]} de ${a}`), depois),
      grade,
      el('p', { class: 'cal-rodape' }, `Datas de ${brDe(ini)} a ${brDe(fim)}`));
  };
  const focarDia = () => $(`[data-iso="${foco}"]`, cal)?.focus();
  const irPara = (iso) => {
    const [ini, fim] = limites();
    iso = iso < ini ? ini : iso > fim ? fim : iso;
    foco = iso;
    const [a, m] = partes(iso);
    mes = [a, m - 1];
    desenhar();
    focarDia();
  };
  const mudarMes = (k) => {
    let [a, m] = mes;
    m += k;
    if (m < 0) { m = 11; a -= 1; } else if (m > 11) { m = 0; a += 1; }
    mes = [a, m];
    const [, , d] = partes(foco || isoDe(a, m, 1));
    const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    foco = isoDe(a, m, Math.min(d, ultimo));
    desenhar();
  };
  const abrir = () => {
    if (!cal.hidden) return;
    const [ini] = limites();
    foco = oculto.value && valido(oculto.value) ? oculto.value : (faixa && faixa()[0] && faixa()[0] >= ini ? faixa()[0] : ini);
    const [a, m] = partes(foco);
    mes = [a, m - 1];
    desenhar();
    cal.hidden = false;
    entrada.setAttribute('aria-expanded', 'true');
  };
  const fechar = () => { cal.hidden = true; entrada.setAttribute('aria-expanded', 'false'); };
  const escolher = (iso) => { definir(iso); fechar(); entrada.focus(); };

  // Digitação com máscara: só números, barras automáticas.
  entrada.addEventListener('input', () => {
    erroAtual = null;
    const dig = entrada.value.replace(/\D/g, '').slice(0, 8);
    entrada.value = [dig.slice(0, 2), dig.slice(2, 4), dig.slice(4)].filter(Boolean).join('/');
    mostrar();
    if (dig.length === 8) {
      const iso = isoDeBr(entrada.value);
      if (iso && valido(iso)) { definir(iso); if (!cal.hidden) { foco = iso; const [a, m] = partes(iso); mes = [a, m - 1]; desenhar(); } }
    }
  });
  const confirmarTexto = () => {
    const txt = entrada.value.trim();
    if (!txt) { if (oculto.value) definir(''); return; }
    const iso = isoDeBr(txt);
    const [ini, fim] = limites();
    const msg = !iso ? 'Data inválida. Use dd/mm/aaaa.'
      : iso < ini ? `A data precisa ser a partir de ${brDe(ini)}.`
        : iso > fim ? `A data pode ser até ${brDe(fim)}.` : null;
    if (msg) {
      // Data inválida não deixa a anterior valendo por baixo: limpa o valor e mantém o texto e o aviso.
      erroAtual = msg;
      if (oculto.value) { oculto.value = ''; oculto.dispatchEvent(new Event('change')); }
      mostrar(msg);
      return;
    }
    if (iso !== oculto.value) definir(iso);
  };
  entrada.addEventListener('focus', abrir);
  entrada.addEventListener('click', abrir);
  entrada.addEventListener('blur', () => setTimeout(() => { if (!caixa.contains(document.activeElement)) { fechar(); confirmarTexto(); } }, 0));
  entrada.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || (ev.key === 'Enter' && !cal.hidden && !entrada.value)) { ev.preventDefault(); abrir(); focarDia(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); confirmarTexto(); fechar(); }
    else if (ev.key === 'Escape') { fechar(); }
    else if (ev.key === 'Tab') { fechar(); confirmarTexto(); } // sai do campo; o calendário se usa com a seta para baixo
  });
  botao.addEventListener('click', () => { if (cal.hidden) { abrir(); focarDia(); } else { fechar(); entrada.focus(); } });
  cal.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
  cal.addEventListener('keydown', (ev) => {
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (passos[ev.key] && foco) { ev.preventDefault(); irPara(somaDias(foco, passos[ev.key])); }
    else if (ev.key === 'PageUp' || ev.key === 'PageDown') { ev.preventDefault(); mudarMes(ev.key === 'PageUp' ? -1 : 1); focarDia(); }
    else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      const dsem = new Date(`${foco}T12:00:00`).getDay();
      irPara(somaDias(foco, ev.key === 'Home' ? -dsem : 6 - dsem));
    } else if (ev.key === 'Escape') { ev.preventDefault(); fechar(); entrada.focus(); }
  });
  cal.addEventListener('focusout', () => setTimeout(() => { if (!caixa.contains(document.activeElement)) fechar(); }, 0));
  document.addEventListener('mousedown', (ev) => { if (!caixa.contains(ev.target)) fechar(); }, { signal: sinalTela.signal });

  return {
    // O formulário mudou o valor ou o mínimo por código: atualiza o texto (e o calendário aberto).
    sincronizar: () => {
      if (erroAtual) mostrar(erroAtual);
      else if (document.activeElement !== entrada) { entrada.value = brDe(oculto.value); mostrar(); }
      if (!cal.hidden) desenhar();
    },
    abrir: () => { entrada.focus(); abrir(); },
    focar: () => entrada.focus(),
    erro: (msg) => { erroAtual = msg; mostrar(msg); },
  };
}

// base: alerta existente (edição) ou modelo para um alerta novo (duplicar).
function formAlerta(lugar, alerta, base = alerta) {
  lugar.replaceChildren($('#t-form-alerta').content.cloneNode(true));
  const f = $('form', lugar);
  const msg = $('[data-msg]', f);
  const r = (nome) => $(`[data-r="${nome}"]`, f);
  const origem = campoAeroporto($('[data-aeroporto="origem"]', f), { rotulo: 'De onde', aoEscolher: (c) => { atualizar(); if (c && !destino.valor) destino.focar(); } });
  const destino = campoAeroporto($('[data-aeroporto="destino"]', f), { rotulo: 'Para onde', aoEscolher: () => atualizar() });
  const voltaCaixa = $('[data-volta]', f);
  let voltaGuardada = '';
  const faixaDatas = () => [f.data_ida.value || null, f.data_volta.value || null];
  const dataIda = campoData($('[data-campo-data="ida"]', f), { rotulo: 'Ida', faixa: faixaDatas });
  const dataVolta = campoData($('[data-campo-data="volta"]', f), { rotulo: 'Volta', faixa: faixaDatas });

  const soIda = () => f.tipo.value === 'so-ida';
  const soDiretos = () => f.voos.value === 'diretos';

  // Intervalo: pílulas com os valores comuns (e o valor atual do alerta, se for outro).
  const caixaIntervalos = $('[data-intervalos]', f);
  const montarIntervalos = (atual) => {
    const lista = [...new Set([...INTERVALOS, atual])].sort((x, y) => x - y);
    caixaIntervalos.replaceChildren(...lista.map((m) => el('label', {},
      Object.assign(el('input', { type: 'radio', name: 'intervalo_opcao', value: String(m) }), { checked: m === atual }),
      el('span', {}, rotuloIntervalo(m)))));
    f.intervalo_min.value = atual;
  };
  caixaIntervalos.addEventListener('change', (ev) => { f.intervalo_min.value = ev.target.value; atualizar(); });

  const atualizar = () => {
    const ida = f.data_ida.value;
    f.data_volta.min = ida || hojeISO();
    if (ida && f.data_volta.value && f.data_volta.value < ida) f.data_volta.value = '';
    voltaCaixa.hidden = soIda();
    f.data_volta.required = !soIda();
    dataIda.sincronizar();
    dataVolta.sincronizar();
    const noites = !soIda() && ida && f.data_volta.value ? noitesEntre(ida, f.data_volta.value) : null;
    const selo = $('[data-noites]', f);
    selo.hidden = noites == null;
    selo.textContent = noites == null ? '' : textoNoites(noites);
    $('[data-dica-voos]', f).textContent = soDiretos()
      ? 'Só voos sem escala. Em rotas longas ou internacionais, “Com escalas” costuma achar preço (e às vezes o único voo).'
      : 'Voos diretos e com até 2 escalas; vale o total mais barato entre eles.';

    const pct = Number(f.desconto_pct.value);
    $('[data-desconto-valor]', f).textContent = `${pct} %`;
    f.desconto_pct.style.setProperty('--preenchido', `${((pct - f.desconto_pct.min) / (f.desconto_pct.max - f.desconto_pct.min)) * 100}%`);
    $('[data-desconto-exemplo]', f).textContent = `Exemplo: com média de R$ 1.000, o aviso sai quando o total chega a ${brl(1000 * (1 - pct / 100))} ou menos.`;

    // Resumo ao lado (ou na barra de baixo, no celular).
    const ao = aeroporto(origem.valor);
    const ad = aeroporto(destino.valor);
    r('origem').textContent = origem.valor || '—';
    r('destino').textContent = destino.valor || '—';
    r('origem-cidade').textContent = ao ? ao.cidade : 'Origem';
    r('destino-cidade').textContent = ad ? ad.cidade : 'Destino';
    r('viagem').textContent = `${soIda() ? 'Só ida' : 'Ida e volta'} · ${soDiretos() ? 'só diretos' : 'com escalas'}`;
    r('datas').textContent = !ida ? 'Escolha a data da ida'
      : soIda() ? dataCompacta(ida)
        : f.data_volta.value ? `${dataCompacta(ida)} → ${dataCompacta(f.data_volta.value)}` : `${dataCompacta(ida)} → escolha a volta`;
    $('[data-r-duracao]', f).hidden = noites == null;
    r('duracao').textContent = noites == null ? '' : textoNoites(noites);
    r('aviso').textContent = `${pct} % abaixo da média${f.ativo.checked ? '' : ' · pausado'}`;
    r('pesquisa').textContent = `a cada ${rotuloIntervalo(Number(f.intervalo_min.value))}`;
    const rota = origem.valor && destino.valor ? `${origem.valor} ${soIda() ? '→' : '⇄'} ${destino.valor}` : 'Escolha origem e destino';
    r('curto').textContent = ida ? `${rota} · ${diaMes(ida)}${!soIda() && f.data_volta.value ? `–${diaMes(f.data_volta.value)}` : ''}` : rota;
  };

  for (const x of f.querySelectorAll('input[name="tipo"]')) {
    x.addEventListener('change', () => {
      if (soIda()) { voltaGuardada = f.data_volta.value; f.data_volta.value = ''; }
      else if (!f.data_volta.value) f.data_volta.value = voltaGuardada;
      atualizar();
    });
  }
  for (const c of [f.data_ida, f.data_volta]) c.addEventListener('change', atualizar);
  for (const c of [...f.querySelectorAll('input[name="voos"]'), f.desconto_pct, f.ativo]) c.addEventListener('input', atualizar);
  // Ida escolhida e volta vazia: já abre a volta.
  f.data_ida.addEventListener('change', () => {
    if (!soIda() && f.data_ida.value && !f.data_volta.value) setTimeout(() => dataVolta.abrir(), 0);
  });
  $('[data-trocar]', f).addEventListener('click', (ev) => {
    const o = origem.valor;
    origem.definir(destino.valor, { avisar: false });
    destino.definir(o, { avisar: false });
    ev.currentTarget.classList.remove('girou');
    void ev.currentTarget.offsetWidth; // reinicia a animação
    ev.currentTarget.classList.add('girou');
    atualizar();
  });

  f.data_ida.min = hojeISO();
  let intervalo = 30;
  if (base) {
    if (alerta) {
      $('[data-titulo]', f).textContent = 'Rota';
      $('[data-salvar]', f).textContent = 'Salvar alterações';
      $('[data-cancelar]', f).hidden = true;
      f.nome.value = alerta.nome || '';
    }
    // Duplicar leva as datas junto enquanto ainda valem.
    if (alerta || base.data_ida >= hojeISO()) {
      f.data_ida.value = base.data_ida;
      f.data_volta.value = base.data_volta || '';
    }
    f.tipo.value = base.data_volta ? 'ida-volta' : 'so-ida';
    f.voos.value = base.so_diretos === false ? 'escalas' : 'diretos';
    const pct = Math.round(base.desconto_min * 100);
    if (pct > Number(f.desconto_pct.max)) { f.desconto_pct.max = pct; $('[data-desconto-max]', f).textContent = `${pct} %`; }
    f.desconto_pct.value = pct;
    intervalo = base.intervalo_min;
    f.ativo.checked = alerta ? alerta.ativo : true;
  }
  montarIntervalos(intervalo);
  // Os nomes das cidades dependem da lista; o código já vale enquanto ela carrega.
  const preencher = () => {
    origem.definir(base?.origem || '', { avisar: false });
    destino.definir(base?.destino || '', { avisar: false });
    atualizar();
  };
  preencher();
  carregarAeroportos().then(preencher).catch(() => {});

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    msg.className = 'msg';
    msg.textContent = '';
    const problemas = [];
    if (!origem.valor) { origem.erro('Escolha a origem na lista.'); problemas.push(origem); }
    if (!destino.valor) { destino.erro('Escolha o destino na lista.'); problemas.push(destino); }
    if (origem.valor && origem.valor === destino.valor) { destino.erro('Destino igual à origem.'); problemas.push(destino); }
    if (problemas.length) { problemas[0].focar(); return; }
    if (!f.data_ida.value) { dataIda.erro('Escolha a data da ida.'); dataIda.focar(); return; }
    if (!soIda() && !f.data_volta.value) { dataVolta.erro('Escolha a data da volta.'); dataVolta.focar(); return; }
    const body = {
      nome: f.nome.value,
      origem: origem.valor,
      destino: destino.valor,
      data_ida: f.data_ida.value,
      data_volta: soIda() ? null : f.data_volta.value,
      so_diretos: soDiretos(),
      desconto_pct: Number(f.desconto_pct.value),
      intervalo_min: Number(f.intervalo_min.value),
      ativo: f.ativo.checked,
    };
    if (alerta) {
      const muda = body.origem !== alerta.origem || body.destino !== alerta.destino || body.so_diretos !== (alerta.so_diretos !== false)
        || body.data_ida !== alerta.data_ida || (body.data_volta || null) !== (alerta.data_volta || null);
      if (muda && !confirm('Rota, datas ou escalas mudaram: a média recomeça do zero. Continuar?')) return;
    }
    msg.textContent = 'Salvando…';
    enviar(f, async () => {
      const res = alerta
        ? await api(`alertas/${alerta.id}`, { method: 'PUT', body })
        : await api('alertas', { method: 'POST', body });
      msg.className = 'msg ok';
      msg.textContent = 'Salvo.';
      ir(`/passagens/${res.alerta.id}`);
    });
  });
}

async function telaNovo(baseId) {
  const t = montar('t-alertas');
  $('.topo', t).replaceChildren(el('div', { class: 'novo-cabeca' },
    el('p', { class: 'sub' }, el('a', { href: '/passagens' }, '← Meus alertas')),
    el('h1', {}, baseId ? 'Novo alerta a partir de outro' : 'Novo alerta'),
    el('p', { class: 'sub' }, 'Os preços são pesquisados sozinhos e o aviso chega no WhatsApp quando o total cai abaixo da média.')));
  let base = null;
  if (baseId) base = (await api(`alertas/${baseId}`).catch(() => null))?.alerta || null;
  const lugar = $('[data-lista]', t);
  lugar.className = 'lugar-novo';
  formAlerta(lugar, null, base);
  $$('.combo-entrada', t)[base ? 1 : 0].focus();
}

function linkSeguro(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

// comoAdmin: detalhe de alerta de qualquer usuário, só leitura (Administração › Alertas ligados).
async function telaDetalhe(id, { comoAdmin = false } = {}) {
  if (comoAdmin && !usuario.admin) return ir('/passagens');
  const t = montar('t-detalhe');
  const base = comoAdmin ? `admin/alertas/${id}` : `alertas/${id}`;
  let dias = 30;
  let dados = null;
  if (comoAdmin) {
    for (const x of [$('.det-acoes', t), $('.secao-titulo', t), $('[data-form-lugar]', t), $('.painel.perigo', t)]) x.remove();
    const voltar = $('.voltar a', t);
    voltar.href = '/admin/alertas';
    voltar.replaceChildren(icone('seta'), 'Alertas ligados');
  }

  const desenhar = () => {
    const { alerta: a, ultima, media, n_media: n, minimo } = dados;
    document.title = `${titulo(a)} · Buscador de Passagens`;
    $('[data-titulo]', t).textContent = a.nome ? `${a.nome}: ${cidades(a)}` : cidades(a);
    const sit = situacao(a);
    $('[data-bilhete]', t).className = `det-bilhete ${sit.classe}`;
    $('[data-estado]', t).textContent = sit.texto;
    $('[data-nome]', t).textContent = a.nome || '';
    const b = (nome) => $(`[data-b="${nome}"]`, t);
    b('origem').textContent = a.origem;
    b('destino').textContent = a.destino;
    b('origem-cidade').textContent = cidadeDe(a.origem);
    b('destino-cidade').textContent = cidadeDe(a.destino);
    b('ida').textContent = dataCompacta(a.data_ida);
    b('volta').textContent = a.data_volta ? `${dataCompacta(a.data_volta)} · ${textoNoites(noitesEntre(a.data_ida, a.data_volta))}` : 'Só ida';
    b('voos').textContent = a.so_diretos === false ? 'Com escalas' : 'Só diretos';
    b('aviso').textContent = `${Math.round(a.desconto_min * 100)} % abaixo da média`;
    b('pesquisa').textContent = `A cada ${rotuloIntervalo(a.intervalo_min)}`;
    $('[data-titulo-grafico]', t).textContent = a.data_volta ? 'Total ida + volta' : 'Preço da ida';
    if (!comoAdmin) {
      const lig = $('[data-ligar]', t);
      lig.replaceChildren(icone(a.ativo ? 'pausa' : 'play'), a.ativo ? 'Pausar alerta' : 'Religar alerta');
      lig.title = a.ativo ? 'Pausa as pesquisas e os avisos no WhatsApp' : 'Volta a pesquisar e avisar';
      const pesq = $('[data-pesquisar]', t);
      pesq.disabled = a.pesquisa_pedida;
      pesq.classList.toggle('girando', a.pesquisa_pedida);
      $('span', pesq).textContent = a.pesquisa_pedida ? 'Pesquisando…' : 'Pesquisar agora';
    }

    const k = (nome) => $(`[data-k="${nome}"]`, t);
    k('ultima').textContent = ultima ? brl(ultima.total) : '—';
    const det = k('ultima-det');
    const cmp = comparacao(ultima, media);
    det.replaceChildren(ultima ? `${dataHora(ultima.ts)} · ` : '', el('span', { class: `variacao ${cmp.classe}` }, ultima && media ? cmp.texto : ultima ? 'montando a média' : 'nenhuma consulta ainda'));
    k('media').textContent = brl(media);
    k('media-det').textContent = media ? `${n} consulta${n === 1 ? '' : 's'} anteriores` : 'Sem histórico ainda';
    k('gatilho').textContent = media ? brl(media * (1 - a.desconto_min)) : '—';
    k('gatilho-det').textContent = `Aviso com total ${Math.round(a.desconto_min * 100)} % abaixo da média`;
    k('minimo').textContent = minimo ? brl(minimo.total) : '—';
    k('minimo-det').textContent = minimo ? dataHora(minimo.ts) : '';

    desenharSemVoos(t, dados, comoAdmin, id);
    if (comoAdmin && dados.usuario) {
      let dono = $('[data-dono]', t);
      if (!dono) {
        dono = el('p', { class: 'det-dono', 'data-dono': '' });
        $('.det-bilhete', t).before(dono);
      }
      dono.replaceChildren(el('span', { class: 'chip chip-admin' }, 'Administração'), ` Alerta de ${dados.usuario.nome} · ${dados.usuario.telefone} · criado em ${new Date(dados.criado_em).toLocaleDateString('pt-BR')} · só leitura`);
    }
    desenharVoos($('[data-voos]', t), a, ultima);
    desenharFontes($('[data-fontes]', t), dados.fontes, a.so_diretos !== false);
  };

  const carregarGrafico = async () => {
    const { pontos } = await api(`${base}/historico?dias=${dias}`);
    const vazio = pontos.length === 0;
    $('[data-grafico-vazio]', t).hidden = !vazio;
    $('.grafico', t).hidden = vazio;
    if (grafico) { grafico.destroy(); grafico = null; }
    if (vazio) return;
    const desconto = dados.alerta.desconto_min;
    const serie = (f) => pontos.map((p) => ({ x: new Date(p.ts), y: f(p) }));
    const texto = cor('--suave');
    const grade = cor('--borda');
    grafico = new Chart($('canvas', t), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Total', data: serie((p) => p.total), borderColor: cor('--serie-total'), backgroundColor: cor('--serie-total'), borderWidth: 2, pointRadius: pontos.map((p) => (p.alertado ? 5 : pontos.length < 3 ? 4 : 0)), pointHoverRadius: 4, tension: 0.2 },
          { label: 'Média 7 dias', data: serie((p) => p.media), borderColor: cor('--serie-media'), borderWidth: 1.5, pointRadius: 0, spanGaps: true },
          { label: 'Gatilho do aviso', data: serie((p) => p.media && p.media * (1 - desconto)), borderColor: cor('--serie-gatilho'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, spanGaps: true },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd/MM HH:mm', displayFormats: { minute: 'HH:mm', hour: 'dd/MM HH:mm', day: 'dd/MM' } }, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 16 }, grid: { color: grade } },
          y: { ticks: { color: texto, callback: (v) => brl(v) }, grid: { color: grade } },
        },
        plugins: {
          legend: { labels: { color: texto, boxWidth: 14 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${brl(ctx.parsed.y)}`,
              afterBody: (itens) => {
                const p = pontos[itens[0].dataIndex];
                const l = [`Ida ${brl(p.ida)} · ${textoEscalas(p.escalas_ida)} (${fontes[p.fonte_ida] || p.fonte_ida})`];
                if (p.volta != null) l.push(`Volta ${brl(p.volta)} · ${textoEscalas(p.escalas_volta)} (${fontes[p.fonte_volta] || p.fonte_volta})`);
                if (p.alertado) l.push('Alerta enviado');
                return l;
              },
            },
          },
        },
      },
    });
  };

  const carregar = async (comGrafico) => {
    dados = await api(base);
    desenhar();
    if (comGrafico) await carregarGrafico();
  };

  try {
    await Promise.all([carregar(false), carregarAeroportos().catch(() => null)]);
    desenhar();
  } catch (e) {
    $('#tela').replaceChildren(el('section', { class: 'conteudo' }, el('p', {}, e.message), el('a', { href: comoAdmin ? '/admin/alertas' : '/passagens' }, '← Voltar')));
    return;
  }
  await carregarGrafico();
  let voltas = 0;
  atualizar = setInterval(() => { voltas += 1; carregar(voltas % 4 === 0).catch(() => {}); }, 15e3);
  window.addEventListener('tema', () => carregarGrafico().catch(() => {}), { signal: sinalTela.signal });
  $('[data-periodo]', t).addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    dias = Number(b.dataset.dias);
    for (const x of $('[data-periodo]', t).children) x.classList.toggle('ativo', x === b);
    carregarGrafico();
  });
  if (comoAdmin) return;
  formAlerta($('[data-form-lugar]', t), dados.alerta);
  $('[data-duplicar]', t).href = `/passagens/nova/${id}`;

  $('[data-pesquisar]', t).addEventListener('click', async () => {
    await api(`alertas/${id}/pesquisar`, { method: 'POST', body: {} });
    dados.alerta.pesquisa_pedida = true;
    desenhar();
  });
  $('[data-ligar]', t).addEventListener('click', async () => {
    const a = dados.alerta;
    const body = { nome: a.nome, origem: a.origem, destino: a.destino, data_ida: a.data_ida, data_volta: a.data_volta, desconto_pct: Math.round(a.desconto_min * 1000) / 10, intervalo_min: a.intervalo_min, so_diretos: a.so_diretos !== false, ativo: !a.ativo };
    const r = await api(`alertas/${id}`, { method: 'PUT', body }).catch((e) => alert(e.message));
    if (r) { dados.alerta = r.alerta; desenhar(); $('[data-form-lugar] input[name=ativo]', t).checked = r.alerta.ativo; }
  });
  $('[data-apagar]', t).addEventListener('click', async () => {
    if (!confirm('Apagar este alerta e todo o histórico dele?')) return;
    const r = await api(`alertas/${id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    if (r) ir('/passagens');
  });
}

// Aviso quando os sites responderam e nenhum achou voo: explica e oferece o próximo passo.
function desenharSemVoos(t, dados, comoAdmin, id) {
  let caixa = $('[data-sem-voos]', t);
  const sv = dados.sem_voos;
  if (!sv || dados.ultima) { if (caixa) caixa.remove(); return; }
  if (!caixa) {
    caixa = el('div', { class: 'aviso-sem-voos', role: 'status', 'data-sem-voos': '' });
    $('.det-bilhete', t).after(caixa);
  }
  const a = dados.alerta;
  const acoes = [];
  if (!comoAdmin && sv.so_diretos) {
    const b = el('button', { type: 'button', class: 'btn primario' }, icone('escala'), 'Incluir voos com escala');
    b.addEventListener('click', async () => {
      b.disabled = true;
      const body = { nome: a.nome, origem: a.origem, destino: a.destino, data_ida: a.data_ida, data_volta: a.data_volta, desconto_pct: Math.round(a.desconto_min * 1000) / 10, intervalo_min: a.intervalo_min, so_diretos: false, ativo: a.ativo };
      try {
        await api(`alertas/${id}`, { method: 'PUT', body });
        ir(`/passagens/${id}`); // mesmo caminho: ir() redesenha a tela
      } catch (e) { b.disabled = false; alert(e.message); }
    });
    acoes.push(b);
  }
  if (!comoAdmin) {
    const d = el('button', { type: 'button', class: 'btn' }, icone('calendario'), 'Trocar as datas');
    d.addEventListener('click', () => { const f = $('[data-form-lugar]', t); f.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('.data-entrada', f)?.focus(), 400); });
    acoes.push(d);
  }
  const quando = `${sv.origem} → ${sv.destino} em ${dataCompacta(sv.data)}`;
  caixa.replaceChildren(
    el('span', { class: 'aviso-sem-voos-icone', 'aria-hidden': 'true' }, icone('lupa', '')),
    el('div', { class: 'aviso-sem-voos-texto' },
      el('strong', {}, sv.so_diretos ? `Nenhum voo direto ${quando}` : `Nenhum voo ${quando}`),
      el('p', {}, `${sv.sites} ${sv.sites === 1 ? 'site respondeu' : 'sites responderam'} e nenhum tem ${sv.so_diretos ? 'voo direto' : 'voo'} nessa data${a.data_volta ? '' : ''}. `
        + (sv.so_diretos ? 'Com escala costuma haver opção; outra data também pode ter voo direto. ' : 'Outra data ou outro aeroporto próximo pode ter voo. ')
        + 'As pesquisas continuam no intervalo do alerta: se aparecer voo, a primeira consulta sai sozinha.'),
      acoes.length ? el('div', { class: 'aviso-sem-voos-acoes' }, ...acoes) : null));
}

function desenharVoos(box, a, ultima) {
  box.replaceChildren();
  if (!ultima) {
    box.append(el('p', { class: 'vazio' }, 'Aguardando a primeira consulta.'));
    return;
  }
  const trechos = [['ida', 'Ida', a.data_ida, a.origem, a.destino]];
  if (ultima.volta) trechos.push(['volta', 'Volta', a.data_volta, a.destino, a.origem]);
  for (const [k, nome, data, o, d] of trechos) {
    const v = ultima[k];
    const link = v.link && linkSeguro(v.link);
    const fonte = fontes[v.fonte] || v.fonte;
    box.append(el('div', { class: 'voo' },
      el('div', { class: 'voo-cabeca' }, el('span', { class: 'voo-trecho' }, `${nome} · ${dataCompacta(data)}`), el('span', { class: 'voo-rota' }, `${o} → ${d}`)),
      el('div', { class: 'voo-linha' },
        el('div', { class: 'voo-horario' },
          el('strong', {}, v.partida),
          el('span', { class: `voo-meio${v.escalas ? ' com-escala' : ''}` }, textoEscalas(v.escalas)),
          el('strong', {}, v.chegada)),
        el('span', { class: 'preco' }, brl(v.preco))),
      el('div', { class: 'voo-rodape' },
        el('span', {}, `${v.companhia}${v.voo ? ` · ${v.voo}` : ''}`),
        link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, `Ver em ${fonte} ↗`) : el('span', {}, fonte))));
  }
  box.append(el('div', { class: 'voo-total' },
    el('span', {}, `Consulta de ${dataHora(ultima.ts)}`),
    el('div', {}, el('span', { class: 'rotulo' }, 'Total'), el('strong', {}, brl(ultima.total)))));
}

function desenharFontes(box, trechos, soDiretos) {
  box.replaceChildren();
  for (const tr of trechos || []) {
    const lista = el('ul', { class: 'fontes' });
    for (const f of tr.fontes) {
      let quando = f.ts ? dataHora(f.ts) : 'ainda não pesquisado';
      let estado = f.ok ? 'ok' : f.ok === false ? 'falha' : 'espera';
      if (f.pesquisando) { quando = 'pesquisando…'; estado = 'andando'; }
      else if (f.pausada) { quando = 'fora do ar no momento'; estado = 'falha'; }
      else if (f.ok === false) quando = `sem resposta · ${f.ts ? dataHora(f.ts) : ''}`;
      lista.append(el('li', { class: `fonte ${estado}` },
        el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }),
        el('span', { class: 'fonte-nome' }, f.nome, el('small', {}, quando)),
        el('span', { class: 'fonte-preco' }, f.ok ? (f.menor != null ? brl(f.menor) : soDiretos ? 'sem voo direto' : 'sem voo') : '—')));
    }
    box.append(el('div', { class: 'fontes-trecho' }, el('p', { class: 'fontes-titulo' }, `${tr.origem} → ${tr.destino} · ${dataCompacta(tr.data)}`), lista));
  }
}

// --- Conta --------------------------------------------------------------------------------------

async function telaConta() {
  const t = montar('t-conta');
  const fNome = $('[data-form="nome"]', t);
  fNome.nome.value = usuario.nome;
  $('[data-tel]', t).textContent = usuario.telefone;
  $('[data-tel-topo]', t).textContent = usuario.nome;
  for (const r of $$('input[name="tema"]', t)) r.checked = r.value === temaEscolhido();
  $('[data-tema-opcoes]', t).addEventListener('change', (ev) => aplicarTema(ev.target.value));
  fNome.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(fNome, async () => {
      await api('eu', { method: 'PUT', body: { nome: fNome.nome.value } });
      usuario.nome = fNome.nome.value.trim();
      Object.assign($('[data-msg]', fNome), { className: 'msg ok', textContent: 'Salvo.' });
    });
  });
  const fSenha = $('[data-form="senha"]', t);
  fSenha.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(fSenha, async () => {
      await api('eu/senha', { method: 'POST', body: { atual: fSenha.atual.value, nova: fSenha.nova.value } });
      fSenha.reset();
      Object.assign($('[data-msg]', fSenha), { className: 'msg ok', textContent: 'Senha trocada. Os outros aparelhos saíram da conta.' });
    });
  });
  $('[data-sair-todos]', t).addEventListener('click', async () => {
    if (!confirm('Sair de todos os aparelhos, inclusive este?')) return;
    await api('eu/sair-de-todos', { method: 'POST', body: {} });
    usuario = null;
    ir('/entrar');
  });
  const fApagar = $('[data-form="apagar"]', t);
  fApagar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!confirm('Apagar a conta, os alertas e o histórico? Não tem volta.')) return;
    enviar(fApagar, async () => {
      await api('eu', { method: 'DELETE', body: { senha: fApagar.senha.value } });
      usuario = null;
      ir('/cadastro');
    });
  });
}

// --- Administração ------------------------------------------------------------------------------
// Só admin chega aqui; o backend também só responde admin/estado a admin (404 para os demais).
async function telaAdmin(abaInicial = 'geral') {
  if (!usuario.admin) return ir('/passagens');
  const t = montar('t-admin');
  let aba = abaInicial;
  const n = (nome, v) => { $(`[data-n="${nome}"]`, t).textContent = v; };

  const carregar = {
    geral: async () => desenharOperacao($('[data-operacao]', t), await api('admin/estado')),
    fontes: async () => {
      const { fontes: lista, saidas } = await api('admin/fontes');
      n('fontes', `${lista.filter((f) => f.ligada).length}/${lista.length}`);
      // Não redesenha com um seletor aberto ou em uso (a atualização a cada 10 s tiraria a escolha da mão).
      if ($('[data-fontes-lista] select:focus', t)) return;
      desenharFontesAdmin($('[data-fontes-lista]', t), lista, saidas, () => carregar.fontes());
    },
    alertas: async () => {
      const [{ alertas }] = await Promise.all([api('admin/alertas'), carregarAeroportos().catch(() => null)]);
      n('alertas', alertas.length);
      desenharAlertasAdmin($('[data-alertas-lista]', t), alertas);
    },
    usuarios: async () => {
      const { usuarios } = await api('admin/usuarios');
      n('usuarios', usuarios.length);
      desenharUsuariosAdmin($('[data-usuarios-lista]', t), usuarios);
    },
    empregos: async () => {
      const ativas = await carregarEmpregosAdmin($('[data-painel="empregos"]', t));
      if (ativas != null) n('empregos', ativas);
    },
  };
  const falhou = (onde) => (e) => {
    const caixa = onde === 'geral' ? $('[data-operacao]', t) : onde === 'empregos' ? $('[data-emp-adm-resumo]', t) : $(`[data-painel="${onde}"]`, t);
    if (!$('.adm-erro', caixa)) caixa.prepend(el('p', { class: 'nota erro adm-erro' }, e.message));
  };
  const mostrarAba = (nova) => {
    aba = nova;
    history.replaceState(null, '', nova === 'geral' ? '/admin' : `/admin/${nova === 'fontes' ? 'sites' : nova}`);
    for (const b of $$('[data-aba]', t)) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
    for (const p of $$('[data-painel]', t)) p.hidden = p.dataset.painel !== aba;
    carregar[aba]().catch(falhou(aba));
  };
  $('.abas', t).addEventListener('click', (ev) => { const b = ev.target.closest('[data-aba]'); if (b) mostrarAba(b.dataset.aba); });
  $('.abas', t).addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const abas = $$('[data-aba]', t);
    const i = abas.findIndex((b) => b.dataset.aba === aba);
    const prox = abas[(i + (ev.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    prox.focus();
    mostrarAba(prox.dataset.aba);
  });
  // Todas as contagens logo de cara; depois só a aba aberta se atualiza.
  for (const b of $$('[data-aba]', t)) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
  for (const p of $$('[data-painel]', t)) p.hidden = p.dataset.painel !== aba;
  await Promise.all(Object.entries(carregar).map(([k, f]) => f().catch(falhou(k))));
  // Empregos muda devagar (coletas a cada 3 h): atualiza a cada 30 s em vez de 10.
  let voltas = 0;
  atualizar = setInterval(() => {
    voltas += 1;
    if (aba === 'usuarios' || (aba === 'empregos' && voltas % 3)) return;
    carregar[aba]().catch(() => {});
  }, 10e3);
}

const dataHoraCurta = (ms) => (ms ? dataHora(ms) : '—');

// Seletores de saída e reserva de um site; grava ao mudar qualquer um.
function escolhaSaidas(f, saidas, recarregar) {
  const nomes = Object.fromEntries(saidas.map((s) => [s.id, s.nome]));
  const opcoes = (sel, vazio) => [
    vazio ? el('option', { value: '' }, 'Nenhuma') : null,
    ...saidas.map((s) => {
      const o = el('option', { value: s.id }, s.configurada ? s.nome : `${s.nome} · não configurada`);
      o.disabled = !s.configurada;
      o.selected = s.id === sel;
      return o;
    }),
  ];
  const principal = el('select', { 'aria-label': `Saída de ${f.nome}` }, ...opcoes(f.saidas[0], false));
  const reserva = el('select', { 'aria-label': `Reserva de ${f.nome}` }, ...opcoes(f.saidas[1] || '', true));
  if (!f.saidas[1]) reserva.value = '';
  const aviso = el('p', { class: 'adm-saida-aviso' });
  const msg = el('span', { class: 'msg', role: 'status' });
  const padrao = JSON.stringify(f.saidas) === JSON.stringify(f.saidas_padrao);
  const avisar = () => {
    const usa = [principal.value, reserva.value];
    aviso.hidden = !usa.includes('residencial');
    aviso.textContent = f.tipo === 'navegador'
      ? 'Proxy residencial é cobrado por GB e entra no teto diário; o consumo deste site é medido.'
      : 'Proxy residencial é cobrado por GB. Este site não abre navegador: o consumo dele não é medido e não entra na conta do teto diário.';
  };
  const gravar = async (lista = [principal.value, reserva.value].filter(Boolean)) => {
    if (lista.length === 2 && lista[0] === lista[1]) { msg.className = 'msg erro'; msg.textContent = 'A reserva precisa ser outra saída.'; return; }
    principal.disabled = reserva.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Gravando…';
    try {
      await api(`admin/fontes/${f.fonte}/saidas`, { method: 'PUT', body: { saidas: lista } });
      msg.className = 'msg ok';
      msg.textContent = 'Gravado. Vale a partir da próxima pesquisa.';
      setTimeout(() => recarregar().catch(() => {}), 1200);
    } catch (e) {
      msg.className = 'msg erro';
      msg.textContent = e.message;
      principal.disabled = reserva.disabled = false;
    }
  };
  principal.addEventListener('change', () => { avisar(); gravar(); });
  reserva.addEventListener('change', () => { avisar(); gravar(); });
  avisar();

  // Recomendação do site: saída e reserva, cada uma com o porquê, e o atalho para aplicar.
  const rec = f.recomendado || { saidas: [] };
  const segue = JSON.stringify(f.saidas) === JSON.stringify(rec.saidas);
  const usar = el('button', { type: 'button', class: 'btn pequeno' }, 'Usar o recomendado');
  usar.addEventListener('click', () => { usar.disabled = true; gravar(rec.saidas); });
  const itemRec = (rotulo, idSaida, motivo) => el('div', { class: 'adm-rec-item' },
    el('div', { class: 'adm-rec-linha' }, el('span', { class: 'adm-rec-rotulo' }, rotulo), el('strong', {}, idSaida ? (nomes[idSaida] || idSaida) : 'Nenhuma')),
    motivo ? el('p', {}, motivo) : null);
  const recomendacao = rec.saida ? el('div', { class: `adm-recomendado${segue ? ' segue' : ''}` },
    el('span', { class: 'adm-recomendado-selo' }, segue ? '✓ Segue o recomendado' : 'Recomendado'),
    itemRec('Saída', rec.saida.id, rec.saida.motivo),
    itemRec('Reserva', rec.reserva?.id, rec.reserva?.motivo),
    segue ? null : usar) : null;
  return el('div', { class: 'adm-saidas' },
    el('div', { class: 'adm-saidas-topo' }, el('span', { class: 'rotulo' }, 'Por onde pesquisa'),
      el('span', { class: 'nota' }, padrao ? 'padrão do site' : `padrão: ${f.saidas_padrao.map((x) => nomes[x] || x).join(' → ')}`)),
    el('label', { class: 'adm-saida' }, el('span', {}, 'Saída'), principal),
    el('label', { class: 'adm-saida' }, el('span', {}, 'Reserva'), reserva),
    el('p', { class: 'nota' }, 'A reserva é usada quando a saída falha na mesma pesquisa.'),
    recomendacao, aviso, msg);
}

// Detalhes abertos nos cartões de site (a lista é redesenhada a cada 10 s e não pode fechá-los).
const detalhesAbertos = new Set();
function detalhesLembrados(chave, resumo, ...conteudo) {
  const d = el('details', { class: 'adm-detalhes', 'data-chave': chave }, el('summary', {}, resumo), ...conteudo);
  d.open = detalhesAbertos.has(chave);
  d.addEventListener('toggle', () => { if (d.open) detalhesAbertos.add(chave); else detalhesAbertos.delete(chave); });
  return d;
}

// "POA-BSB-2026-12-17-escalas" → "POA → BSB · qui 17 dez · com escalas".
function textoTrecho(t) {
  const m = t.match(/^(\w{3})-(\w{3})-(\d{4}-\d{2}-\d{2})(-escalas)?$/);
  return m ? `${m[1]} → ${m[2]} · ${dataCompacta(m[3])}${m[4] ? ' · com escalas' : ''}` : t;
}

// Tentativas agrupadas: a mesma saída com o mesmo motivo em seguida vira uma linha com "(3×)".
function agruparTentativas(lista) {
  const out = [];
  for (const t of lista || []) {
    const ult = out[out.length - 1];
    if (ult && ult.saida === t.saida && ult.ok === t.ok && ult.motivo === t.motivo) ult.vezes += 1;
    else out.push({ ...t, vezes: 1 });
  }
  return out;
}

// Lista "✗ Direto do servidor — motivo" / "✓ Proxy datacenter — funcionou".
function listaTentativas(lista, nomes) {
  return el('ul', { class: 'adm-tentativas' }, ...agruparTentativas(lista).map((t) => el('li', { class: t.ok ? 'ok' : 'falha' },
    el('span', { class: 'adm-tent-icone', 'aria-hidden': 'true' }, t.ok ? '✓' : '✗'),
    el('span', {},
      el('strong', {}, nomes[t.saida] || t.saida), t.vezes > 1 ? ` (${t.vezes}×)` : '', ' — ',
      t.ok ? 'funcionou.' : t.motivo,
      t.deduzida ? el('span', { class: 'adm-deduzida' }, ' (saída deduzida do erro: registro anterior ao detalhamento)') : null))));
}

// Resumo das últimas 24 h por saída: quantas tentativas funcionaram, quantas falharam e por quê.
function resumoPorSaida(f, nomes) {
  const lista = [...(f.por_saida || [])].sort((a, b) => (b.ok + b.falhas) - (a.ok + a.falhas));
  if (!lista.length) return null;
  return el('div', { class: 'adm-por-saida' },
    el('p', { class: 'adm-hist-titulo' }, el('strong', {}, 'Por saída'), ' · últimas 24 h'),
    el('ul', {}, ...lista.map((s) => {
      const total = s.ok + s.falhas;
      const cls = s.falhas === 0 ? 'ok' : s.ok === 0 ? 'falha' : 'misto';
      return el('li', { class: cls },
        el('div', { class: 'adm-ps-linha' },
          el('strong', {}, nomes[s.saida] || s.saida),
          el('span', { class: 'adm-ps-conta' }, `${s.ok} ok · ${s.falhas} ${s.falhas === 1 ? 'falha' : 'falhas'}`)),
        el('div', { class: 'adm-ps-barra', 'aria-hidden': 'true' }, (() => { const b = el('span'); b.style.width = `${total ? (s.ok / total) * 100 : 0}%`; return b; })()),
        s.motivos.length ? el('ul', { class: 'adm-ps-motivos' }, ...s.motivos.map((m) => el('li', {}, `${m.n}× ${m.motivo}`))) : null);
    })));
}

// Bloco da última falha e de como veio o último sucesso, com o texto técnico recolhido.
function historicoFonte(f, nomes) {
  const partes = [];
  const falhaMaisNova = f.ultima_falha && (!f.ultimo_ok || f.ultima_falha > f.ultimo_ok);
  const okTent = f.ultimo_ok_tentativas || [];
  const okComFalhaAntes = okTent.some((t) => !t.ok);
  const bloco = (titulo, quando, trecho, corpo, tecnicos) => el('div', { class: `adm-hist ${titulo.classe}` },
    el('p', { class: 'adm-hist-titulo' }, el('strong', {}, titulo.texto), ` · ${dataHoraCurta(quando)}${trecho ? ` · ${textoTrecho(trecho)}` : ''}`),
    corpo,
    tecnicos.length ? (() => {
      const d = detalhesLembrados(`${f.fonte}:tecnico:${titulo.texto}`, 'Detalhe técnico', el('pre', {}, tecnicos.join('\n\n')));
      d.className = 'adm-tecnico';
      return d;
    })() : null);
  if (f.ultima_falha) {
    const tent = f.ultima_falha_tentativas || [];
    const corpo = tent.length ? listaTentativas(tent, nomes) : el('p', { class: 'adm-hist-motivo' }, f.ultimo_erro || 'Sem detalhe.');
    const tecnicos = [...new Set([...tent.filter((t) => t.tecnico).map((t) => `${nomes[t.saida] || t.saida}: ${t.tecnico}`), f.ultimo_erro_tecnico].filter(Boolean))];
    partes.push(bloco({ texto: 'Última falha', classe: falhaMaisNova ? 'falha' : 'antiga' }, f.ultima_falha, f.ultima_falha_trecho, corpo, tecnicos));
  }
  if (f.ultimo_ok && okTent.length) {
    const via = okTent.filter((t) => t.ok).pop();
    const corpo = okComFalhaAntes ? listaTentativas(okTent, nomes)
      : el('p', { class: 'adm-hist-motivo' }, `Funcionou ${via ? `por ${(nomes[via.saida] || via.saida).toLowerCase()}` : ''} na primeira tentativa.`);
    partes.push(bloco({ texto: okComFalhaAntes ? 'Último sucesso (pela reserva)' : 'Último sucesso', classe: 'sucesso' }, f.ultimo_ok, null, corpo, []));
  }
  return partes.length ? el('div', { class: 'adm-hists' }, ...(falhaMaisNova ? partes : partes.reverse())) : null;
}

function desenharFontesAdmin(caixa, lista, saidas, recarregar) {
  const nomes = Object.fromEntries(saidas.map((s) => [s.id, s.nome.replace(' (cobrado por GB)', '')]));
  caixa.replaceChildren(...lista.map((f) => {
    let estado = 'ok';
    let texto = 'Funcionando';
    if (!f.ligada) { estado = 'desligada'; texto = 'Desligada'; }
    else if (f.pausada_ate) { estado = 'falha'; texto = `Em pausa até ${hora(f.pausada_ate)} · ${f.falhas_seguidas} falhas seguidas`; }
    else if (f.sem_orcamento) { estado = 'falha'; texto = 'Parada: orçamento do proxy de hoje acabou'; }
    else if (f.ultima_falha && (!f.ultimo_ok || f.ultima_falha > f.ultimo_ok)) {
      estado = 'alerta';
      const falhas = [...new Set((f.ultima_falha_tentativas || []).filter((x) => !x.ok).map((x) => x.saida))];
      texto = falhas.length > 1 ? `Última pesquisa falhou nas ${falhas.length} saídas`
        : falhas.length ? `Última pesquisa falhou (${(nomes[falhas[0]] || falhas[0]).toLowerCase()})` : 'Última pesquisa falhou';
    }
    else if (!f.ultimo_ok) { estado = 'espera'; texto = 'Ainda sem pesquisa'; }
    if (f.ligada && f.pesquisando) texto += ` · ${f.pesquisando} pesquisando agora`;

    const chave = el('input', { type: 'checkbox', role: 'switch', 'aria-label': `${f.nome} ligado` });
    chave.checked = f.ligada;
    const msg = el('span', { class: 'msg', role: 'status' });
    chave.addEventListener('change', async () => {
      const ligar = chave.checked;
      chave.disabled = true;
      msg.className = 'msg';
      msg.textContent = ligar ? 'Ligando…' : 'Desligando…';
      try {
        await api(`admin/fontes/${f.fonte}`, { method: 'PUT', body: { ligada: ligar } });
        await recarregar();
      } catch (e) {
        chave.checked = !ligar;
        chave.disabled = false;
        msg.className = 'msg erro';
        msg.textContent = e.message;
      }
    });
    const taxa = f.n_24h ? Math.round((f.ok_24h / f.n_24h) * 100) : null;
    const linha = (rotulo, valor, cls) => el('div', {}, el('dt', {}, rotulo), el('dd', cls ? { class: cls } : {}, valor));
    // O mais recente entre sucesso e falha ganha cor: verde se foi sucesso, vermelho se foi falha.
    const okMaisNovo = f.ultimo_ok && (!f.ultima_falha || f.ultimo_ok > f.ultima_falha);
    const falhaMaisNova = f.ultima_falha && !okMaisNovo;
    return el('article', { class: `adm-fonte ${estado}` },
      el('header', { class: 'adm-fonte-topo' },
        el('div', {},
          el('h3', {}, f.nome),
          el('span', { class: 'chip' }, f.tipo === 'navegador' ? 'Navegador' : 'Direta')),
        el('label', { class: 'interruptor' }, chave, el('span', { class: 'interruptor-trilho', 'aria-hidden': 'true' }))),
      el('p', { class: 'adm-fonte-estado' }, el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }), texto),
      el('dl', { class: 'adm-fonte-dados' },
        linha('Últimas 24 h', f.n_24h ? `${f.ok_24h} de ${f.n_24h} com resposta (${taxa} %)` : 'nenhuma pesquisa'),
        linha('Tempo médio', f.ms_medio != null ? `${(f.ms_medio / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '—'),
        linha('Último sucesso', dataHoraCurta(f.ultimo_ok), okMaisNovo ? 'data-verde' : null),
        linha('Última falha', dataHoraCurta(f.ultima_falha), falhaMaisNova ? 'data-vermelha' : null),
        f.mb_24h ? linha('Tráfego no navegador (24 h)', `${f.mb_24h.toLocaleString('pt-BR')} MB`) : null,
        f.mb_pago_24h ? linha('Proxy residencial (24 h)', `${f.mb_pago_24h.toLocaleString('pt-BR')} MB`) : null),
      (f.por_saida?.length || f.ultimo_ok || f.ultima_falha)
        ? detalhesLembrados(`${f.fonte}:pesquisas`, 'Detalhes das pesquisas', resumoPorSaida(f, nomes), historicoFonte(f, nomes))
        : null,
      escolhaSaidas(f, saidas, recarregar),
      msg);
  }));
}

// Tabela que vira cartões no celular (cada célula leva o nome da coluna em data-rotulo).
// links[i]: endereço aberto ao clicar na linha i (opcional).
function tabelaAdmin(colunas, linhas, vazio, links = []) {
  if (!linhas.length) return el('p', { class: 'vazio' }, vazio);
  return el('div', { class: 'tabela-rolagem' }, el('table', { class: 'adm-tabela' },
    el('thead', {}, el('tr', {}, ...colunas.map((c) => el('th', { class: c.num ? 'num' : null }, c.nome)))),
    el('tbody', {}, ...linhas.map((l, k) => {
      const tr = el('tr', links[k] ? { class: 'clicavel', tabindex: '0', role: 'link', 'aria-label': 'Ver detalhes do alerta' } : {},
        ...colunas.map((c, i) => el('td', { 'data-rotulo': c.nome, class: c.num ? 'num' : null }, l[i])));
      if (links[k]) {
        tr.addEventListener('click', (ev) => { if (!ev.target.closest('a, button')) ir(links[k]); });
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ir(links[k]); });
      }
      return tr;
    }))));
}

function desenharAlertasAdmin(caixa, alertas) {
  caixa.replaceChildren(tabelaAdmin(
    [{ nome: 'Usuário' }, { nome: 'Rota' }, { nome: 'Datas' }, { nome: 'Regra' }, { nome: 'Última consulta' }, { nome: 'Total', num: true }],
    alertas.map((x) => {
      const a = x.alerta;
      const cmp = comparacao(x.ultima, x.media, x.sem_voos);
      return [
        x.usuario || '—',
        el('span', { class: 'adm-rota' }, el('strong', {}, titulo(a)), el('small', {}, `${cidades(a)}${a.nome ? ` · ${a.nome}` : ''}`)),
        datasTexto(a),
        `${a.so_diretos === false ? 'Com escalas' : 'Só diretos'} · ${Math.round(a.desconto_min * 100)} % · a cada ${rotuloIntervalo(a.intervalo_min)}`,
        x.ultima ? dataHora(x.ultima.ts) : 'ainda não',
        el('span', { class: 'adm-total' }, el('strong', {}, x.ultima ? brl(x.ultima.total) : '—'), x.ultima || x.sem_voos ? el('span', { class: `variacao ${cmp.classe}` }, cmp.texto) : null),
      ];
    }),
    'Nenhum alerta ligado.',
    alertas.map((x) => `/admin/alertas/${x.alerta.id}`)));
}

function desenharUsuariosAdmin(caixa, usuarios) {
  caixa.replaceChildren(tabelaAdmin(
    [{ nome: 'Nome' }, { nome: 'Celular' }, { nome: 'Conta criada' }, { nome: 'Alertas', num: true }, { nome: 'Sessões', num: true }, { nome: 'Último login' }],
    usuarios.map((x) => [
      el('span', { class: 'adm-nome' }, x.nome,
        x.admin ? el('span', { class: 'chip chip-admin' }, 'admin') : null,
        x.verificado ? null : el('span', { class: 'chip chip-pendente' }, 'cadastro pendente')),
      x.telefone,
      new Date(x.criado_em).toLocaleDateString('pt-BR'),
      `${x.alertas_ligados} ligados de ${x.alertas}`,
      String(x.sessoes),
      x.ultimo_login ? dataHora(x.ultimo_login) : '—',
    ]),
    'Nenhum usuário.'));
}

const duracao = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function desenharOperacao(painel, e) {
  const ag = e.agendador || {};
  const numero = (rotulo, valor, detalhe) => el('div', { class: 'op-numero' }, el('span', { class: 'rotulo' }, rotulo), el('strong', {}, valor), detalhe ? el('span', { class: 'detalhe' }, detalhe) : null);
  const barra = (rotulo, usado, total, texto, alerta) => {
    const pctUso = total ? Math.min(100, (usado / total) * 100) : 0;
    const trilho = el('div', { class: 'op-trilho', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(usado), 'aria-label': rotulo });
    const cheio = el('span', { class: `op-cheio${alerta ? ' alerta' : ''}` });
    cheio.style.width = `${pctUso}%`;
    trilho.append(cheio);
    return el('div', { class: 'op-barra' }, el('div', { class: 'op-barra-topo' }, el('span', {}, rotulo), el('strong', {}, texto)), trilho);
  };
  const vaga = (rotulo, v = {}) => barra(rotulo, v.rodando || 0, v.vagas || 0,
    `${v.rodando || 0} de ${v.vagas || 0}${v.esperando ? ` · ${v.esperando} na fila` : ''}`, v.esperando > 0);
  const mb = ag.proxy_residencial_mb_hoje || 0;
  const teto = ag.proxy_residencial_mb_teto || 0;
  const nomeFonte = (id) => fontes[id] || id;

  const sites = el('ul', { class: 'fontes' });
  for (const f of ag.fontes_pausadas || []) {
    sites.append(el('li', { class: 'fonte falha' }, el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }),
      el('span', { class: 'fonte-nome' }, nomeFonte(f.fonte), el('small', {}, `${f.seguidas} falhas seguidas`)),
      el('span', { class: 'fonte-preco' }, `volta às ${hora(f.ate)}`)));
  }
  for (const f of ag.fontes_desligadas || []) {
    sites.append(el('li', { class: 'fonte espera' }, el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }),
      el('span', { class: 'fonte-nome' }, nomeFonte(f), el('small', {}, 'desligado na configuração')),
      el('span', { class: 'fonte-preco' }, 'desligado')));
  }
  if (!sites.children.length) {
    sites.append(el('li', { class: 'fonte ok' }, el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }),
      el('span', { class: 'fonte-nome' }, 'Todos os sites ligados', el('small', {}, 'nenhum em pausa por falha')), el('span')));
  }

  painel.replaceChildren(
    el('div', { class: 'painel-topo' },
      el('div', {}, el('h2', { id: 'op-titulo' }, 'Operação'), el('p', { class: 'nota' }, 'Atualiza a cada 10 segundos.')),
      el('span', { class: 'chip' }, icone('relogio'), `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`)),
    el('div', { class: 'op-numeros' },
      numero('Usuários', String(e.usuarios ?? '—'), 'com WhatsApp confirmado'),
      numero('Alertas ativos', String(e.alertas_ativos ?? '—'), `de ${e.alertas ?? '—'} no total`),
      numero('Pesquisas feitas', String(ag.pesquisas_feitas ?? '—'), `${ag.em_curso || 0} em andamento`),
      numero('No ar há', ag.no_ar_ha_s != null ? duracao(ag.no_ar_ha_s) : '—', `${ag.resultados_em_memoria ?? 0} resultados em memória`)),
    el('div', { class: 'op-barras' },
      barra('Proxy residencial hoje', mb, teto, `${mb.toLocaleString('pt-BR')} de ${teto.toLocaleString('pt-BR')} MB`, teto && mb >= teto * 0.8),
      vaga('Pesquisas com navegador', ag.navegador),
      vaga('Pesquisas diretas', ag.http)),
    el('div', {}, el('p', { class: 'fontes-titulo' }, 'Sites fora do ar ou desligados'), sites));
}

// --- Empregos -----------------------------------------------------------------------------------
// Busca = o que coletar (profissão, termos, cidades). Resultados = busca detalhada, com filtros
// aplicados no servidor e guardados no endereço. Alerta = critérios do aviso no WhatsApp, à parte.

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const MODELOS = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' };
const CONTRATOS = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', temporario: 'Temporário' };
const LIMITE_BUSCAS = 3;
const listaDe = (x) => (Array.isArray(x) ? x : []);
const numeroOu = (v, padrao = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : padrao);
const nomeFonteEmp = (f) => (!f ? '—' : String(f).length <= 3 ? String(f).toUpperCase() : String(f)[0].toUpperCase() + String(f).slice(1));

// Data ISO, milissegundos ou {em}: devolve milissegundos ou null.
function instante(v) {
  if (v && typeof v === 'object') v = v.em ?? v.ts ?? v.$date ?? null;
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function relativo(v) {
  const t = instante(v);
  if (t == null) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function publicadaHa(iso) {
  const t = instante(iso);
  if (t == null) return null;
  const dia = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(t - 3 * 3600e3).toISOString().slice(0, 10);
  const d = noitesEntre(dia, hojeISO());
  return d <= 0 ? 'publicada hoje' : d === 1 ? 'publicada ontem' : `publicada há ${d} dias`;
}

// "R$ 4.500", "4500", "4.500,00" → 4500 (centavos ignorados).
function valorMoeda(txt) {
  const d = String(txt || '').split(',')[0].replace(/\D/g, '');
  return d ? Number(d) : null;
}
// Campo de valor em reais: aceita só números ao digitar e mostra formatado ao sair.
function campoMoeda(entrada, valor) {
  entrada.value = numeroOu(valor, 0) > 0 ? brl(Number(valor)) : '';
  entrada.addEventListener('blur', () => { const v = valorMoeda(entrada.value); entrada.value = v ? brl(v) : ''; });
}

function textoSalario(v) {
  const a = v.salario_min != null ? Number(v.salario_min) : null;
  const b = v.salario_max != null ? Number(v.salario_max) : null;
  if (v.salario_informado === false || (a == null && b == null)) return null;
  if (a != null && b != null && Math.round(a) !== Math.round(b)) return `${brl(a)} a ${brl(b)} por mês`;
  return `${brl(a ?? b)} por mês`;
}

const textoCidades = (b) => {
  if (b.abrangencia === 'brasil') return 'Brasil inteiro · presencial e remoto';
  const c = listaDe(b.cidades).map((x) => (x.uf ? `${x.cidade}/${x.uf}` : x.cidade)).filter(Boolean).join(' · ');
  return `${c || 'Sem cidade'}${b.aceita_remoto ? ' · remoto de qualquer lugar' : ''}`;
};

// Lista do servidor: { buscas, limite, restantes } ou só a lista.
function lerBuscas(r) {
  const buscas = Array.isArray(r) ? r : listaDe(r?.buscas || r?.itens);
  const limite = Number.isFinite(r?.limite) ? r.limite : LIMITE_BUSCAS;
  const restantes = Number.isFinite(r?.restantes) ? r.restantes : Math.max(0, limite - buscas.length);
  return { buscas, limite, restantes };
}
async function buscaPorId(id) {
  const { buscas } = lerBuscas(await api('empregos/buscas'));
  return buscas.find((b) => String(b.id) === id) || null;
}

// Corpo da busca para PUT: só o escopo da coleta (o alerta tem rota própria).
const corpoBusca = (b) => ({
  profissao: b.profissao || '',
  termos: listaDe(b.termos),
  abrangencia: b.abrangencia === 'brasil' ? 'brasil' : 'cidades',
  cidades: b.abrangencia === 'brasil' ? [] : listaDe(b.cidades).map((c) => ({ cidade: c.cidade, uf: c.uf })),
  aceita_remoto: b.abrangencia === 'brasil' ? true : !!b.aceita_remoto,
  concursos: !!b.concursos,
  ativa: b.ativa !== false,
});
const buscaDaResposta = (r) => r?.busca || (r && r.id != null ? r : null);
const alertaLigado = (b) => !!b?.alerta?.ligado;

// Mensagem curta ao lado de um botão; as de sucesso somem sozinhas.
function avisar(msg, texto, classe = '') {
  msg.className = `msg${classe ? ` ${classe}` : ''}`;
  msg.textContent = texto;
  clearTimeout(msg.timer);
  if (classe === 'ok') msg.timer = setTimeout(() => { msg.textContent = ''; }, 8000);
}

// "Buscar agora": uma rodada fora de hora; o servidor libera uma a cada 10 min por busca.
async function pedirColeta(caminho, botao, msg) {
  botao.disabled = true;
  botao.classList.add('girando');
  avisar(msg, 'Pedindo a busca…');
  try {
    await api(caminho, { method: 'POST', body: {} });
    avisar(msg, 'Busca pedida. As vagas novas aparecem em alguns minutos.', 'ok');
  } catch (e) {
    avisar(msg, e.status === 429 ? 'Houve uma busca há pouco: aguarde 10 min para buscar de novo.' : e.message, 'erro');
  } finally {
    botao.classList.remove('girando');
    setTimeout(() => { botao.disabled = false; }, 3000);
  }
}

function contadoresBusca(b) {
  const c = b.contadores || {};
  const novos = numeroOu(c.novos);
  return el('p', { class: 'emp-contadores' },
    el('strong', { class: novos ? 'tem' : null }, `${novos} ${novos === 1 ? 'novo' : 'novos'}`),
    el('span', {}, `${numeroOu(c.total)} no total`),
    el('span', {}, `${numeroOu(c.favoritos)} ${numeroOu(c.favoritos) === 1 ? 'favorito' : 'favoritos'}`));
}

function ultimaColeta(b) {
  const uc = b.ultima_coleta;
  const t = instante(uc);
  const p = el('p', { class: 'emp-coleta' }, icone('relogio'),
    el('span', t ? { title: dataHora(t) } : {}, t ? `Última coleta ${relativo(t)}` : 'Ainda sem coleta: a primeira sai em poucos minutos'));
  const erro = uc && (uc.ok === false || uc.erro) ? (uc.erro || 'falhou') : null;
  return erro ? el('div', { class: 'emp-coleta-caixa' }, p, el('p', { class: 'emp-coleta-erro' }, `Falha na última coleta: ${erro}`)) : p;
}

function termosBusca(b) {
  const termos = listaDe(b.termos);
  if (!termos.length) return document.createDocumentFragment(); // vai direto em append()
  return el('ul', { class: 'emp-termos', 'aria-label': 'Termos no título' }, ...termos.map((x) => el('li', {}, x)));
}

// Selo do alerta com atalho para a tela de alerta.
function seloAlerta(b) {
  const ligado = alertaLigado(b);
  return el('a', { class: `emp-selo-alerta${ligado ? ' ligado' : ''}`, href: `/empregos/${encodeURIComponent(b.id)}/alerta`, title: 'Editar o alerta no WhatsApp' },
    icone('sino'), ligado ? 'Alerta ligado' : 'Alerta desligado', el('span', { class: 'emp-selo-editar' }, 'editar'));
}

function cartaoBusca(b) {
  const msg = el('span', { class: 'msg', role: 'status' });
  const card = el('article', { class: `emp-cartao${b.ativa === false ? ' pausada' : ''}` });
  const estado = el('span', { class: 'emp-estado' });
  const marcarEstado = () => {
    card.classList.toggle('pausada', b.ativa === false);
    estado.textContent = b.ativa === false ? 'Pausada' : 'Ligada';
  };
  const chave = el('input', { type: 'checkbox', role: 'switch' });
  chave.checked = b.ativa !== false;
  chave.addEventListener('change', async () => {
    const valor = chave.checked;
    chave.disabled = true;
    avisar(msg, 'Gravando…');
    try {
      const r = await api(`empregos/buscas/${encodeURIComponent(b.id)}`, { method: 'PUT', body: { ...corpoBusca(b), ativa: valor } });
      Object.assign(b, buscaDaResposta(r) || { ativa: valor });
      marcarEstado();
      avisar(msg, valor ? 'Busca ligada.' : 'Busca pausada: sem coletas até religar.', 'ok');
    } catch (e) {
      chave.checked = !valor;
      avisar(msg, e.message, 'erro');
    } finally { chave.disabled = false; }
  });
  const buscar = el('button', { type: 'button', class: 'btn' }, icone('lupa'), 'Buscar agora');
  buscar.addEventListener('click', () => pedirColeta(`empregos/buscas/${encodeURIComponent(b.id)}/coletar`, buscar, msg));
  marcarEstado();
  card.append(
    el('header', { class: 'emp-cartao-topo' },
      el('span', { class: 'emp-cartao-icone', 'aria-hidden': 'true' }, icone('maleta', '')),
      el('div', { class: 'emp-cartao-titulo' },
        el('h2', {}, b.profissao || 'Busca sem profissão'),
        el('p', { class: 'emp-local' }, textoCidades(b))),
      estado),
    termosBusca(b),
    contadoresBusca(b),
    ultimaColeta(b),
    el('div', { class: 'emp-chaves' },
      el('label', { class: 'interruptor emp-interruptor' }, chave, el('span', { class: 'interruptor-trilho', 'aria-hidden': 'true' }), el('span', {}, 'Coleta ligada')),
      seloAlerta(b)),
    el('div', { class: 'emp-acoes' },
      el('a', { class: 'btn primario', href: `/empregos/${encodeURIComponent(b.id)}` }, 'Ver resultados'),
      buscar,
      el('a', { class: 'btn fantasma', href: `/empregos/${encodeURIComponent(b.id)}/editar` }, 'Editar')),
    msg);
  return card;
}

async function telaEmpregos() {
  const t = montar('t-empregos');
  const caixa = $('[data-lista]', t);
  const carregar = async () => {
    const { buscas, limite, restantes } = lerBuscas(await api('empregos/buscas'));
    $('[data-limite]', t).textContent = `${buscas.length} de ${limite} ${limite === 1 ? 'busca' : 'buscas'}`;
    const lugar = $('[data-nova-lugar]', t);
    const aviso = $('[data-aviso-limite]', t);
    if (restantes > 0) {
      lugar.replaceChildren(el('a', { class: 'btn primario', href: '/empregos/nova' }, icone('mais'), 'Nova busca'));
      aviso.hidden = true;
    } else {
      lugar.replaceChildren(el('button', { type: 'button', class: 'btn primario', disabled: '', 'aria-describedby': 'emp-aviso-limite' }, icone('mais'), 'Nova busca'));
      aviso.id = 'emp-aviso-limite';
      aviso.textContent = `Limite de ${limite} ${limite === 1 ? 'busca' : 'buscas'} atingido. Para criar outra, apague uma das buscas em Editar.`;
      aviso.hidden = false;
    }
    if (!buscas.length) {
      caixa.replaceChildren(el('div', { class: 'vazio-grande emp-vazio' },
        el('span', { class: 'vazio-icone emp-vazio-icone' }, icone('maleta', '')),
        el('h2', {}, 'Nenhuma busca de emprego ainda'),
        el('p', { class: 'nota' }, 'Uma busca guarda a profissão e as cidades. Sites de vagas e de concursos são consultados várias vezes ao dia; os resultados aparecem aqui com filtros de modelo, contrato e salário, e o alerta no WhatsApp é opcional.'),
        el('a', { class: 'btn primario grande', href: '/empregos/nova' }, icone('mais'), 'Criar a primeira busca')));
      return;
    }
    caixa.replaceChildren(...buscas.map(cartaoBusca));
    if (restantes > 0) {
      caixa.append(el('a', { class: 'cartao-novo', href: '/empregos/nova' }, icone('mais', 'cartao-novo-icone'), el('strong', {}, 'Nova busca'),
        el('span', {}, `Outra profissão ou outras cidades · ${restantes} ${restantes === 1 ? 'restante' : 'restantes'}`)));
    }
  };
  try { await carregar(); } catch (e) {
    caixa.replaceChildren(el('p', { class: 'nota erro' }, e.message));
  }
  // Recarrega a cada minuto, mas não por cima de uma mensagem na tela.
  atualizar = setInterval(() => {
    if ($$('.emp-cartao .msg', t).some((m) => m.textContent)) return;
    carregar().catch(() => {});
  }, 60e3);
}

// Lista de etiquetas editável (termos e palavras a excluir): Enter ou vírgula acrescenta, × tira.
let idChips = 0;
function campoChips(caixa, { rotuloId, placeholder, max = 20, aoMudar }) {
  const n = ++idChips;
  let valores = [];
  const lista = el('ul', { class: 'emp-chips-lista', 'aria-labelledby': rotuloId });
  const entrada = el('input', { type: 'text', id: `emp-chips-${n}`, class: 'emp-chips-entrada', placeholder, 'aria-labelledby': rotuloId, autocomplete: 'off', maxlength: '40', enterkeyhint: 'enter' });
  const botao = el('button', { type: 'button', class: 'btn pequeno' }, icone('mais'), 'Acrescentar');
  const igual = (x, y) => semAcento(x) === semAcento(y);
  const desenhar = () => {
    lista.replaceChildren(...valores.map((v, i) => {
      const tirar = el('button', { type: 'button', class: 'emp-chip-tirar', 'aria-label': `Tirar ${v}`, title: 'Tirar' }, icone('fechar', ''));
      tirar.addEventListener('click', () => {
        valores.splice(i, 1);
        desenhar();
        if (aoMudar) aoMudar();
        entrada.focus();
      });
      return el('li', { class: 'emp-chip' }, el('span', {}, v), tirar);
    }));
    lista.hidden = !valores.length;
    entrada.disabled = botao.disabled = valores.length >= max;
  };
  const incluir = (txt, avisa = true) => {
    let mudou = false;
    for (const parte of String(txt).split(',')) {
      const v = parte.trim().replace(/\s+/g, ' ');
      if (v && valores.length < max && !valores.some((x) => igual(x, v))) { valores.push(v); mudou = true; }
    }
    if (mudou) { desenhar(); if (avisa && aoMudar) aoMudar(); }
  };
  const confirmar = () => { if (entrada.value.trim()) { incluir(entrada.value); entrada.value = ''; } };
  entrada.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
    else if (ev.key === 'Backspace' && !entrada.value && valores.length) {
      valores.pop();
      desenhar();
      if (aoMudar) aoMudar();
    }
  });
  entrada.addEventListener('input', () => {
    if (!entrada.value.includes(',')) return;
    const partes = entrada.value.split(',');
    entrada.value = partes.pop();
    incluir(partes.join(','));
  });
  entrada.addEventListener('blur', confirmar);
  botao.addEventListener('click', () => { confirmar(); entrada.focus(); });
  caixa.replaceChildren(el('div', { class: 'emp-chips' }, lista, el('div', { class: 'emp-chips-linha' }, entrada, botao)));
  desenhar();
  return {
    get valores() { return [...valores]; },
    definir(vs) { valores = []; incluir(listaDe(vs).join(','), false); desenhar(); },
    focar: () => entrada.focus(),
  };
}

// Pílulas de múltipla escolha (checkbox): opcoes = [[valor, rótulo, contagem?]].
// Modelo e contrato levam a classe do badge (emp-b-presencial…) para filtro e cartão terem a mesma cor.
function pilulasMulti(caixa, nome, opcoes, marcados) {
  const sel = new Set(listaDe(marcados));
  const comBadge = nome === 'modelo' || nome === 'contrato';
  caixa.replaceChildren(...opcoes.map(([valor, rotulo, n]) => el('label', comBadge ? { class: `emp-b-${valor}` } : {},
    Object.assign(el('input', { type: 'checkbox', name: nome, value: valor }), { checked: sel.has(valor) }),
    el('span', {}, nome === 'modelo' && ICONE_MODELO[valor] ? icone(ICONE_MODELO[valor]) : null, rotulo, n != null ? el('span', { class: 'emp-conta' }, String(n)) : null))));
}
const marcadosEm = (caixa) => $$('input:checked', caixa).map((x) => x.value);

function telaErroEmp(texto, voltar = '/empregos') {
  $('#tela').replaceChildren(el('section', { class: 'conteudo' }, el('p', { class: 'nota erro' }, texto), el('a', { href: voltar }, '← Minhas buscas')));
}

let idCidade = 0;

async function telaEmpForm(id) {
  const t = montar('t-emp-form');
  const f = $('form', t);
  const msg = $('[data-msg]', f);
  let busca = null;
  if (id) {
    try { busca = await buscaPorId(id); } catch (e) { telaErroEmp(e.message); return; }
    if (!busca) { telaErroEmp('Busca não encontrada.'); return; }
    $('[data-titulo]', t).textContent = 'Editar busca';
    $('[data-salvar]', f).textContent = 'Salvar alterações';
    const voltar = $('[data-voltar]', t);
    voltar.href = `/empregos/${encodeURIComponent(id)}`;
    voltar.replaceChildren(icone('seta'), 'Resultados da busca');
    $('[data-cancelar]', f).href = `/empregos/${encodeURIComponent(id)}`;
    $('[data-apagar-lugar]', t).hidden = false;
    document.title = `${busca.profissao || 'Busca'} · Buscador de Empregos`;
  }

  // Termos: os sugeridos pelo servidor trocam de lista quando a profissão muda; os escritos à mão ficam.
  const dicaTermos = $('[data-termos-dica]', f);
  const dicaPadrao = dicaTermos.textContent;
  let sugeridos = new Set();
  const termos = campoChips($('[data-chips="termos"]', f), { rotuloId: 'emp-termos-rotulo', placeholder: 'Ex.: fono' });
  let pedidoSugestao = 0;
  f.profissao.addEventListener('change', async () => {
    const profissao = f.profissao.value.trim();
    if (!profissao) return;
    f.profissao.removeAttribute('aria-invalid');
    const meu = ++pedidoSugestao;
    dicaTermos.textContent = 'Sugerindo termos…';
    try {
      const r = await api('empregos/sugerir-termos', { method: 'POST', body: { profissao } });
      if (meu !== pedidoSugestao) return;
      const novos = listaDe(Array.isArray(r) ? r : r?.termos).map(String);
      const manuais = termos.valores.filter((v) => !sugeridos.has(semAcento(v)));
      termos.definir([...manuais, ...novos]);
      sugeridos = new Set(novos.map(semAcento));
      dicaTermos.textContent = dicaPadrao;
    } catch (e) {
      if (meu === pedidoSugestao) dicaTermos.textContent = `Não foi possível sugerir termos (${e.message}). Escreva os termos à mão.`;
    }
  });

  // Cidades: de 1 a 3, cada uma com UF.
  const caixaCidades = $('[data-cidades]', f);
  const maisCidade = $('[data-mais-cidade]', f);
  const erroCidades = $('[data-erro-cidades]', f);
  const linhas = () => $$('.emp-cidade', caixaCidades);
  const acertarCidades = () => {
    const n = linhas().length;
    maisCidade.disabled = n >= 3;
    for (const b of $$('[data-tirar-cidade]', caixaCidades)) b.hidden = n <= 1;
    $('[data-cidades-nota]', f).textContent = n >= 3 ? 'Limite de 3 cidades.' : `Até 3 cidades (${n} de 3).`;
  };
  const linhaCidade = (c = {}) => {
    const k = ++idCidade;
    const cidade = el('input', { type: 'text', name: 'cidade', id: `emp-cidade-${k}`, maxlength: '60', placeholder: 'Ex.: Porto Alegre', autocomplete: 'off' });
    cidade.value = c.cidade || '';
    const uf = el('select', { name: 'uf', id: `emp-uf-${k}` }, el('option', { value: '' }, 'UF'), ...UFS.map((u) => el('option', { value: u }, u)));
    uf.value = UFS.includes(c.uf) ? c.uf : '';
    const tirar = el('button', { type: 'button', class: 'icone-btn', 'data-tirar-cidade': '', 'aria-label': 'Tirar esta cidade', title: 'Tirar esta cidade' }, icone('fechar', ''));
    const linha = el('div', { class: 'emp-cidade' },
      el('label', { class: 'emp-cidade-nome', for: cidade.id }, el('span', { class: 'rotulo' }, 'Cidade'), cidade),
      el('label', { class: 'emp-cidade-uf', for: uf.id }, el('span', { class: 'rotulo' }, 'UF'), uf),
      tirar);
    tirar.addEventListener('click', () => { linha.remove(); acertarCidades(); $('input', caixaCidades)?.focus(); });
    for (const x of [cidade, uf]) x.addEventListener('input', () => { x.removeAttribute('aria-invalid'); erroCidades.textContent = ''; });
    caixaCidades.append(linha);
    acertarCidades();
    return cidade;
  };
  maisCidade.addEventListener('click', () => linhaCidade().focus());

  // Onde procurar: Brasil inteiro esconde cidades e "remotas" (no Brasil inteiro, remoto já entra).
  const brasil = () => f.abrangencia.value === 'brasil';
  const mostrarOnde = () => {
    $('[data-onde-cidades]', f).hidden = brasil();
    erroCidades.textContent = '';
  };
  for (const r of $$('input[name="abrangencia"]', f)) r.addEventListener('change', mostrarOnde);

  if (busca) {
    f.profissao.value = busca.profissao || '';
    termos.definir(busca.termos);
    const cs = listaDe(busca.cidades);
    if (cs.length) cs.slice(0, 3).forEach((c) => linhaCidade(c)); else linhaCidade();
    f.abrangencia.value = busca.abrangencia === 'brasil' ? 'brasil' : 'cidades';
    f.aceita_remoto.checked = !!busca.aceita_remoto;
    f.concursos.checked = !!busca.concursos;
    f.ativa.checked = busca.ativa !== false;
  } else {
    linhaCidade();
    f.profissao.focus();
  }
  mostrarOnde();

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    avisar(msg, '');
    erroCidades.textContent = '';
    const profissao = f.profissao.value.trim();
    if (!profissao) { f.profissao.setAttribute('aria-invalid', 'true'); f.profissao.focus(); return avisar(msg, 'Informe a profissão ou o cargo.', 'erro'); }
    if (!termos.valores.length) { termos.focar(); return avisar(msg, 'Acrescente pelo menos um termo para o título da vaga.', 'erro'); }
    const cidades = [];
    for (const l of brasil() ? [] : linhas()) {
      const c = $('input', l);
      const u = $('select', l);
      const nome = c.value.trim();
      if (!nome && !u.value) continue;
      if (!nome || !u.value) {
        const campo = nome ? u : c;
        campo.setAttribute('aria-invalid', 'true');
        campo.focus();
        erroCidades.textContent = 'Cada cidade precisa do nome e da UF.';
        return avisar(msg, 'Confira as cidades.', 'erro');
      }
      cidades.push({ cidade: nome, uf: u.value });
    }
    if (!brasil() && !cidades.length) {
      const c = $('input', caixaCidades);
      if (c) { c.setAttribute('aria-invalid', 'true'); c.focus(); }
      erroCidades.textContent = 'Informe pelo menos uma cidade com a UF.';
      return avisar(msg, 'Confira as cidades.', 'erro');
    }
    const body = {
      profissao,
      termos: termos.valores,
      abrangencia: brasil() ? 'brasil' : 'cidades',
      cidades,
      aceita_remoto: brasil() ? true : f.aceita_remoto.checked,
      concursos: f.concursos.checked,
      ativa: f.ativa.checked,
    };
    avisar(msg, 'Salvando…');
    enviar(f, async () => {
      const r = busca
        ? await api(`empregos/buscas/${encodeURIComponent(busca.id)}`, { method: 'PUT', body })
        : await api('empregos/buscas', { method: 'POST', body });
      const salva = buscaDaResposta(r);
      avisar(msg, 'Salvo.', 'ok');
      const alvo = salva?.id ?? busca?.id;
      ir(alvo != null ? `/empregos/${encodeURIComponent(alvo)}` : '/empregos');
    });
  });

  $('[data-apagar]', t).addEventListener('click', async (ev) => {
    if (!busca || !confirm('Apagar esta busca, o alerta e a lista de vagas encontradas para ela?')) return;
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await api(`empregos/buscas/${encodeURIComponent(busca.id)}`, { method: 'DELETE' });
      ir('/empregos');
    } catch (e) { b.disabled = false; alert(e.message); }
  });
}

// Hora "08", "08:00" ou 8 → 8; fora de 0–23 → padrão.
const horaDe = (v, padrao) => { const h = parseInt(String(v ?? ''), 10); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : padrao; };

async function telaEmpAlerta(id) {
  const t = montar('t-emp-alerta');
  const f = $('form', t);
  const msg = $('[data-msg]', f);
  const testar = $('[data-testar]', f);
  const dicaTestar = $('[data-testar-dica]', f);
  const voltar = $('[data-voltar]', t);
  voltar.href = `/empregos/${encodeURIComponent(id)}`;
  let busca = null;
  let alerta = null;
  let fontesConhecidas = [];
  try {
    const [b, a, ach] = await Promise.all([
      buscaPorId(id),
      api(`empregos/buscas/${encodeURIComponent(id)}/alerta`).catch((e) => ({ erro_tela: e })),
      api(`empregos/buscas/${encodeURIComponent(id)}/achados?filtro=todos&pagina=1`).catch(() => null),
    ]);
    busca = b;
    if (!busca) { telaErroEmp('Busca não encontrada.'); return; }
    alerta = a?.erro_tela ? busca.alerta || null : a?.alerta || a;
    if (a?.erro_tela && !alerta) { telaErroEmp(a.erro_tela.message, `/empregos/${encodeURIComponent(id)}`); return; }
    fontesConhecidas = listaDe(a?.fontes_disponiveis).length ? a.fontes_disponiveis : Object.keys(ach?.facetas?.por_fonte || {});
  } catch (e) { telaErroEmp(e.message); return; }
  alerta = alerta || {};
  $('[data-titulo]', t).textContent = `Alerta: ${busca.profissao || 'busca'}`;
  document.title = `Alerta · ${busca.profissao || 'Busca'} · Buscador de Empregos`;

  pilulasMulti($('[data-multi="modelo"]', f), 'modelo', Object.entries(MODELOS), alerta.modelo);
  pilulasMulti($('[data-multi="contrato"]', f), 'contrato', Object.entries(CONTRATOS), alerta.contrato);
  const fontes = [...new Set([...fontesConhecidas, ...listaDe(alerta.fontes)])];
  $('[data-fontes-grupo]', f).hidden = !fontes.length;
  pilulasMulti($('[data-multi="fontes"]', f), 'fontes', fontes.map((x) => [x, nomeFonteEmp(x)]), alerta.fontes);
  campoMoeda(f.salario_minimo, alerta.salario_minimo);
  f.incluir_sem_salario.checked = alerta.incluir_sem_salario !== false;
  f.concursos.checked = !!alerta.concursos;
  f.ligado.checked = !!alerta.ligado;
  const excluir = campoChips($('[data-chips="excluir"]', f), { rotuloId: 'emp-excluir-rotulo', placeholder: 'Ex.: coordenador', aoMudar: () => mudou() });
  excluir.definir(alerta.excluir);
  for (const sel of $$('[data-hora]', f)) sel.replaceChildren(...Array.from({ length: 24 }, (_, h) => el('option', { value: String(h) }, `${String(h).padStart(2, '0')}:00`)));
  f.horario_ini.value = String(horaDe(alerta.horario_ini, 8));
  f.horario_fim.value = String(horaDe(alerta.horario_fim, 21));

  const estado = () => {
    $('[data-estado-alerta]', f).textContent = f.ligado.checked
      ? 'Vagas novas que atendem aos critérios abaixo chegam no WhatsApp do celular da conta.'
      : 'Desligado: nada é enviado. Os resultados continuam sendo coletados e aparecem na página da busca.';
  };
  // Teste usa o que está salvo: com alteração pendente, pede para salvar antes.
  let pendente = false;
  const mudou = () => {
    pendente = true;
    testar.disabled = true;
    dicaTestar.textContent = 'Há alterações não salvas: salve para testar com os critérios novos.';
    estado();
  };
  f.addEventListener('input', mudou);
  f.addEventListener('change', mudou);
  estado();

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ini = Number(f.horario_ini.value);
    const fim = Number(f.horario_fim.value);
    if (fim <= ini) { f.horario_fim.focus(); return avisar(msg, 'O fim do horário precisa ser depois do início.', 'erro'); }
    const body = {
      ligado: f.ligado.checked,
      modelo: marcadosEm($('[data-multi="modelo"]', f)),
      contrato: marcadosEm($('[data-multi="contrato"]', f)),
      salario_minimo: valorMoeda(f.salario_minimo.value) || null,
      incluir_sem_salario: f.incluir_sem_salario.checked,
      excluir: excluir.valores,
      fontes: marcadosEm($('[data-multi="fontes"]', f)),
      concursos: f.concursos.checked,
      horario_ini: ini,
      horario_fim: fim,
    };
    avisar(msg, 'Salvando…');
    enviar(f, async () => {
      await api(`empregos/buscas/${encodeURIComponent(id)}/alerta`, { method: 'PUT', body });
      pendente = false;
      dicaTestar.textContent = 'O teste manda agora uma mensagem com até 5 vagas que atendem aos critérios salvos.';
      avisar(msg, body.ligado ? 'Alerta salvo e ligado.' : 'Alerta salvo (desligado).', 'ok');
    });
    // enviar() reabilita os botões ao terminar; o teste segue preso enquanto houver pendência.
    setTimeout(() => { if (pendente) testar.disabled = true; }, 0);
  });

  testar.addEventListener('click', async () => {
    if (pendente) return;
    testar.disabled = true;
    testar.classList.add('girando');
    avisar(msg, 'Enviando teste…');
    try {
      const r = await api(`empregos/buscas/${encodeURIComponent(id)}/alerta/testar`, { method: 'POST', body: {} });
      const n = numeroOu(r?.enviadas ?? r?.vagas_na_mensagem);
      avisar(msg, n ? `Mensagem enviada com ${n} ${n === 1 ? 'vaga' : 'vagas'}.` : 'Nenhuma vaga atende aos critérios agora: nada foi enviado.', n ? 'ok' : '');
    } catch (e) {
      avisar(msg, e.status === 429 ? 'Já houve um teste há pouco: aguarde 5 min.' : e.message, 'erro');
    } finally {
      testar.classList.remove('girando');
      setTimeout(() => { testar.disabled = pendente; }, 3000);
    }
  });
}

const VAZIO_ACHADOS = {
  novos: 'Nenhuma vaga nova. As coletas seguem ao longo do dia; o que chegar aparece aqui.',
  todos: 'Nenhuma vaga encontrada ainda para esta busca.',
  favoritos: 'Nenhum favorito. A estrela de cada vaga guarda aqui as que interessam.',
  arquivados: 'Nenhuma vaga arquivada. Arquivar tira a vaga das outras abas; daqui ela pode ser restaurada.',
};
const ICONE_MODELO = { presencial: 'predio', hibrido: 'metade', remoto: 'casa' };

function badgeModelo(v) {
  if (!v.modelo) return null;
  return el('span', { class: `emp-badge emp-b-${v.modelo}` }, ICONE_MODELO[v.modelo] ? icone(ICONE_MODELO[v.modelo]) : null, MODELOS[v.modelo] || v.modelo,
    v.modelo_inferido ? el('span', { class: 'emp-b-aprox', title: 'Modelo deduzido do texto do anúncio' }, 'aprox.') : null);
}

// Cartão de vaga ou concurso, sempre com o mesmo esqueleto (a grade iguala a altura na linha).
// aoMudar(antes, depois): atualiza as contagens das abas; o cartão sai da lista quando a aba deixa de valer.
function cartaoAchado(a, { aba, aoMudar }) {
  const v = a.vaga || {};
  const concurso = v.tipo === 'concurso';
  const card = el('article', { class: `emp-achado${concurso ? ' concurso' : ''}` });
  const msg = el('span', { class: 'msg', role: 'status' });
  const link = v.url ? linkSeguro(v.url) : null;
  const local = [v.cidade, v.uf].filter(Boolean).join('/') || (concurso ? 'Nacional' : v.modelo === 'remoto' ? 'Remoto' : 'Local não informado');
  const salario = textoSalario(v);
  const pub = v.publicada_ha_dias != null
    ? (numeroOu(v.publicada_ha_dias) <= 0 ? 'publicada hoje' : numeroOu(v.publicada_ha_dias) === 1 ? 'publicada ontem' : `publicada há ${numeroOu(v.publicada_ha_dias)} dias`)
    : publicadaHa(v.publicada_em);
  const arquivada = () => (a.status || 'novo') === 'arquivado';

  const canto = el('span', { class: 'emp-canto' });
  const botao = (rotulo, nomeIcone, classe = '') => el('button', { type: 'button', class: `btn pequeno ${classe}`.trim() }, icone(nomeIcone), el('span', {}, rotulo));
  const visto = botao('Marcar visto', 'check');
  const favorito = botao('Favoritar', 'estrela', 'emp-fav');
  const arquivar = botao('Arquivar', 'arquivo', 'fantasma emp-arquivar');
  const restaurar = botao('Restaurar', 'desfazer', 'emp-restaurar');
  const marcar = () => {
    const st = a.status || 'novo';
    card.dataset.status = st;
    canto.className = `emp-canto${st === 'novo' ? ' novo' : st === 'favorito' ? ' favorito' : ''}`;
    canto.replaceChildren(st === 'novo' ? 'Novo' : st === 'favorito' ? icone('estrela-cheia', '') : '');
    canto.title = st === 'favorito' ? 'Favorito' : '';
    canto.hidden = st !== 'novo' && st !== 'favorito';
    visto.hidden = favorito.hidden = arquivar.hidden = arquivada();
    restaurar.hidden = !arquivada();
    visto.disabled = st !== 'novo';
    visto.setAttribute('aria-pressed', String(st !== 'novo'));
    $('span', visto).textContent = st === 'novo' ? 'Marcar visto' : 'Visto';
    favorito.setAttribute('aria-pressed', String(st === 'favorito'));
    $('svg', favorito).replaceWith(icone(st === 'favorito' ? 'estrela-cheia' : 'estrela'));
    $('span', favorito).textContent = st === 'favorito' ? 'Favorito' : 'Favoritar';
    favorito.title = st === 'favorito' ? 'Tirar dos favoritos' : 'Guardar nos favoritos';
  };
  const mudar = async (status) => {
    const antes = a.status || 'novo';
    const botoes = [visto, favorito, arquivar, restaurar];
    for (const b of botoes) b.disabled = true;
    try {
      await api(`empregos/achados/${encodeURIComponent(a.id)}/status`, { method: 'POST', body: { status } });
      a.status = status;
      avisar(msg, '');
      // Arquivar tira das outras abas; restaurar tira da aba Arquivados.
      const sai = (status === 'arquivado' && aba !== 'arquivados') || (antes === 'arquivado' && aba === 'arquivados');
      if (aoMudar) aoMudar(antes, status, sai);
      if (sai) {
        card.classList.add('saindo');
        setTimeout(() => { card.remove(); if (aoMudar) aoMudar(null, null, true); }, 180);
        return;
      }
    } catch (e) { avisar(msg, e.message, 'erro'); }
    for (const b of botoes) b.disabled = false;
    marcar();
  };
  visto.addEventListener('click', () => mudar('visto'));
  favorito.addEventListener('click', () => mudar(a.status === 'favorito' ? 'visto' : 'favorito'));
  arquivar.addEventListener('click', () => mudar('arquivado'));
  restaurar.addEventListener('click', () => mudar('novo'));

  const badges = el('div', { class: 'emp-badges' });
  if (concurso) {
    if (v.uf) badges.append(el('span', { class: 'emp-badge emp-b-uf' }, v.uf));
  } else {
    const m = badgeModelo(v);
    if (m) badges.append(m);
    if (v.contrato) badges.append(el('span', { class: `emp-badge emp-b-${v.contrato}` }, CONTRATOS[v.contrato] || v.contrato));
  }
  if (v.fonte) badges.append(el('span', { class: 'emp-badge emp-b-fonte' }, `via ${nomeFonteEmp(v.fonte)}`));

  const abrir = link
    ? el('a', { class: 'btn primario pequeno', href: link, target: '_blank', rel: 'noopener noreferrer' }, concurso ? 'Abrir edital' : 'Abrir vaga', icone('externo'))
    : el('span', { class: 'nota' }, 'Sem link');
  // Abrir a vaga já conta como visto (fora da aba Arquivados).
  if (link) abrir.addEventListener('click', () => { if ((a.status || 'novo') === 'novo') mudar('visto'); });

  const titulo = v.titulo || (concurso ? 'Concurso sem título' : 'Vaga sem título');
  const empregador = concurso ? `Órgão: ${v.empregador || 'não informado'}` : v.empregador || 'Empregador não informado';
  if (concurso) card.append(el('p', { class: 'emp-faixa' }, 'Concurso'));
  card.append(
    el('div', { class: 'emp-achado-topo' }, el('h3', { title: titulo }, titulo), canto),
    el('p', { class: 'emp-empregador', title: empregador }, empregador),
    el('p', { class: 'emp-local' }, icone('pino'), el('span', {}, local)),
    badges,
    el('p', { class: `emp-salario-valor${salario ? '' : ' sem'}` }, salario || (concurso ? 'Salário conforme o edital' : 'Salário não informado')),
    el('p', { class: 'emp-meta' }, pub ? pub[0].toUpperCase() + pub.slice(1) : 'Data de publicação não informada'),
    el('div', { class: 'emp-achado-acoes' }, abrir, visto, favorito, arquivar, restaurar),
    msg);
  marcar();
  return card;
}

// Filtros dos resultados: vivem na query do endereço (/empregos/ID?modelo=presencial&dias=30).
const FILTROS_LISTA = ['modelo', 'contrato', 'fonte'];
function lerFiltros(query) {
  const p = new URLSearchParams(query || '');
  const lista = (k) => (p.get(k) || '').split(',').map((x) => x.trim()).filter(Boolean);
  const f = {
    filtro: ['novos', 'todos', 'favoritos', 'arquivados'].includes(p.get('filtro')) ? p.get('filtro') : null,
    modelo: lista('modelo'), contrato: lista('contrato'), fonte: lista('fonte'),
    salario_min: valorMoeda(p.get('salario_min')) || null,
    sem_salario: p.get('sem_salario') !== '0',
    dias: ['7', '15', '30', '45'].includes(p.get('dias')) ? p.get('dias') : '',
    q: (p.get('q') || '').slice(0, 80),
    uf: UFS.includes(p.get('uf')) ? p.get('uf') : '',
    ordenar: ['salario', 'empregador'].includes(p.get('ordenar')) ? p.get('ordenar') : 'recentes',
  };
  return f;
}
// Só o que difere do padrão entra na query.
function queryFiltros(f) {
  const p = new URLSearchParams();
  if (f.filtro) p.set('filtro', f.filtro);
  for (const k of FILTROS_LISTA) if (f[k].length) p.set(k, f[k].join(','));
  if (f.salario_min) p.set('salario_min', String(f.salario_min));
  if (!f.sem_salario) p.set('sem_salario', '0');
  if (f.dias) p.set('dias', f.dias);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.uf) p.set('uf', f.uf);
  if (f.ordenar !== 'recentes') p.set('ordenar', f.ordenar);
  return p.toString();
}
const nFiltrosAtivos = (f) => FILTROS_LISTA.reduce((s, k) => s + (f[k].length ? 1 : 0), 0)
  + (f.salario_min ? 1 : 0) + (f.sem_salario ? 0 : 1) + (f.dias ? 1 : 0) + (f.q.trim() ? 1 : 0) + (f.uf ? 1 : 0);

async function telaEmpAchados(id, query) {
  const t = montar('t-emp-achados');
  const caixa = $('[data-achados]', t);
  const mais = $('[data-mais]', t);
  const cabeca = $('[data-cabeca]', t);
  const barra = $('[data-barra]', t);
  const fx = lerFiltros(query);
  let pagina = 1;
  let busca = null;
  let pedido = 0;
  let total = null;
  // Contagem de cada aba: das facetas (mais recentes) ou dos contadores da busca.
  const contagens = { novos: null, todos: null, favoritos: null, arquivados: null };
  const desenharContagens = () => {
    for (const [k, v] of Object.entries(contagens)) $(`[data-n-status="${k}"]`, t).textContent = v != null ? String(Math.max(0, v)) : '';
  };
  const contagensDaBusca = () => {
    const c = busca?.contadores || {};
    if (c.novos != null) contagens.novos = numeroOu(c.novos);
    if (c.total != null) contagens.todos = numeroOu(c.total);
    if (c.favoritos != null) contagens.favoritos = numeroOu(c.favoritos);
    if (c.arquivados != null) contagens.arquivados = numeroOu(c.arquivados);
  };
  const contagensDasFacetas = (fa) => {
    const ps = fa?.por_status;
    if (ps && typeof ps === 'object') {
      contagens.novos = numeroOu(ps.novo);
      contagens.favoritos = numeroOu(ps.favorito);
      if (ps.arquivado != null) contagens.arquivados = numeroOu(ps.arquivado);
      contagens.todos = fa.universo != null ? numeroOu(fa.universo) : numeroOu(ps.novo) + numeroOu(ps.visto) + numeroOu(ps.favorito);
    }
  };
  const CHAVE_ABA = { novo: 'novos', favorito: 'favoritos', arquivado: 'arquivados' };
  // Mudança de status de um cartão: ajusta as contagens sem pedir de novo ao servidor.
  const aoMudar = (antes, depois, saiu) => {
    if (antes == null) { vazio(); return; }
    const conta = (st, d) => {
      if (CHAVE_ABA[st] && contagens[CHAVE_ABA[st]] != null) contagens[CHAVE_ABA[st]] += d;
      if (st !== 'arquivado' && contagens.todos != null) contagens.todos += d;
    };
    conta(antes, -1);
    conta(depois, 1);
    desenharContagens();
    if (saiu && total != null) total = Math.max(0, total - 1);
    const aviso = $('[data-aviso]', t);
    if (depois === 'arquivado') avisar(aviso, 'Vaga arquivada: está na aba Arquivados, de onde pode ser restaurada.', 'ok');
    else if (antes === 'arquivado') avisar(aviso, 'Vaga restaurada: voltou para Novos.', 'ok');
  };

  const desenharCabeca = () => {
    if (!busca) { cabeca.replaceChildren(el('h1', {}, 'Resultados da busca')); return; }
    document.title = `${busca.profissao || 'Busca'} · Buscador de Empregos`;
    const msg = el('span', { class: 'msg', role: 'status' });
    const buscar = el('button', { type: 'button', class: 'btn primario' }, icone('lupa'), 'Buscar agora');
    buscar.addEventListener('click', () => pedirColeta(`empregos/buscas/${encodeURIComponent(busca.id)}/coletar`, buscar, msg));
    cabeca.replaceChildren(
      el('div', { class: 'emp-cabeca-topo' },
        el('div', { class: 'emp-cartao-titulo' },
          el('h1', {}, busca.profissao || 'Busca'),
          el('p', { class: 'emp-local' }, textoCidades(busca))),
        el('span', { class: `emp-estado${busca.ativa === false ? ' pausada' : ''}` }, busca.ativa === false ? 'Pausada' : 'Ligada')),
      termosBusca(busca),
      contadoresBusca(busca),
      ultimaColeta(busca),
      el('div', { class: 'emp-acoes' },
        buscar,
        el('a', { class: 'btn', href: `/empregos/${encodeURIComponent(busca.id)}/alerta` }, icone('sino'), alertaLigado(busca) ? 'Alerta ligado' : 'Alerta desligado'),
        el('a', { class: 'btn fantasma', href: `/empregos/${encodeURIComponent(busca.id)}/editar` }, 'Editar busca'),
        msg));
  };

  // Barra: campos fixos preenchidos pelo estado; pílulas de faceta redesenhadas a cada resposta.
  const fs = {
    q: $('input[name=q]', barra), uf: $('select[name=uf]', barra), ordenar: $('select[name=ordenar]', barra),
    salario: $('input[name=salario_min]', barra), semSalario: $('input[name=sem_salario]', barra),
  };
  fs.uf.replaceChildren(el('option', { value: '' }, 'Todas'), ...UFS.map((u) => el('option', { value: u }, u)));
  const preencherCampos = () => {
    fs.q.value = fx.q;
    fs.uf.value = fx.uf;
    fs.ordenar.value = fx.ordenar;
    fs.salario.value = fx.salario_min ? brl(fx.salario_min) : '';
    fs.semSalario.checked = fx.sem_salario;
    for (const r of $$('input[name=dias]', barra)) r.checked = r.value === fx.dias;
  };
  const ROTULOS = { modelo: MODELOS, contrato: CONTRATOS, fonte: {} };
  let facetas = {};
  const desenharFacetas = () => {
    const fonteDe = { modelo: facetas.por_modelo, contrato: facetas.por_contrato, fonte: facetas.por_fonte };
    for (const k of FILTROS_LISTA) {
      const contagem = fonteDe[k] || {};
      const chaves = [...new Set([...Object.keys(ROTULOS[k]), ...Object.keys(contagem), ...fx[k]])];
      const opcoes = chaves.map((c) => [c, ROTULOS[k][c] || (k === 'fonte' ? nomeFonteEmp(c) : c), contagem[c] != null ? numeroOu(contagem[c]) : (Object.keys(contagem).length ? 0 : null)]);
      pilulasMulti($(`[data-faceta="${k}"]`, barra), k, opcoes, fx[k]);
      $(`[data-faceta="${k}"]`, barra).closest('fieldset').hidden = !opcoes.length;
    }
    const sem = facetas.sem_salario ?? (facetas.universo != null && facetas.com_salario != null ? numeroOu(facetas.universo) - numeroOu(facetas.com_salario) : null);
    $('[data-conta-sem]', barra).textContent = sem != null ? String(numeroOu(sem)) : '';
  };

  const marcarSituacao = () => {
    for (const b of $('[data-filtro]', t).children) b.classList.toggle('ativo', b.dataset.f === fx.filtro);
  };
  const resumo = () => {
    const n = nFiltrosAtivos(fx);
    $('[data-n-filtros]', t).textContent = n ? String(n) : '';
    $('[data-limpar]', t).hidden = !n && fx.ordenar === 'recentes';
    const mostrados = $$('.emp-achado', caixa).length;
    $('[data-total]', t).textContent = total != null
      ? `${total} ${total === 1 ? 'resultado' : 'resultados'}`
      : mostrados ? `${mostrados} ${mostrados === 1 ? 'mostrado' : 'mostrados'}${mais.hidden ? '' : ' · há mais'}` : '';
  };
  const vazio = () => {
    if (!$('.emp-achado', caixa)) {
      caixa.replaceChildren(el('p', { class: 'vazio emp-achados-vazio' },
        nFiltrosAtivos(fx) ? 'Nenhuma vaga com estes filtros. Afrouxe algum filtro ou use “Limpar filtros”.' : VAZIO_ACHADOS[fx.filtro]));
    }
    resumo();
  };

  const parametros = () => {
    const p = new URLSearchParams();
    p.set('filtro', fx.filtro);
    for (const k of FILTROS_LISTA) if (fx[k].length) p.set(k, fx[k].join(','));
    if (fx.salario_min) p.set('salario_min', String(fx.salario_min));
    p.set('sem_salario', fx.sem_salario ? '1' : '0');
    if (fx.dias) p.set('dias', fx.dias);
    if (fx.q.trim()) p.set('q', fx.q.trim());
    if (fx.uf) p.set('uf', fx.uf);
    p.set('ordenar', fx.ordenar);
    p.set('pagina', String(pagina));
    return p.toString();
  };
  const carregar = async (reiniciar) => {
    const meu = ++pedido;
    if (reiniciar) {
      pagina = 1;
      mais.hidden = true;
      caixa.replaceChildren(el('p', { class: 'vazio' }, 'Carregando…'));
    }
    mais.disabled = true;
    try {
      const r = await api(`empregos/buscas/${encodeURIComponent(id)}/achados?${parametros()}`);
      if (meu !== pedido) return;
      if (reiniciar) caixa.replaceChildren();
      for (const a of listaDe(Array.isArray(r) ? r : (r?.itens ?? r?.achados))) caixa.append(cartaoAchado(a, { aba: fx.filtro, aoMudar }));
      pagina = numeroOu(r?.pagina, pagina) + 1;
      mais.hidden = !(r?.tem_mais ?? (numeroOu(r?.pagina, 1) < numeroOu(r?.paginas, 1)));
      total = r?.total != null ? numeroOu(r.total) : null;
      if (r?.facetas) { facetas = r.facetas; desenharFacetas(); contagensDasFacetas(r.facetas); desenharContagens(); }
      vazio();
    } catch (e) {
      if (meu !== pedido) return;
      if (reiniciar) caixa.replaceChildren();
      caixa.append(el('p', { class: 'nota erro' }, e.message));
    } finally { mais.disabled = false; }
  };
  // Mudou um filtro: grava no endereço (sem recarregar a tela) e pede de novo ao servidor.
  const aplicar = () => {
    const q = queryFiltros(fx);
    history.replaceState(null, '', `/empregos/${encodeURIComponent(id)}${q ? `?${q}` : ''}`);
    marcarSituacao();
    carregar(true);
  };

  try { busca = await buscaPorId(id); } catch { busca = null; }
  desenharCabeca();
  contagensDaBusca();
  desenharContagens();
  // Sem situação no endereço: Novos quando há novos, senão Todos.
  if (!fx.filtro) fx.filtro = busca && numeroOu(busca.contadores?.novos) === 0 && numeroOu(busca.contadores?.total) > 0 ? 'todos' : 'novos';
  marcarSituacao();
  preencherCampos();
  desenharFacetas();
  // Telas largas abrem a barra; no telefone ela começa recolhida, a menos que já haja filtro.
  barra.open = matchMedia('(min-width: 861px)').matches || nFiltrosAtivos(fx) > 0;

  $('[data-filtro]', t).addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-f]');
    if (!b || b.dataset.f === fx.filtro) return;
    fx.filtro = b.dataset.f;
    aplicar();
  });
  barra.addEventListener('change', (ev) => {
    const x = ev.target;
    if (FILTROS_LISTA.includes(x.name)) fx[x.name] = marcadosEm($(`[data-faceta="${x.name}"]`, barra));
    else if (x.name === 'dias') fx.dias = x.value;
    else if (x.name === 'uf') fx.uf = x.value;
    else if (x.name === 'ordenar') fx.ordenar = x.value;
    else if (x.name === 'sem_salario') fx.sem_salario = x.checked;
    else if (x.name === 'salario_min') { const v = valorMoeda(x.value); x.value = v ? brl(v) : ''; if (v === fx.salario_min) return; fx.salario_min = v; }
    else return;
    aplicar();
  });
  fs.salario.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); fs.salario.blur(); } });
  let espera = null;
  fs.q.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(() => { if (fs.q.value.trim() !== fx.q.trim()) { fx.q = fs.q.value; aplicar(); } }, 450);
  });
  $('[data-limpar]', t).addEventListener('click', () => {
    Object.assign(fx, lerFiltros(''), { filtro: fx.filtro });
    preencherCampos();
    desenharFacetas();
    aplicar();
  });
  mais.addEventListener('click', () => carregar(false));
  await carregar(true);
}

// --- Administração › Empregos -------------------------------------------------------------------

const desenhadoEmp = new WeakSet();
let serieEmp = null;

function desenharGraficoEmp(painel) {
  const canvas = $('.emp-grafico canvas', painel);
  const vazio = $('[data-emp-adm-grafico-vazio]', painel);
  const serie = listaDe(serieEmp);
  const nomes = [...new Set(serie.flatMap((d) => Object.keys(d?.por_fonte || {})))];
  const semDados = !serie.length || !nomes.length;
  vazio.hidden = !semDados;
  $('.emp-grafico', painel).hidden = semDados;
  if (grafico) { grafico.destroy(); grafico = null; }
  if (semDados) return;
  const texto = cor('--suave');
  const grade = cor('--borda');
  grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: serie.map((d) => diaMes(String(d.dia || ''))),
      datasets: nomes.map((nome, i) => ({
        label: nomeFonteEmp(nome),
        data: serie.map((d) => numeroOu(d?.por_fonte?.[nome]?.vagas_novas)),
        backgroundColor: cor(`--emp-serie-${(i % 4) + 1}`),
        borderRadius: 3,
        maxBarThickness: 28,
      })),
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 8 }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { color: texto, precision: 0 }, grid: { color: grade } },
      },
      plugins: {
        legend: { labels: { color: texto, boxWidth: 14 } },
        tooltip: { callbacks: { footer: (itens) => `Total: ${itens.reduce((s, x) => s + x.parsed.y, 0)}` } },
      },
    },
  });
}

function numeroEmp(rotulo, valor, detalhe, classe) {
  return el('div', { class: `op-numero${classe ? ` ${classe}` : ''}` },
    el('span', { class: 'rotulo' }, rotulo), el('strong', {}, valor == null ? '—' : String(valor)), detalhe ? el('span', { class: 'detalhe' }, detalhe) : null);
}

function erroFonteEmp(f) {
  const e = f.ultimo_erro;
  if (!e) return null;
  if (typeof e === 'string') return { texto: e, em: instante(f.ultimo_erro_em) };
  return { texto: e.erro || e.msg || e.mensagem || 'falhou', em: instante(e) };
}

function desenharFontesEmp(caixa, lista, recarregar) {
  if (!lista.length) { caixa.replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma fonte registrada ainda.')); return; }
  caixa.replaceChildren(...lista.map((f) => {
    const ok = instante(f.ultimo_ok);
    const erro = erroFonteEmp(f);
    const erroMaisNovo = erro && (!ok || (erro.em != null && erro.em > ok));
    let estado = 'ok';
    let texto = 'Funcionando';
    if (f.ativa === false) { estado = 'desligada'; texto = 'Desligada'; }
    else if (erroMaisNovo) { estado = 'falha'; texto = 'Última coleta falhou'; }
    else if (!ok) { estado = 'espera'; texto = 'Ainda sem coleta'; }
    const chave = el('input', { type: 'checkbox', role: 'switch', 'aria-label': `${nomeFonteEmp(f.nome)} ligada` });
    chave.checked = f.ativa !== false;
    const msg = el('span', { class: 'msg', role: 'status' });
    chave.addEventListener('change', async () => {
      const ativa = chave.checked;
      chave.disabled = true;
      avisar(msg, ativa ? 'Ligando…' : 'Desligando…');
      try {
        await api(`empregos/admin/fontes/${encodeURIComponent(f.nome)}`, { method: 'POST', body: { ativa } });
        await recarregar();
      } catch (e) {
        chave.checked = !ativa;
        chave.disabled = false;
        avisar(msg, e.message, 'erro');
      }
    });
    const linha = (rotulo, valor, cls) => el('div', {}, el('dt', {}, rotulo), el('dd', cls ? { class: cls } : {}, valor));
    return el('article', { class: `adm-fonte ${estado}` },
      el('header', { class: 'adm-fonte-topo' },
        el('div', {}, el('h3', {}, nomeFonteEmp(f.nome))),
        el('label', { class: 'interruptor' }, chave, el('span', { class: 'interruptor-trilho', 'aria-hidden': 'true' }))),
      el('p', { class: 'adm-fonte-estado' }, el('span', { class: 'fonte-ponto', 'aria-hidden': 'true' }), texto),
      el('dl', { class: 'adm-fonte-dados' },
        linha('Requisições hoje', String(numeroOu(f.requisicoes_hoje ?? f.hoje?.requisicoes))),
        linha('Último sucesso', ok ? dataHora(ok) : '—', ok && !erroMaisNovo ? 'data-verde' : null),
        linha('Última falha', erro?.em ? dataHora(erro.em) : erro ? 'sem data' : '—', erroMaisNovo ? 'data-vermelha' : null)),
      erro ? el('p', { class: 'adm-fonte-erro' }, erro.texto) : null,
      msg);
  }));
}

const donoEmp = (x) => {
  const d = x.dono ?? x.usuario;
  if (d && typeof d === 'object') return d.nome || d.telefone || '—';
  return d || x.dono_nome || x.usuario_nome || '—';
};

function desenharBuscasEmp(caixa, buscas) {
  caixa.replaceChildren(tabelaAdmin(
    [{ nome: 'Dono' }, { nome: 'Profissão' }, { nome: 'Cidades' }, { nome: 'Situação' }, { nome: 'Alerta' }, { nome: 'Última coleta' }, { nome: 'Novos / total', num: true }, { nome: 'Ação' }],
    buscas.map((b) => {
      const uc = b.ultima_coleta;
      const erro = uc && (uc.ok === false || uc.erro) ? (uc.erro || 'falhou') : null;
      const msg = el('span', { class: 'msg', role: 'status' });
      const coletar = el('button', { type: 'button', class: 'btn pequeno' }, 'Coletar');
      coletar.addEventListener('click', () => pedirColeta(`empregos/admin/buscas/${encodeURIComponent(b.id)}/coletar`, coletar, msg));
      const c = b.contadores || {};
      return [
        donoEmp(b),
        b.profissao || '—',
        textoCidades(b),
        el('span', { class: `chip${b.ativa === false ? '' : ' chip-admin'}` }, b.ativa === false ? 'pausada' : 'ligada'),
        el('span', { class: `chip${alertaLigado(b) ? ' chip-admin' : ''}` }, alertaLigado(b) ? 'ligado' : 'desligado'),
        el('span', { class: 'emp-adm-coleta' }, instante(uc) ? relativo(uc) : 'ainda não', erro ? el('small', { class: 'emp-erro' }, erro) : null),
        `${numeroOu(c.novos)} / ${numeroOu(c.total)}`,
        el('span', { class: 'emp-adm-acao' }, coletar, msg),
      ];
    }),
    'Nenhuma busca criada.'));
}

function desenharColetasEmp(caixa, coletas) {
  caixa.replaceChildren(tabelaAdmin(
    [{ nome: 'Quando' }, { nome: 'Busca' }, { nome: 'Fonte' }, { nome: 'Resultado' }, { nome: 'Requisições', num: true }, { nome: 'Vagas novas / total', num: true }, { nome: 'Achados novos', num: true }, { nome: 'Duração', num: true }],
    coletas.map((c) => {
      const ini = instante(c.inicio ?? c.em);
      const fim = instante(c.fim);
      const ms = c.duracao_ms != null ? numeroOu(c.duracao_ms) : ini && fim ? fim - ini : null;
      const falhou = c.ok === false || !!c.erro;
      return [
        ini ? dataHora(ini) : fim ? dataHora(fim) : '—',
        c.profissao || c.busca?.profissao || (c.busca_id != null ? String(c.busca_id) : '—'),
        nomeFonteEmp(c.fonte),
        falhou ? el('span', { class: 'emp-erro' }, c.erro || 'falhou') : el('span', { class: 'emp-ok' }, 'ok'),
        String(numeroOu(c.requisicoes)),
        `${numeroOu(c.vagas_novas)} / ${numeroOu(c.vagas_total)}`,
        String(numeroOu(c.achados_novos)),
        ms != null ? `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '—',
      ];
    }),
    'Nenhuma coleta registrada.'));
}

function desenharEnviosEmp(caixa, envios) {
  caixa.replaceChildren(tabelaAdmin(
    [{ nome: 'Quando' }, { nome: 'Usuário' }, { nome: 'Busca' }, { nome: 'Vagas', num: true }, { nome: 'Situação' }],
    envios.map((e) => {
      const t = instante(e.em ?? e.enviado_em ?? e.criado_em);
      const falhou = e.ok === false || !!e.erro;
      const n = e.n_vagas ?? e.vagas_n ?? (Array.isArray(e.vagas) ? e.vagas.length : e.vagas);
      return [
        t ? dataHora(t) : '—',
        donoEmp(e),
        e.profissao || e.busca?.profissao || (e.busca_id != null ? String(e.busca_id) : '—'),
        n != null ? String(numeroOu(n)) : '—',
        falhou ? el('span', { class: 'emp-erro' }, e.erro || 'falhou') : el('span', { class: 'emp-ok' }, 'enviada'),
      ];
    }),
    'Nenhum envio registrado.'));
}

// Desenha o painel inteiro; devolve o número de buscas ativas (para a contagem da aba).
async function carregarEmpregosAdmin(painel) {
  const parte = (p) => p.catch((e) => ({ erro_tela: e }));
  const [resumo, rBuscas, rFontes, rColetas, rEnvios] = await Promise.all([
    api('empregos/admin/resumo'),
    parte(api('empregos/admin/buscas')),
    parte(api('empregos/admin/fontes')),
    parte(api('empregos/admin/coletas?limite=50')),
    parte(api('empregos/admin/envios?limite=50')),
  ]);
  for (const x of $$('[data-emp-adm-resumo] .adm-erro', painel)) x.remove();
  const hoje = resumo?.hoje || {};
  const pf = hoje.por_fonte || {};
  const soma = (campo) => Object.values(pf).reduce((s, x) => s + numeroOu(x?.[campo]), 0);
  const falhas = soma('falhas');
  $('[data-emp-adm-numeros]', painel).replaceChildren(
    numeroEmp('Usuários com busca', resumo?.usuarios_com_busca),
    numeroEmp('Buscas ativas', resumo?.buscas_ativas),
    numeroEmp('Vagas novas hoje', soma('vagas_novas'), Object.entries(pf).map(([f, x]) => `${nomeFonteEmp(f)} ${numeroOu(x?.vagas_novas)}`).join(' · ') || null),
    numeroEmp('Achados hoje', numeroOu(hoje.achados), 'vagas que casaram com alguma busca'),
    numeroEmp('Envios hoje', numeroOu(hoje.envios), 'mensagens no WhatsApp'),
    numeroEmp('Falhas hoje', falhas, `${soma('coletas')} coletas · ${soma('requisicoes')} requisições`, falhas ? 'emp-num-falha' : null));

  serieEmp = resumo?.serie;
  desenharGraficoEmp(painel);
  if (!desenhadoEmp.has(painel)) {
    desenhadoEmp.add(painel);
    window.addEventListener('tema', () => { if (painel.isConnected) desenharGraficoEmp(painel); }, { signal: sinalTela.signal });
  }

  const em = (sel, r, desenhar) => {
    const caixa = $(sel, painel);
    if (r?.erro_tela) caixa.replaceChildren(el('p', { class: 'nota erro' }, r.erro_tela.message));
    else desenhar(caixa);
  };
  em('[data-emp-adm-fontes]', rFontes, (c) => desenharFontesEmp(c, listaDe(Array.isArray(rFontes) ? rFontes : rFontes?.fontes || resumo?.fontes), () => carregarEmpregosAdmin(painel)));
  em('[data-emp-adm-buscas]', rBuscas, (c) => desenharBuscasEmp(c, listaDe(Array.isArray(rBuscas) ? rBuscas : rBuscas?.buscas)));
  em('[data-emp-adm-coletas]', rColetas, (c) => desenharColetasEmp(c, listaDe(Array.isArray(rColetas) ? rColetas : rColetas?.coletas)));
  em('[data-emp-adm-envios]', rEnvios, (c) => desenharEnviosEmp(c, listaDe(Array.isArray(rEnvios) ? rEnvios : rEnvios?.envios)));
  return resumo?.buscas_ativas ?? null;
}

// --- Roteamento ---------------------------------------------------------------------------------
// Caminhos: /entrar /cadastro /esqueci /codigo /conta · /passagens[/nova[/ID] | /ID[/editar]]
// · /empregos[/nova | /ID[/editar | /alerta]] · /admin[/sites | /alertas[/ID] | /usuarios | /empregos].

let primeira = true;
// Endereço pedido antes do login (ex.: link do WhatsApp para um alerta): depois de entrar, vai para ele.
let depoisDoLogin = null;
const irDepoisDoLogin = () => { const h = depoisDoLogin || '/empregos'; depoisDoLogin = null; ir(h); };

// Endereços antigos com # (#/alertas/ID, /passagens/#/empregos…) viram o caminho novo.
function caminhoDoHash(hash) {
  const x = hash.slice(1);
  let m;
  if (x === '/alertas' || x === '/') return '/passagens';
  if ((m = x.match(/^\/alertas\/(.+)$/))) return `/passagens/${m[1]}`;
  if (x === '/novo') return '/passagens/nova';
  if ((m = x.match(/^\/novo\/(.+)$/))) return `/passagens/nova/${m[1]}`;
  if (x === '/sair') return '/entrar';
  return x;
}

async function rota() {
  if (location.hash.startsWith('#/')) history.replaceState(null, '', caminhoDoHash(location.hash));
  const h = location.pathname.replace(/\/+$/, '') || '/';
  const query = location.search.replace(/^\?/, '');
  const publicas = ['/entrar', '/cadastro', '/esqueci', '/codigo'];
  if (primeira && !usuario && publicas.includes(h) && h !== '/codigo') {
    usuario = (await api('sessao').catch(() => null))?.usuario || null; // sessão ainda válida pula o login
  }
  primeira = false;
  if (!usuario && !publicas.includes(h)) {
    usuario = (await api('sessao').catch(() => null))?.usuario || null;
    if (!usuario) {
      if (h !== '/') depoisDoLogin = `${h}${location.search}`;
      history.replaceState(null, '', '/entrar');
      return rota();
    }
  }
  if (usuario && publicas.includes(h)) return irDepoisDoLogin();
  if (usuario && !Object.keys(fontes).length) fontes = await api('fontes').catch(() => ({}));
  if (h === '/') { history.replaceState(null, '', '/empregos'); return rota(); }
  if (h === '/entrar') return telaEntrar();
  if (h === '/cadastro') return telaCadastro();
  if (h === '/esqueci') return telaEsqueci();
  if (h === '/codigo') return telaCodigo();
  if (h === '/conta') return telaConta();
  // Passagens
  if (h === '/passagens') return telaAlertas();
  if (h === '/passagens/nova') return telaNovo();
  const novo = h.match(/^\/passagens\/nova\/([0-9a-f]{24})$/);
  if (novo) return telaNovo(novo[1]);
  const editar = h.match(/^\/passagens\/([0-9a-f]{24})\/editar$/);
  if (editar) {
    await telaDetalhe(editar[1]);
    $('[data-form-lugar]')?.scrollIntoView({ block: 'start' });
    return;
  }
  const m = h.match(/^\/passagens\/([0-9a-f]{24})$/);
  if (m) return telaDetalhe(m[1]);
  // Administração
  const adm = h.match(/^\/admin(?:\/(sites|alertas|usuarios|empregos))?$/);
  if (adm) return telaAdmin(adm[1] === 'sites' ? 'fontes' : adm[1] || 'geral');
  const admAlerta = h.match(/^\/admin\/alertas\/([0-9a-f]{24})$/);
  if (admAlerta) return telaDetalhe(admAlerta[1], { comoAdmin: true });
  // Empregos
  if (h === '/empregos') return telaEmpregos();
  if (h === '/empregos/nova') return telaEmpForm();
  const empEd = h.match(/^\/empregos\/([\w-]{1,64})\/editar$/);
  if (empEd) return telaEmpForm(empEd[1]);
  const empAlerta = h.match(/^\/empregos\/([\w-]{1,64})\/alerta$/);
  if (empAlerta) return telaEmpAlerta(empAlerta[1]);
  const empAch = h.match(/^\/empregos\/([\w-]{1,64})$/);
  if (empAch) return telaEmpAchados(empAch[1], query);
  // Caminho desconhecido: Empregos.
  history.replaceState(null, '', '/empregos');
  return rota();
}

window.addEventListener('popstate', rota);
temaMudou();
rota();
