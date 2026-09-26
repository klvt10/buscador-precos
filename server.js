// Painel do robô de passagens: lê e edita a collection `pedro.passagens` (consultas, estado e config).
// O robô relê `_id: "config"` a cada volta do loop; nada aqui consulta fontes de preço.

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.PORT || 10066);
const HOST = process.env.HOST || '127.0.0.1';
const MONGO_URI = process.env.MONGO_DE_URI;
const SENHA = process.env.PAINEL_SENHA;
const SEGREDO = process.env.PAINEL_SEGREDO;
if (!MONGO_URI || !SENHA || !SEGREDO) {
  console.error('faltam MONGO_DE_URI, PAINEL_SENHA ou PAINEL_SEGREDO');
  process.exit(1);
}

const JANELA_MS = 7 * 24 * 3600 * 1000; // média móvel de 7 dias, igual ao robô
const SESSAO_MS = 30 * 24 * 3600 * 1000;
const COOKIE = 'painel';
const NOMES_FONTES = {
  google: 'Google Flights',
  '123milhas': '123milhas',
  maxmilhas: 'MaxMilhas',
  kayak: 'Kayak',
  latam: 'site da LATAM',
  gol: 'site da GOL',
  skyscanner: 'Skyscanner',
};

const rota = (c) => `${c.origem}-${c.destino}-${c.data_ida}-${c.data_volta}`;

// --- Sessão: cookie assinado com HMAC -------------------------------------------------------------

function assinar(exp) {
  return `${exp}.${crypto.createHmac('sha256', SEGREDO).update(String(exp)).digest('hex')}`;
}

function sessaoValida(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp] = m[1].split('.');
  const esperado = assinar(exp);
  return m[1].length === esperado.length
    && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(esperado))
    && Number(exp) > Date.now();
}

function senhaConfere(s) {
  const a = crypto.createHash('sha256').update(String(s || '')).digest();
  const b = crypto.createHash('sha256').update(SENHA).digest();
  return crypto.timingSafeEqual(a, b);
}

// Freio simples contra força bruta: 10 tentativas erradas por IP a cada 15 min.
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 10 && Date.now() - t.desde < 15 * 60 * 1000;
}
function errou(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde >= 15 * 60 * 1000) tentativas.set(ip, { n: 1, desde: Date.now() });
  else t.n += 1;
}

// --- App ------------------------------------------------------------------------------------------

async function main() {
  const cliente = await new MongoClient(MONGO_URI).connect();
  const col = cliente.db('pedro').collection('passagens');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    if (bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Tente de novo em 15 minutos.' });
    if (!senhaConfere(req.body && req.body.senha)) {
      errou(ip);
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }
    tentativas.delete(ip);
    const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.set('Set-Cookie', `${COOKIE}=${assinar(Date.now() + SESSAO_MS)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSAO_MS / 1000}${seguro ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => (sessaoValida(req) ? next() : res.status(401).json({ erro: 'Sessão expirada.' })));

  const lerConfig = async () => col.findOne({ _id: 'config' });

  // Resumo: config, estado, última consulta da rota atual, média móvel e fontes.
  app.get('/api/resumo', async (req, res) => {
    const [config, estado] = await Promise.all([lerConfig(), col.findOne({ _id: 'estado' })]);
    if (!config) return res.status(503).json({ erro: 'O robô ainda não criou a configuração.' });
    const r = rota(config);
    const ultima = await col.findOne({ tipo: 'consulta', rota: r }, { sort: { ts: -1 } });
    let media = null;
    let n = 0;
    if (ultima) {
      const [agg] = await col.aggregate([
        { $match: { tipo: 'consulta', rota: r, ts: { $lt: ultima.ts, $gte: new Date(ultima.ts - JANELA_MS) } } },
        { $group: { _id: null, media: { $avg: '$total' }, n: { $sum: 1 } } },
      ]).toArray();
      if (agg) ({ media, n } = agg);
    }
    const [minimo] = await col.find({ tipo: 'consulta', rota: r }).sort({ total: 1 }).limit(1).toArray();
    const total = await col.countDocuments({ tipo: 'consulta', rota: r });
    res.json({
      config,
      rota: r,
      estado: estado && {
        alertas_ativos: estado.alertas_ativos,
        ultimo_alerta: estado.ultimo_alerta,
        ultimo_alerta_total: estado.ultimo_alerta_total,
        consultar_agora: !!estado.consultar_agora,
      },
      ultima,
      media,
      n_media: n,
      minimo: minimo || null,
      total_consultas: total,
      nomes_fontes: NOMES_FONTES,
    });
  });

  // Série para o gráfico (rota atual por padrão) com a média móvel de 7 dias calculada ponto a ponto.
  app.get('/api/historico', async (req, res) => {
    const config = await lerConfig();
    const r = typeof req.query.rota === 'string' ? req.query.rota : rota(config);
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
    const docs = await col
      .find({ tipo: 'consulta', rota: r, ts: { $gte: new Date(desde - JANELA_MS) } },
        { projection: { ts: 1, total: 1, 'ida.preco': 1, 'ida.fonte': 1, 'volta.preco': 1, 'volta.fonte': 1, alertado: 1 } })
      .sort({ ts: 1 })
      .toArray();
    // Janela deslizante: média das consultas ANTERIORES dentro de 7 dias (a mesma regra do alerta).
    let ini = 0;
    let soma = 0;
    const pontos = [];
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      while (ini < i && docs[ini].ts < d.ts - JANELA_MS) soma -= docs[ini++].total;
      const n = i - ini;
      if (d.ts >= desde) {
        pontos.push({
          ts: d.ts,
          total: d.total,
          ida: d.ida && d.ida.preco,
          volta: d.volta && d.volta.preco,
          fonte_ida: d.ida && d.ida.fonte,
          fonte_volta: d.volta && d.volta.fonte,
          media: n ? soma / n : null,
          alertado: !!d.alertado,
        });
      }
      soma += d.total;
    }
    res.json({ rota: r, pontos });
  });

  app.get('/api/alertas', async (req, res) => {
    const docs = await col.find({ tipo: 'consulta', alertado: true }).sort({ ts: -1 }).limit(50).toArray();
    res.json(docs);
  });

  app.get('/api/rotas', async (req, res) => {
    const rotas = await col.aggregate([
      { $match: { tipo: 'consulta' } },
      { $group: { _id: '$rota', n: { $sum: 1 }, ultima: { $max: '$ts' }, minimo: { $min: '$total' } } },
      { $sort: { ultima: -1 } },
    ]).toArray();
    res.json(rotas);
  });

  app.post('/api/alertas-ativos', async (req, res) => {
    if (typeof (req.body && req.body.ativo) !== 'boolean') return res.status(400).json({ erro: 'Valor inválido.' });
    await col.updateOne({ _id: 'estado' }, { $set: { alertas_ativos: req.body.ativo } });
    res.json({ ok: true });
  });

  app.post('/api/consultar-agora', async (req, res) => {
    await col.updateOne({ _id: 'estado' }, { $set: { consultar_agora: true } });
    res.json({ ok: true });
  });

  app.put('/api/config', async (req, res) => {
    const b = req.body || {};
    const iata = (s) => typeof s === 'string' && /^[A-Za-z]{3}$/.test(s.trim());
    const data = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    const erros = [];
    if (!iata(b.origem) || !iata(b.destino)) erros.push('Origem e destino são códigos de aeroporto de 3 letras.');
    else if (b.origem.trim().toUpperCase() === b.destino.trim().toUpperCase()) erros.push('Origem e destino iguais.');
    if (!data(b.data_ida) || !data(b.data_volta)) erros.push('Datas inválidas.');
    else if (b.data_volta < b.data_ida) erros.push('A volta é antes da ida.');
    else if (b.data_ida < new Date().toISOString().slice(0, 10)) erros.push('A data da ida já passou.');
    const desconto = Number(b.desconto_pct) / 100;
    if (!(desconto >= 0.01 && desconto <= 0.9)) erros.push('Desconto entre 1 % e 90 %.');
    const intervalo = Number(b.intervalo_min);
    if (!(Number.isInteger(intervalo) && intervalo >= 10 && intervalo <= 720)) erros.push('Intervalo entre 10 e 720 minutos.');
    if (erros.length) return res.status(400).json({ erro: erros.join(' ') });
    const nova = {
      origem: b.origem.trim().toUpperCase(),
      destino: b.destino.trim().toUpperCase(),
      data_ida: b.data_ida,
      data_volta: b.data_volta,
      desconto_min: Math.round(desconto * 1000) / 1000,
      intervalo_min: intervalo,
      atualizado_em: new Date(),
    };
    await col.updateOne({ _id: 'config' }, { $set: nova }, { upsert: true });
    res.json({ ok: true, rota: rota(nova) });
  });

  app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist'), { index: false }));
  app.use('/vendor/date-fns', express.static(path.join(__dirname, 'node_modules/chartjs-adapter-date-fns/dist'), { index: false }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).json({ erro: 'Erro interno.' });
  });

  app.listen(PORT, HOST, () => console.log(`painel em http://${HOST}:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
