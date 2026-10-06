# buscador-precos

Front do buscador de passagens e de empregos: páginas estáticas (HTML, CSS e JS sem build) servidas pelo nginx em
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
| `#/admin` | administração (só admin): visão geral, sites (situação, chave, saída e reserva com recomendação), alertas ligados e usuários; abas em `#/admin/sites`, `/alertas`, `/usuarios` |
| `#/admin/alertas/<id>` | detalhe de qualquer alerta, só leitura (só admin) |
| `#/conta` | nome, troca de senha, sair de todos os aparelhos, apagar conta |
| `#/empregos` | buscas de emprego do usuário (até 3): profissão, cidades, condições, contadores novos/total/favoritos, última coleta, Buscar agora (1 a cada 10 min), ligar/pausar e aviso no WhatsApp |
| `#/empregos/nova` | nova busca: profissão, termos do título (sugeridos pelo servidor ao sair do campo profissão), palavras a excluir, 1 a 3 cidades com UF, remoto, modelo, contrato, salário mínimo por mês, concursos, WhatsApp |
| `#/empregos/<id>/editar` | edição da busca e Apagar busca |
| `#/empregos/<id>` | achados da busca: Novos, Todos ou Favoritos, 30 por página; cada vaga com Abrir vaga, Visto, Favorito e Descartar (esconde esse empregador + título para sempre); concurso com link do edital |
| `#/admin/empregos` | administração de Empregos (só admin): números do dia, vagas novas por fonte em 14 dias, fontes com ligar/desligar, todas as buscas com Coletar, coletas e envios recentes |

A barra de cima tem duas abas principais, **Passagens** (alertas, `#/alertas`, `#/novo`…) e **Empregos**
(`#/empregos…`), mais Conta e Administração; marca, título e aba ativa (`aria-current`) seguem o endereço.
Empregos conversa com `/passagens/api/empregos/…` (mesma sessão).

A lista de aeroportos vem do backend (`/passagens/api/aeroportos`) uma vez por sessão.

`public/vendor/` traz Chart.js 4 e o adaptador de datas (date-fns), sem CDN: a CSP da página só
permite scripts do próprio domínio.

## Publicar

O nginx lê direto de `public/` neste diretório (`/var/www/pedro.tradehunter.com.br/buscador-precos`):
o que está na `main` aqui é o que está no ar.
