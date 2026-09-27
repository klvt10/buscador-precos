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
  const r = await fetch(`api/${caminho}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && usuario && !caminho.startsWith('login') && !caminho.startsWith('eu/senha')) {
    usuario = null;
    ir('#/entrar');
    throw new Error(corpo.erro || 'Sessão expirada.');
  }
  if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`);
  return corpo;
}

function montar(id) {
  if (atualizar) clearInterval(atualizar);
  atualizar = null;
  if (grafico) { grafico.destroy(); grafico = null; }
  const tela = $('#tela');
  tela.replaceChildren($(`#${id}`).content.cloneNode(true));
  $('#barra').hidden = !usuario;
  window.scrollTo(0, 0);
  return tela;
}

function ir(hash) {
  if (location.hash === hash) rota();
  else location.hash = hash;
}

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
  const t = montar('t-entrar');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('login', { method: 'POST', body: { telefone: f.telefone.value, senha: f.senha.value, lembrar: f.lembrar.checked } });
      if (r.precisa_codigo) {
        desafio = { tipo: 'login', id: r.desafio, tel: r.telefone };
        ir('#/codigo');
      } else {
        usuario = r.usuario;
        ir('#/alertas');
      }
    });
  });
}

function telaCadastro() {
  const t = montar('t-cadastro');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('cadastro', { method: 'POST', body: { nome: f.nome.value, telefone: f.telefone.value, senha: f.senha.value } });
      desafio = { tipo: 'cadastro', id: r.desafio, tel: r.telefone };
      ir('#/codigo');
    });
  });
}

function telaEsqueci() {
  const t = montar('t-esqueci');
  const f = $('form', t);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar(f, async () => {
      const r = await api('senha/esqueci', { method: 'POST', body: { telefone: f.telefone.value } });
      desafio = { tipo: 'senha', id: r.desafio, tel: r.telefone };
      ir('#/codigo');
    });
  });
}

function telaCodigo() {
  if (!desafio) return ir('#/entrar');
  const t = montar('t-codigo');
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
      ir('#/alertas');
    });
  });
}

$('#btn-sair').addEventListener('click', async () => {
  await api('sair', { method: 'POST', body: {} }).catch(() => {});
  usuario = null;
  ir('#/entrar');
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
  return `${diaMes(a.data_ida)}${volta} · a cada ${a.intervalo_min} min · alerta ${Math.round(a.desconto_min * 100)} % abaixo da média`;
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
    $('[data-limite]', t).textContent = `${r.alertas.length} de ${r.limite} alertas`;
    $('[data-novo]', t).hidden = r.alertas.length >= r.limite;
    const lista = $('[data-lista]', t);
    lista.replaceChildren();
    if (!r.alertas.length) {
      lista.append(el('div', { class: 'card vazio-grande' },
        el('p', {}, 'Nenhum alerta ainda.'),
        el('p', { class: 'nota' }, 'Crie um alerta com a rota e as datas: os preços passam a ser pesquisados sozinhos e o aviso chega no WhatsApp quando o total fica abaixo da média.'),
        el('a', { class: 'btn primario', href: '#/novo' }, 'Criar o primeiro alerta')));
      return;
    }
    for (const x of r.alertas) {
      const a = x.alerta;
      let estado = 'Aguardando a primeira consulta';
      let classe = '';
      if (x.ultima && x.media) {
        const dif = (x.ultima.total / x.media - 1) * 100;
        estado = `${pct(dif)} ${dif < 0 ? 'abaixo' : 'acima'} da média`;
        classe = dif < 0 ? 'abaixo' : 'acima';
      } else if (x.ultima) {
        estado = 'Montando a média';
      }
      const passou = a.data_ida < hojeISO();
      lista.append(el('a', { class: 'card item-alerta', href: `#/alertas/${a.id}` },
        el('div', { class: 'item-topo' },
          el('strong', {}, titulo(a)),
          el('span', { class: `selo ${passou ? 'desligado' : a.ativo ? 'ligado' : 'desligado'}` }, passou ? 'Data passou' : a.ativo ? 'Ligado' : 'Pausado')),
        el('span', { class: 'cidades' }, cidades(a)),
        a.nome ? el('span', { class: 'nome-alerta' }, a.nome) : null,
        el('span', { class: 'sub' }, descricao(a)),
        el('div', { class: 'item-rodape' },
          el('span', { class: 'preco' }, x.ultima ? brl(x.ultima.total) : '—'),
          el('span', { class: `detalhe ${classe}` }, estado))));
    }
  };
  await carregar();
  atualizar = setInterval(() => carregar().catch(() => {}), 60e3);
}

const dataCurta = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');

// base: alerta existente (edição) ou modelo para um alerta novo (duplicar).
function formAlerta(lugar, alerta, base = alerta) {
  lugar.replaceChildren($('#t-form-alerta').content.cloneNode(true));
  const f = $('form', lugar);
  const msg = $('[data-msg]', f);
  const origem = campoAeroporto($('[data-aeroporto="origem"]', f), { rotulo: 'Origem', aoEscolher: (c) => { if (c && !destino.valor) destino.focar(); } });
  const destino = campoAeroporto($('[data-aeroporto="destino"]', f), { rotulo: 'Destino' });
  const voltaCaixa = $('[data-volta]', f);
  let voltaGuardada = '';

  const soIda = () => f.tipo.value === 'so-ida';
  const atualizarDatas = () => {
    const ida = f.data_ida.value;
    f.data_volta.min = ida || hojeISO();
    if (ida && f.data_volta.value && f.data_volta.value < ida) f.data_volta.value = '';
    voltaCaixa.hidden = soIda();
    f.data_volta.required = !soIda();
    const r = $('[data-resumo-datas]', f);
    if (!ida) r.textContent = '';
    else if (soIda()) r.textContent = `Só ida · ${dataCurta(ida)}`;
    else if (!f.data_volta.value) r.textContent = `Ida ${dataCurta(ida)} · escolha a volta`;
    else {
      const noites = Math.round((new Date(f.data_volta.value) - new Date(ida)) / 864e5);
      r.textContent = `${dataCurta(ida)} → ${dataCurta(f.data_volta.value)} · ${noites === 0 ? 'bate e volta' : `${noites} ${noites === 1 ? 'noite' : 'noites'}`}`;
    }
  };
  const atualizarAjustes = () => {
    $('[data-resumo-ajustes]', f).textContent = `· ${f.desconto_pct.value || '—'} % abaixo da média, a cada ${f.intervalo_min.value || '—'} min${f.ativo.checked ? '' : ', pausado'}`;
  };

  for (const r of f.querySelectorAll('input[name="tipo"]')) {
    r.addEventListener('change', () => {
      if (soIda()) { voltaGuardada = f.data_volta.value; f.data_volta.value = ''; }
      else if (!f.data_volta.value) f.data_volta.value = voltaGuardada;
      atualizarDatas();
    });
  }
  f.data_ida.addEventListener('change', atualizarDatas);
  f.data_volta.addEventListener('change', atualizarDatas);
  for (const c of [f.desconto_pct, f.intervalo_min, f.ativo]) c.addEventListener('input', atualizarAjustes);
  $('[data-trocar]', f).addEventListener('click', () => {
    const o = origem.valor;
    origem.definir(destino.valor, { avisar: false });
    destino.definir(o, { avisar: false });
  });

  f.data_ida.min = hojeISO();
  if (base) {
    if (alerta) {
      $('[data-titulo]', f).textContent = 'Editar alerta';
      $('[data-cancelar]', f).hidden = true;
      f.nome.value = alerta.nome || '';
    }
    // Duplicar leva as datas junto enquanto ainda valem.
    if (alerta || base.data_ida >= hojeISO()) {
      f.data_ida.value = base.data_ida;
      f.data_volta.value = base.data_volta || '';
    }
    f.tipo.value = base.data_volta ? 'ida-volta' : 'so-ida';
    f.desconto_pct.value = Math.round(base.desconto_min * 100);
    f.intervalo_min.value = base.intervalo_min;
    f.ativo.checked = alerta ? alerta.ativo : true;
  }
  atualizarDatas();
  atualizarAjustes();
  // Os nomes das cidades dependem da lista; o código já vale enquanto ela carrega.
  const preencher = () => {
    origem.definir(base?.origem || '', { avisar: false });
    destino.definir(base?.destino || '', { avisar: false });
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
    if (!f.data_ida.value) { f.data_ida.focus(); f.data_ida.reportValidity(); return; }
    if (!soIda() && !f.data_volta.value) { f.data_volta.focus(); f.data_volta.reportValidity(); return; }
    for (const c of [f.desconto_pct, f.intervalo_min]) {
      if (!c.checkValidity()) { $('[data-ajustes]', f).open = true; c.focus(); c.reportValidity(); return; }
    }
    const body = {
      nome: f.nome.value,
      origem: origem.valor,
      destino: destino.valor,
      data_ida: f.data_ida.value,
      data_volta: soIda() ? null : f.data_volta.value,
      desconto_pct: Number(f.desconto_pct.value),
      intervalo_min: Number(f.intervalo_min.value),
      ativo: f.ativo.checked,
    };
    if (alerta) {
      const muda = body.origem !== alerta.origem || body.destino !== alerta.destino
        || body.data_ida !== alerta.data_ida || (body.data_volta || null) !== (alerta.data_volta || null);
      if (muda && !confirm('Rota ou datas mudaram: a média recomeça do zero. Continuar?')) return;
    }
    msg.textContent = 'Salvando…';
    enviar(f, async () => {
      const r = alerta
        ? await api(`alertas/${alerta.id}`, { method: 'PUT', body })
        : await api('alertas', { method: 'POST', body });
      msg.className = 'msg ok';
      msg.textContent = 'Salvo.';
      ir(`#/alertas/${r.alerta.id}`);
    });
  });
}

async function telaNovo(baseId) {
  const t = montar('t-alertas');
  $('.topo', t).replaceChildren(el('div', {}, el('p', { class: 'sub' }, el('a', { href: '#/alertas' }, '← Meus alertas')), el('h1', {}, baseId ? 'Novo alerta a partir de outro' : 'Novo alerta')));
  let base = null;
  if (baseId) base = (await api(`alertas/${baseId}`).catch(() => null))?.alerta || null;
  const lugar = $('[data-lista]', t);
  lugar.className = 'lugar-form';
  formAlerta(lugar, null, base);
  $$('.combo-entrada', t)[base ? 1 : 0].focus();
}

function linkSeguro(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

async function telaDetalhe(id) {
  const t = montar('t-detalhe');
  let dias = 30;
  let dados = null;

  const desenhar = () => {
    const { alerta: a, ultima, media, n_media: n, minimo } = dados;
    $('[data-titulo]', t).textContent = a.nome ? `${a.nome} · ${titulo(a)}` : titulo(a);
    $('[data-sub]', t).textContent = `${cidades(a)} · ${descricao(a)}`;
    $('[data-titulo-grafico]', t).textContent = a.data_volta ? 'Total ida + volta' : 'Preço da ida';
    const lig = $('[data-ligar]', t);
    lig.textContent = a.ativo ? 'Alerta ligado' : 'Alerta pausado';
    lig.className = `btn ${a.ativo ? 'ligado' : 'desligado'}`;
    lig.title = a.ativo ? 'Pausa os avisos no WhatsApp (as pesquisas param)' : 'Religa os avisos';
    const pesq = $('[data-pesquisar]', t);
    pesq.disabled = a.pesquisa_pedida;
    pesq.textContent = a.pesquisa_pedida ? 'Pesquisando…' : 'Pesquisar agora';

    const k = (nome) => $(`[data-k="${nome}"]`, t);
    k('ultima').textContent = ultima ? brl(ultima.total) : '—';
    const det = k('ultima-det');
    det.className = 'detalhe';
    if (ultima && media) {
      const dif = (ultima.total / media - 1) * 100;
      det.textContent = `${dataHora(ultima.ts)} · ${pct(dif)} ${dif < 0 ? 'abaixo' : 'acima'} da média`;
      det.classList.add(dif < 0 ? 'abaixo' : 'acima');
    } else {
      det.textContent = ultima ? dataHora(ultima.ts) : 'Nenhuma consulta ainda';
    }
    k('media').textContent = brl(media);
    k('media-det').textContent = media ? `${n} consulta${n === 1 ? '' : 's'} anteriores` : 'Sem histórico ainda';
    k('gatilho').textContent = media ? brl(media * (1 - a.desconto_min)) : '—';
    k('gatilho-det').textContent = `Alerta com total ${Math.round(a.desconto_min * 100)} % abaixo da média`;
    k('minimo').textContent = minimo ? brl(minimo.total) : '—';
    k('minimo-det').textContent = minimo ? dataHora(minimo.ts) : '';

    desenharVoos($('[data-voos]', t), a, ultima);
    desenharFontes($('[data-fontes]', t), dados.fontes);
  };

  const carregarGrafico = async () => {
    const { pontos } = await api(`alertas/${id}/historico?dias=${dias}`);
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
          { label: 'Total', data: serie((p) => p.total), borderColor: cor('--serie-total'), backgroundColor: cor('--serie-total'), borderWidth: 2, pointRadius: pontos.map((p) => (p.alertado ? 5 : 0)), pointHoverRadius: 4, tension: 0.2 },
          { label: 'Média 7 dias', data: serie((p) => p.media), borderColor: cor('--serie-media'), borderWidth: 1.5, pointRadius: 0, spanGaps: true },
          { label: 'Gatilho do alerta', data: serie((p) => p.media && p.media * (1 - desconto)), borderColor: cor('--serie-gatilho'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, spanGaps: true },
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
                const l = [`Ida ${brl(p.ida)} (${fontes[p.fonte_ida] || p.fonte_ida})`];
                if (p.volta != null) l.push(`Volta ${brl(p.volta)} (${fontes[p.fonte_volta] || p.fonte_volta})`);
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
    dados = await api(`alertas/${id}`);
    desenhar();
    if (comGrafico) await carregarGrafico();
  };

  try {
    await Promise.all([carregar(false), carregarAeroportos().catch(() => null)]);
    desenhar();
  } catch (e) {
    $('#tela').replaceChildren(el('section', { class: 'conteudo' }, el('p', {}, e.message), el('a', { href: '#/alertas' }, '← Meus alertas')));
    return;
  }
  formAlerta($('[data-form-lugar]', t), dados.alerta);
  $('[data-duplicar]', t).href = `#/novo/${id}`;
  await carregarGrafico();
  let voltas = 0;
  atualizar = setInterval(() => { voltas += 1; carregar(voltas % 4 === 0).catch(() => {}); }, 15e3);

  $('[data-periodo]', t).addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    dias = Number(b.dataset.dias);
    for (const x of $('[data-periodo]', t).children) x.classList.toggle('ativo', x === b);
    carregarGrafico();
  });
  $('[data-pesquisar]', t).addEventListener('click', async () => {
    await api(`alertas/${id}/pesquisar`, { method: 'POST', body: {} });
    dados.alerta.pesquisa_pedida = true;
    desenhar();
  });
  $('[data-ligar]', t).addEventListener('click', async () => {
    const a = dados.alerta;
    const body = { nome: a.nome, origem: a.origem, destino: a.destino, data_ida: a.data_ida, data_volta: a.data_volta, desconto_pct: Math.round(a.desconto_min * 1000) / 10, intervalo_min: a.intervalo_min, ativo: !a.ativo };
    const r = await api(`alertas/${id}`, { method: 'PUT', body }).catch((e) => alert(e.message));
    if (r) { dados.alerta = r.alerta; desenhar(); $('[data-form-lugar] input[name=ativo]', t).checked = r.alerta.ativo; }
  });
  $('[data-apagar]', t).addEventListener('click', async () => {
    if (!confirm('Apagar este alerta e todo o histórico dele?')) return;
    await api(`alertas/${id}`, { method: 'DELETE' });
    ir('#/alertas');
  });
}

function desenharVoos(box, a, ultima) {
  box.replaceChildren();
  if (!ultima) {
    box.append(el('p', { class: 'vazio' }, 'Aguardando a primeira consulta.'));
    return;
  }
  const trechos = [['ida', `Ida ${diaMes(a.data_ida)} · ${a.origem} → ${a.destino}`]];
  if (ultima.volta) trechos.push(['volta', `Volta ${diaMes(a.data_volta)} · ${a.destino} → ${a.origem}`]);
  for (const [k, rotulo] of trechos) {
    const v = ultima[k];
    const link = v.link && linkSeguro(v.link);
    const fonte = fontes[v.fonte] || v.fonte;
    box.append(el('div', { class: 'voo' },
      el('span', { class: 'trecho' }, rotulo),
      el('span', {}, `${v.companhia}${v.voo ? ` ${v.voo}` : ''} · ${v.partida} → ${v.chegada}`),
      el('span', { class: 'preco' }, brl(v.preco)),
      el('span', { class: 'fonte' }, 'Fonte: ', link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, fonte) : fonte)));
  }
  box.append(el('div', { class: 'voo' },
    el('span', { class: 'trecho' }, `Consulta de ${dataHora(ultima.ts)}`),
    el('strong', {}, 'Total'),
    el('span', { class: 'preco' }, brl(ultima.total))));
}

function desenharFontes(box, trechos) {
  box.replaceChildren();
  for (const tr of trechos || []) {
    const tab = el('table', { class: 'fontes' },
      el('thead', {}, el('tr', {}, el('th', {}, `${tr.origem} → ${tr.destino} ${diaMes(tr.data)}`), el('th', { class: 'num' }, 'Menor'), el('th', {}, 'Quando'))));
    const tb = el('tbody');
    for (const f of tr.fontes) {
      let quando = f.ts ? dataHora(f.ts) : '—';
      if (f.pesquisando) quando = 'pesquisando…';
      else if (f.pausada) quando = 'fora do ar';
      else if (f.ok === false) quando = `sem resposta (${f.ts ? dataHora(f.ts) : ''})`;
      tb.append(el('tr', { class: f.ok === false || f.pausada ? 'apagado' : '' },
        el('td', {}, f.nome),
        el('td', { class: 'num' }, f.ok ? (f.menor != null ? brl(f.menor) : 'sem voo direto') : '—'),
        el('td', {}, quando)));
    }
    tab.append(tb);
    box.append(el('div', { class: 'tabela-rolagem' }, tab));
  }
}

// --- Conta --------------------------------------------------------------------------------------

async function telaConta() {
  const t = montar('t-conta');
  const fNome = $('[data-form="nome"]', t);
  fNome.nome.value = usuario.nome;
  $('[data-tel]', t).textContent = usuario.telefone;
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
    ir('#/entrar');
  });
  const fApagar = $('[data-form="apagar"]', t);
  fApagar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!confirm('Apagar a conta, os alertas e o histórico? Não tem volta.')) return;
    enviar(fApagar, async () => {
      await api('eu', { method: 'DELETE', body: { senha: fApagar.senha.value } });
      usuario = null;
      ir('#/cadastro');
    });
  });
  if (usuario.admin) {
    $('[data-admin]', t).hidden = false;
    const mostrar = async () => { $('[data-estado]', t).textContent = JSON.stringify(await api('admin/estado'), null, 2); };
    await mostrar().catch(() => {});
    atualizar = setInterval(() => mostrar().catch(() => {}), 10e3);
  }
}

// --- Roteamento ---------------------------------------------------------------------------------

let primeira = true;

async function rota() {
  const h = location.hash || '#/alertas';
  const publicas = ['#/entrar', '#/cadastro', '#/esqueci', '#/codigo'];
  if (primeira && !usuario && publicas.includes(h) && h !== '#/codigo') {
    usuario = (await api('sessao').catch(() => null))?.usuario || null; // sessão ainda válida pula o login
  }
  primeira = false;
  if (!usuario && !publicas.includes(h)) {
    usuario = (await api('sessao').catch(() => null))?.usuario || null;
    if (!usuario) return ir('#/entrar');
  }
  if (usuario && publicas.includes(h)) return ir('#/alertas');
  if (usuario && !Object.keys(fontes).length) fontes = await api('fontes').catch(() => ({}));
  if (h === '#/entrar') return telaEntrar();
  if (h === '#/cadastro') return telaCadastro();
  if (h === '#/esqueci') return telaEsqueci();
  if (h === '#/codigo') return telaCodigo();
  if (h === '#/novo') return telaNovo();
  const novo = h.match(/^#\/novo\/([0-9a-f]{24})$/);
  if (novo) return telaNovo(novo[1]);
  if (h === '#/conta') return telaConta();
  const m = h.match(/^#\/alertas\/([0-9a-f]{24})$/);
  if (m) return telaDetalhe(m[1]);
  return telaAlertas();
}

window.addEventListener('hashchange', rota);
rota();
