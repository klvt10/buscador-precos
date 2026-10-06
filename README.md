# buscador-precos

Front do buscador de passagens e de empregos: páginas estáticas (HTML, CSS e JS sem build) servidas pelo nginx na raiz de
https://pedro.tradehunter.com.br/. As telas são caminhos de verdade (History API): o nginx devolve
`index.html` para qualquer caminho que não seja arquivo, e os arquivos são pedidos com caminho absoluto
(`/app.js`, `/style.css`, `/vendor/…`). Conversa com o backend (Rust, outro repositório) em `/api/`.

## Telas

| Caminho | Tela |
|---|---|
| `/entrar` | login por celular + senha; aparelho novo pede código no WhatsApp |
| `/cadastro` | nome, celular, senha → código no WhatsApp confirma o número |
| `/esqueci` | código no WhatsApp → senha nova |
| `/codigo` | confirmação do código (cadastro, login ou senha) |
| `/passagens` | lista dos alertas de passagem do usuário |
| `/passagens/nova` | novo alerta: ida e volta ou só ida, só diretos ou com escalas, origem e destino com busca (cidade, aeroporto, país ou código; agrupada por país, Brasil primeiro), datas, % abaixo da média, intervalo (mín. 5 min) |
| `/passagens/nova/<id>` | novo alerta partindo de outro (Duplicar): mesma rota, datas e regra |
| `/passagens/<id>` | gráfico do total com média móvel de 7 dias e gatilho, voos mais baratos, estado das fontes, edição (`/passagens/<id>/editar` abre a mesma tela já na edição) |
| `/admin` | administração (só admin): visão geral, sites (situação, chave, saída e reserva com recomendação), alertas ligados e usuários; abas em `/admin/sites`, `/admin/alertas`, `/admin/usuarios`, `/admin/empregos` |
| `/admin/alertas/<id>` | detalhe de qualquer alerta, só leitura (só admin) |
| `/conta` | nome, troca de senha, sair de todos os aparelhos, apagar conta |
| `/empregos` | buscas de emprego do usuário (até 3): profissão, cidades ou “Brasil inteiro”, termos, contadores novos/total/favoritos, última coleta, coleta ligada/pausada, selo do alerta (ligado/desligado, com atalho), Buscar agora (1 a cada 10 min) |
| `/empregos/nova` | nova busca, só o escopo da coleta: onde procurar (Brasil inteiro, sem cidades, ou cidades específicas), profissão, termos do título (sugeridos pelo servidor ao sair do campo profissão), 1 a 3 cidades com UF, remoto de qualquer lugar, concursos, ligada |
| `/empregos/<id>/editar` | edição do escopo da busca e Apagar busca |
| `/empregos/<id>/alerta` | alerta no WhatsApp da busca: ligado, modelo, contrato, salário mínimo e sem salário, palavras que descartam, fontes, concursos, horário; Enviar teste agora (critérios salvos) |
| `/empregos/<id>?filtros` | resultados da busca: abas Novos, Todos, Favoritos e Arquivados com contagem; filtros aplicados no servidor e guardados na query do endereço (`modelo`, `contrato`, `fonte` em lista; `salario_min`, `sem_salario=0`, `dias`, `q`, `uf`, `ordenar`), contagens por modelo/contrato/fonte, total, Limpar filtros, 30 por página; cartões de altura igual com badges por modelo, contrato, fonte e UF de concurso (mesmas cores nos filtros); cada vaga com Abrir vaga, Visto, Favorito e Arquivar (sem confirmação; em Arquivados, Restaurar volta para Novos); concurso com link do edital |
| `/admin/empregos` | administração de Empregos (só admin): números do dia, vagas novas por fonte em 14 dias, fontes com ligar/desligar, todas as buscas (situação, alerta ligado/desligado, Coletar), coletas e envios recentes |

`/` leva a `/empregos` (ou a `/entrar`, sem sessão); caminho desconhecido também vai para `/empregos`.
Endereços antigos com `#` (`/passagens/#/alertas/<id>`, `#/empregos/<id>?…`, `#/admin/…`) são convertidos
no carregamento para o caminho novo (`#/alertas` → `/passagens`, `#/novo[/<id>]` → `/passagens/nova[/<id>]`,
o resto igual sem o `#`), sem recarregar.

A barra de cima tem duas abas principais, **Passagens** (`/passagens…`) e **Empregos** (`/empregos…`), mais
Conta e Administração; marca, título e aba ativa (`aria-current`) seguem o endereço. Links internos navegam
sem recarregar a página (o voltar do navegador funciona). Empregos conversa com `/api/empregos/…`
(mesma sessão).

Empregos: badges cheios com cor fixa por valor (modelo: presencial azul, híbrido âmbar, remoto verde, não
informado cinza; contrato; fonte: Adzuna ciano, Gupy roxo, Infojobs rosa, Empregos.com.br laranja, Remotar
esmeralda, PCI Concursos índigo), a mesma cor no cartão, nos chips de filtro (contorno; cheio quando marcado) e
no gráfico e nos cartões da administração; tokens `--emp-cor-<valor>` e `--emp-cor-<valor>-txt` no `style.css`.
O badge da fonte traz o nome e, ao lado, "também em" com mini-badges das outras fontes onde a mesma vaga apareceu; fontes aparecem pelo nome (Adzuna, Gupy, PCI Concursos, Infojobs, Empregos.com.br,
Remotar) no cartão, nos filtros, no alerta e na administração. Vaga sem modelo mostra "Modelo não informado";
os filtros de modelo e contrato têm "Não informado" (`nao_informado`). Com a busca coletando, cartão e
resultados mostram "Buscando vagas…" (Buscar agora desabilitado) e os resultados se atualizam a cada 15 s até
a coleta terminar.

A lista de aeroportos vem do backend (`/api/aeroportos`) uma vez por sessão.

`public/vendor/` traz Chart.js 4 e o adaptador de datas (date-fns), sem CDN: a CSP da página só
permite scripts do próprio domínio.

## Publicar

O nginx lê direto de `public/` neste diretório (`/var/www/pedro.tradehunter.com.br/buscador-precos`):
o que está na `main` aqui é o que está no ar. Antes de cada commit que mexe em `public/`, rodar
`scripts/versionar.sh` (carimba `?v=<hash>` em `/app.js`, `/style.css`, `/tema.js` e `/vendor/…`).
