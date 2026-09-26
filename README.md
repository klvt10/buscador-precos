# buscador-precos

Painel web do robô de passagens aéreas. Mostra o histórico do total ida + volta com a média móvel de
7 dias e o gatilho do alerta, os voos mais baratos da última consulta, os alertas enviados e permite
pausar/religar os alertas, antecipar uma consulta e trocar rota, datas, desconto e intervalo.

Lê e grava a collection `pedro.passagens` do MongoDB:

| Documento | Uso |
|---|---|
| `tipo: "consulta"` | uma por consulta do robô: `ts`, `rota`, `ida`, `volta`, `total`, `alertado` |
| `_id: "estado"` | `alertas_ativos`, `ultimo_alerta`, `consultar_agora` |
| `_id: "config"` | `origem`, `destino`, `data_ida`, `data_volta`, `desconto_min`, `intervalo_min` — o robô relê a cada 30 s |

`rota` = `ORIGEM-DESTINO-IDA-VOLTA`; a média só usa consultas da mesma rota.

## Rodar

```sh
npm install
MONGO_DE_URI=... PAINEL_SENHA=... PAINEL_SEGREDO=... npm start
```

| Variável | Padrão | |
|---|---|---|
| `MONGO_DE_URI` | — | conexão do MongoDB |
| `PAINEL_SENHA` | — | senha de acesso ao painel |
| `PAINEL_SEGREDO` | — | chave HMAC do cookie de sessão |
| `PORT` | `10066` | |
| `HOST` | `127.0.0.1` | |
