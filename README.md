# buscador-precos

Front do buscador de passagens: páginas estáticas (HTML, CSS e JS sem build) servidas pelo nginx em
https://pedro.tradehunter.com.br/passagens/. Conversa com o backend (Rust, outro repositório) em
`/passagens/api/`.

## Telas

| Hash | Tela |
|---|---|
| `#/entrar` | login por celular + senha; aparelho novo pede código no WhatsApp |
| `#/cadastro` | nome, celular, senha → código no WhatsApp confirma o número |
| `#/esqueci` | código no WhatsApp → senha nova |
| `#/codigo` | confirmação do código (cadastro, login ou senha) |
| `#/alertas` | lista dos alertas do usuário |
| `#/novo` | novo alerta: ida e volta ou só ida, só diretos ou com escalas, origem e destino com busca (cidade, aeroporto, país ou código; agrupada por país, Brasil primeiro), datas, % abaixo da média, intervalo (mín. 5 min) |
| `#/novo/<id>` | novo alerta partindo de outro (Duplicar): mesma rota, datas e regra |
| `#/alertas/<id>` | gráfico do total com média móvel de 7 dias e gatilho, voos mais baratos, estado das fontes, edição |
| `#/conta` | nome, troca de senha, sair de todos os aparelhos, apagar conta |

A lista de aeroportos vem do backend (`/passagens/api/aeroportos`) uma vez por sessão.

`public/vendor/` traz Chart.js 4 e o adaptador de datas (date-fns), sem CDN: a CSP da página só
permite scripts do próprio domínio.

## Publicar

O nginx lê direto de `public/` neste diretório (`/var/www/pedro.tradehunter.com.br/buscador-precos`):
o que está na `main` aqui é o que está no ar.
