'use strict';

const $ = (s) => document.querySelector(s);
const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let resumo = null;
let dias = 30;
let grafico = null;

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) e.append(f);
  return e;
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json' },
    body: opcoes.body && JSON.stringify(opcoes.body),
  });
  if (r.status === 401 && caminho !== 'api/login') {
    mostrarLogin();
    throw new Error('sessão');
  }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`);
  return corpo;
}

// --- Login ----------------------------------------------------------------------------------------

function mostrarLogin() {
  $('#painel').hidden = true;
  $('#login').hidden = false;
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#erro-login').textContent = '';
  try {
    await api('api/login', { method: 'POST', body: { senha: ev.target.senha.value } });
    ev.target.reset();
    $('#login').hidden = true;
    carregar();
  } catch (e) {
    $('#erro-login').textContent = e.message;
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await fetch('api/logout', { method: 'POST' });
  mostrarLogin();
});

// --- Painel ---------------------------------------------------------------------------------------

async function carregar() {
  try {
    resumo = await api('api/resumo');
  } catch (e) {
    if (e.message !== 'sessão') console.error(e);
    return;
  }
  $('#painel').hidden = false;
  desenharResumo();
  preencherConfig();
  await Promise.all([carregarGrafico(), carregarAlertas(), carregarRotas()]);
}

function desenharResumo() {
  const { config: c, estado, ultima, media, n_media: n, minimo } = resumo;
  $('#titulo-rota').textContent = `${c.origem} ⇄ ${c.destino}`;
  $('#sub-rota').textContent = `Ida ${diaMes(c.data_ida)} · Volta ${diaMes(c.data_volta)} · voos diretos · consulta a cada ${c.intervalo_min} min`;

  const ligados = estado && estado.alertas_ativos;
  const b = $('#btn-alertas');
  b.textContent = ligados ? 'Alertas ligados' : 'Alertas pausados';
  b.className = `btn ${ligados ? 'ligado' : 'desligado'}`;
  b.title = ligados ? 'Clique para pausar os alertas no WhatsApp' : 'Clique para religar os alertas no WhatsApp';

  const pedida = estado && estado.consultar_agora;
  $('#btn-consultar').disabled = pedida;
  $('#btn-consultar').textContent = pedida ? 'Consulta pedida…' : 'Consultar agora';

  $('#kpi-ultima').textContent = ultima ? brl(ultima.total) : '—';
  const det = $('#kpi-ultima-det');
  det.className = 'detalhe';
  if (ultima && media) {
    const dif = (ultima.total / media - 1) * 100;
    det.textContent = `${dataHora(ultima.ts)} · ${Math.abs(dif).toFixed(1).replace(".", ",")} % ${dif < 0 ? 'abaixo' : 'acima'} da média`;
    det.classList.add(dif < 0 ? 'abaixo' : 'acima');
  } else {
    det.textContent = ultima ? dataHora(ultima.ts) : 'Nenhuma consulta nesta rota';
  }

  $('#kpi-media').textContent = brl(media);
  $('#kpi-media-det').textContent = media ? `${n} consultas anteriores` : 'Sem histórico ainda';

  $('#kpi-gatilho').textContent = media ? brl(media * (1 - c.desconto_min)) : '—';
  $('#kpi-gatilho-det').textContent = `Alerta com total ${Math.round(c.desconto_min * 100)} % abaixo da média`;

  $('#kpi-minimo').textContent = minimo ? brl(minimo.total) : '—';
  $('#kpi-minimo-det').textContent = minimo ? dataHora(minimo.ts) : '';

  desenharVoos();
}

function linkSeguro(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function desenharVoos() {
  const { config: c, ultima, nomes_fontes: nomes } = resumo;
  const box = $('#voos');
  box.replaceChildren();
  if (!ultima) {
    box.append(el('p', { class: 'vazio' }, 'Aguardando a primeira consulta desta rota.'));
    return;
  }
  const trechos = [
    ['ida', `Ida ${diaMes(c.data_ida)} · ${c.origem} → ${c.destino}`],
    ['volta', `Volta ${diaMes(c.data_volta)} · ${c.destino} → ${c.origem}`],
  ];
  for (const [k, rotulo] of trechos) {
    const v = ultima[k];
    const link = v.link && linkSeguro(v.link);
    const fonte = nomes[v.fonte] || v.fonte;
    box.append(el('div', { class: 'voo' },
      el('span', { class: 'trecho' }, rotulo),
      el('span', {}, `${v.companhia}${v.voo ? ` ${v.voo}` : ''} · ${v.partida} → ${v.chegada}`),
      el('span', { class: 'preco' }, brl(v.preco)),
      el('span', { class: 'fonte' }, 'Fonte: ', link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, fonte) : fonte),
    ));
  }
  box.append(el('div', { class: 'voo' },
    el('span', { class: 'trecho' }, `Consulta de ${dataHora(ultima.ts)}`),
    el('strong', {}, 'Total'),
    el('span', { class: 'preco' }, brl(ultima.total)),
  ));
}

async function carregarGrafico() {
  const { pontos } = await api(`api/historico?dias=${dias}`);
  $('#grafico-vazio').hidden = pontos.length > 0;
  $('#grafico').parentElement.hidden = pontos.length === 0;
  const desconto = resumo.config.desconto_min;
  const nomes = resumo.nomes_fontes;
  const serie = (campo) => pontos.map((p) => ({ x: new Date(p.ts), y: p[campo] }));
  const data = {
    datasets: [
      {
        label: 'Total',
        data: serie('total'),
        borderColor: cor('--serie-total'),
        backgroundColor: cor('--serie-total'),
        borderWidth: 2,
        pointRadius: pontos.map((p) => (p.alertado ? 5 : 0)),
        pointHoverRadius: 4,
        tension: 0.2,
      },
      {
        label: 'Média 7 dias',
        data: pontos.map((p) => ({ x: new Date(p.ts), y: p.media })),
        borderColor: cor('--serie-media'),
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
      },
      {
        label: 'Gatilho do alerta',
        data: pontos.map((p) => ({ x: new Date(p.ts), y: p.media && p.media * (1 - desconto) })),
        borderColor: cor('--serie-gatilho'),
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        spanGaps: true,
      },
    ],
  };
  const texto = cor('--suave');
  const grade = cor('--borda');
  if (grafico) grafico.destroy();
  grafico = new Chart($('#grafico'), {
    type: 'line',
    data,
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'dd/MM HH:mm', displayFormats: { hour: 'dd/MM HH:mm', day: 'dd/MM' } }, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 16 }, grid: { color: grade } },
        y: { ticks: { color: texto, callback: (v) => brl(v) }, grid: { color: grade } },
      },
      plugins: {
        legend: { labels: { color: texto, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${brl(ctx.parsed.y)}`,
            afterBody: (itens) => {
              const p = pontos[itens[0].dataIndex];
              const linhas = [
                `Ida ${brl(p.ida)} (${nomes[p.fonte_ida] || p.fonte_ida})`,
                `Volta ${brl(p.volta)} (${nomes[p.fonte_volta] || p.fonte_volta})`,
              ];
              if (p.alertado) linhas.push('Alerta enviado');
              return linhas;
            },
          },
        },
      },
    },
  });
}

async function carregarAlertas() {
  const docs = await api('api/alertas');
  const tb = $('#alertas');
  tb.replaceChildren();
  if (!docs.length) {
    tb.append(el('tr', {}, el('td', { colspan: '5', class: 'vazio' }, 'Nenhum alerta enviado.')));
    return;
  }
  for (const d of docs) {
    tb.append(el('tr', {},
      el('td', {}, dataHora(d.ts)),
      el('td', {}, (d.rota || '').split('-').slice(0, 2).join(' ⇄ ')),
      el('td', { class: 'num' }, brl(d.ida && d.ida.preco)),
      el('td', { class: 'num' }, brl(d.volta && d.volta.preco)),
      el('td', { class: 'num' }, brl(d.total)),
    ));
  }
}

function descreverRota(r) {
  const [o, d, ...resto] = r.split('-');
  const ida = resto.slice(0, 3).join('-');
  const volta = resto.slice(3, 6).join('-');
  return `${o} ⇄ ${d} · ${diaMes(ida)} a ${diaMes(volta)}`;
}

async function carregarRotas() {
  const rotas = await api('api/rotas');
  const tb = $('#rotas');
  tb.replaceChildren();
  for (const r of rotas) {
    tb.append(el('tr', { class: r._id === resumo.rota ? 'atual' : '' },
      el('td', {}, r._id ? descreverRota(r._id) : '—'),
      el('td', { class: 'num' }, String(r.n)),
      el('td', { class: 'num' }, brl(r.minimo)),
      el('td', {}, dataHora(r.ultima)),
    ));
  }
}

// --- Ações ----------------------------------------------------------------------------------------

$('#periodo').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  dias = Number(b.dataset.dias);
  for (const x of $('#periodo').children) x.classList.toggle('ativo', x === b);
  carregarGrafico();
});

$('#btn-alertas').addEventListener('click', async () => {
  const ativo = !(resumo.estado && resumo.estado.alertas_ativos);
  await api('api/alertas-ativos', { method: 'POST', body: { ativo } });
  resumo.estado.alertas_ativos = ativo;
  desenharResumo();
});

$('#btn-consultar').addEventListener('click', async () => {
  await api('api/consultar-agora', { method: 'POST' });
  resumo.estado.consultar_agora = true;
  desenharResumo();
});

function preencherConfig() {
  const f = $('#form-config');
  const c = resumo.config;
  if (f.contains(document.activeElement)) return; // não sobrescreve o que está sendo digitado
  f.origem.value = c.origem;
  f.destino.value = c.destino;
  f.data_ida.value = c.data_ida;
  f.data_volta.value = c.data_volta;
  f.desconto_pct.value = Math.round(c.desconto_min * 100);
  f.intervalo_min.value = c.intervalo_min;
  f.data_ida.min = new Date().toISOString().slice(0, 10);
}

$('#form-config').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#msg-config');
  const mudaRota = f.origem.value.toUpperCase() !== resumo.config.origem || f.destino.value.toUpperCase() !== resumo.config.destino
    || f.data_ida.value !== resumo.config.data_ida || f.data_volta.value !== resumo.config.data_volta;
  if (mudaRota && !confirm('Rota ou datas mudaram: a média recomeça do zero para a busca nova. Continuar?')) return;
  msg.className = 'msg';
  msg.textContent = 'Salvando…';
  try {
    await api('api/config', {
      method: 'PUT',
      body: {
        origem: f.origem.value,
        destino: f.destino.value,
        data_ida: f.data_ida.value,
        data_volta: f.data_volta.value,
        desconto_pct: Number(f.desconto_pct.value),
        intervalo_min: Number(f.intervalo_min.value),
      },
    });
    msg.className = 'msg ok';
    msg.textContent = mudaRota ? 'Salvo. A primeira consulta da rota nova começa em até 30 s.' : 'Salvo.';
    document.activeElement.blur();
    carregar();
  } catch (e) {
    msg.className = 'msg erro';
    msg.textContent = e.message;
  }
});

carregar();
setInterval(() => { if (!$('#painel').hidden) carregar(); }, 60 * 1000);
