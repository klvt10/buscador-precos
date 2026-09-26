'use strict';

const $ = (s, raiz = document) => raiz.querySelector(s);
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

// --- Alertas ------------------------------------------------------------------------------------

function descricao(a) {
  const volta = a.data_volta ? ` a ${diaMes(a.data_volta)}` : ' (só ida)';
  return `${diaMes(a.data_ida)}${volta} · a cada ${a.intervalo_min} min · alerta ${Math.round(a.desconto_min * 100)} % abaixo da média`;
}

function titulo(a) {
  return `${a.origem} ${a.data_volta ? '⇄' : '→'} ${a.destino}`;
}

async function telaAlertas() {
  const t = montar('t-alertas');
  const carregar = async () => {
    const r = await api('alertas');
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

function formAlerta(lugar, alerta) {
  lugar.replaceChildren($('#t-form-alerta').content.cloneNode(true));
  const f = $('form', lugar);
  f.data_ida.min = hojeISO();
  f.data_volta.min = hojeISO();
  if (alerta) {
    $('[data-titulo]', f).textContent = 'Editar alerta';
    f.nome.value = alerta.nome || '';
    f.origem.value = alerta.origem;
    f.destino.value = alerta.destino;
    f.data_ida.value = alerta.data_ida;
    f.data_volta.value = alerta.data_volta || '';
    f.desconto_pct.value = Math.round(alerta.desconto_min * 100);
    f.intervalo_min.value = alerta.intervalo_min;
    f.ativo.checked = alerta.ativo;
    $('[data-cancelar]', f).hidden = true;
  }
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const body = {
      nome: f.nome.value,
      origem: f.origem.value,
      destino: f.destino.value,
      data_ida: f.data_ida.value,
      data_volta: f.data_volta.value || null,
      desconto_pct: Number(f.desconto_pct.value),
      intervalo_min: Number(f.intervalo_min.value),
      ativo: f.ativo.checked,
    };
    if (alerta) {
      const muda = body.origem.toUpperCase() !== alerta.origem || body.destino.toUpperCase() !== alerta.destino
        || body.data_ida !== alerta.data_ida || (body.data_volta || null) !== (alerta.data_volta || null);
      if (muda && !confirm('Rota ou datas mudaram: a média recomeça do zero. Continuar?')) return;
    }
    const msg = $('[data-msg]', f);
    msg.className = 'msg';
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

function telaNovo() {
  const t = montar('t-alertas');
  $('.topo', t).replaceChildren(el('div', {}, el('p', { class: 'sub' }, el('a', { href: '#/alertas' }, '← Meus alertas')), el('h1', {}, 'Novo alerta')));
  formAlerta($('[data-lista]', t), null);
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
    $('[data-sub]', t).textContent = descricao(a);
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
    await carregar(false);
  } catch (e) {
    $('#tela').replaceChildren(el('section', { class: 'conteudo' }, el('p', {}, e.message), el('a', { href: '#/alertas' }, '← Meus alertas')));
    return;
  }
  formAlerta($('[data-form-lugar]', t), dados.alerta);
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
  if (h === '#/conta') return telaConta();
  const m = h.match(/^#\/alertas\/([0-9a-f]{24})$/);
  if (m) return telaDetalhe(m[1]);
  return telaAlertas();
}

window.addEventListener('hashchange', rota);
rota();
