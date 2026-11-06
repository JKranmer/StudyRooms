# ADR 0004: Hospedagem gratuita (bot, API, banco e front)

- **Status:** Aceito, com ressalva: o provedor final do bot será confirmado pela prova F0-06
- **Data:** 2026-11-04 (escolha registrada em 2026-11-06)
- **Fase:** 1

## Contexto

Restrição definida pelo autor: **apenas planos gratuitos** na versão 1. Mais tarde, quando o projeto estiver certo, a hospedagem pode evoluir para algo mais complexo e pago ([ADR 0010](adr-0010-api-cloudflare-workers.md), gatilho de revisão).

| Componente | Necessidade |
|---|---|
| Front (SPA) | Arquivos estáticos |
| API | HTTP sob demanda, tolerante a cold start moderado |
| **Bot do Discord** | **Processo sempre ligado**, com conexão persistente ao Gateway |
| PostgreSQL | Dados persistentes e duradouros (o histórico de estudo é o ativo do projeto) |

## Decisão

| Componente | Escolha | Situação |
|---|---|---|
| Front | Cloudflare | Decidido pelo usuário |
| API | Cloudflare Workers ([ADR 0010](adr-0010-api-cloudflare-workers.md)) | Decidido pelo usuário |
| Banco | Neon, via Hyperdrive | Escolha confirmada pelo usuário |
| Bot | VM gratuita. Oracle Always Free como primeira opção; Northflank Sandbox e Google e2-micro como alternativas | VM gratuita: recomendação da equipe, aceita pelo usuário. Oracle: recomendação da equipe, a confirmar pela F0-06 |

**Possível vantagem a provar:** servir a SPA e a API no mesmo Worker, no domínio `workers.dev`, resolvendo o cookie de refresh na mesma origem e sem comprar domínio. Isso **não foi confirmado** nas páginas de planos lidas. A página do Hono documenta o recurso Static Assets no Worker, mas não trata do fallback de rotas da SPA nem do cookie. A F0-07 prova. Se falhar, a topologia do cookie volta a ser uma decisão do usuário.

**O bot não guarda estado durável:** os dados ficam no banco, e perder a VM significa subir de novo. Ao voltar, a reconciliação recupera quem está na call. Ela **não** recupera quem entrou e saiu durante a queda, porque o Discord não informa tempo passado. O tratamento do tempo da queda fica no ADR 0007.

## Levantamento

Consultado em **2026-11-06**, nas páginas oficiais. Os planos gratuitos mudam: reconfirme antes de depender de qualquer número abaixo.

### Cloudflare

| Produto | O que a fonte diz | Conclusão | Fonte |
|---|---|---|---|
| Workers Free | 100.000 requisições/dia e 10 ms de CPU por invocação | Atende à API, com o cuidado do ADR 0010 | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Containers | "N/A" no plano Free; incluídos no Workers Paid de US$ 5/mês | Fora da versão 1 | [pricing](https://developers.cloudflare.com/containers/pricing/) |
| Durable Objects | WebSocket de saída impede a remoção por até 15 min e "may remain open" depois, sem garantia; não há hibernação para saída | Não serve para o Gateway do bot | [websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Hyperdrive | Incluído no Free, 100.000 consultas/dia, exige Postgres externo. Driver recomendado: node-postgres, com `nodejs_compat`. A página de conexão lida não cita o Neon; a página /hyperdrive/ cita Neon e Supabase como suportados | Ligação entre Workers e Neon | [pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [visão geral](https://developers.cloudflare.com/hyperdrive/) |
| D1 | Limite de 500 MB por banco no Free. A consulta não confirmou que seja SQLite; só que não é apresentado como Postgres | Descartado para manter Postgres e Drizzle | [limits](https://developers.cloudflare.com/d1/platform/limits/) |

### Bot (hospedagem sempre ligada)

| Opção | Grátis? | Sempre ligado? | Observações | Fonte |
|---|---|---|---|---|
| Oracle Always Free | Sim, "for the life of the account" | Sim | E2.1.Micro (até 2, 1 GB) ou Ampere A1 (2 OCPU, 12 GB no total). "Idle Always Free compute instances may be reclaimed": em 7 dias, CPU p95 < 20%, rede < 20% e (só A1) memória < 20%. Bot quieto pode cair nisso. "out of host capacity" é possível. Cartão: não confirmado (a página de oferta deu 403) | [Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Northflank Sandbox | "Free", "No card needed" | "Always on, no sleeping" | 2 serviços, compute "Limited". Prazo não informado. A página exibe aviso de incidente de segurança pedindo rotação de credenciais: avaliar antes de usar | [Northflank](https://northflank.com/pricing) |
| Google Cloud e2-micro | Sem data de fim, com aviso de 30 dias | Sim | Só regiões dos EUA, 30 GB de disco, 1 GB de saída. Exige conta de faturamento. Custo de IPv4 externo não confirmado; excedente é cobrado | [Google](https://docs.cloud.google.com/free/docs/free-cloud-features) |
| Koyeb Free | "forever free" | Não: vai a zero após 1 h sem tráfego de entrada, sem desativar | Exige cartão, com retenção de US$ 29 | [preços](https://www.koyeb.com/docs/faqs/pricing), [scale-to-zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) |
| Render Free | Sim | Não: dorme após 15 min sem entrada; workers não são gratuitos | | [Render](https://render.com/docs/free) |
| Railway Free | US$ 1 de crédito/mês | RAM a US$ 10/GB/mês: provavelmente não cobre 24 h (estimativa nossa) | | [Railway](https://docs.railway.com/reference/pricing/plans) |
| Fly.io | Não há plano gratuito | | Bot 24/7 custa cerca de US$ 2,21/mês, no exemplo da própria página; exige cartão | [Fly.io](https://docs.fly.io/about/pricing) |
| AWS | Crédito de até US$ 200 por 6 meses; depois a conta é suspensa | | | [AWS](https://aws.amazon.com/free/) |
| Azure | 12 meses; VM específica não confirmada | | | [Azure](https://azure.microsoft.com/en-us/pricing/free-services) |
| GitHub Actions | Termos: só para "develop and test"; bot 24/7 fica fora | | | [Termos](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) |

### Banco

| Opção | Gratuito | Limites | Risco | Fonte |
|---|---|---|---|---|
| Neon | "permanent, not a trial, and doesn't require a credit card" | 100 CU-horas/mês por projeto (400 h a 0,25 CU), 1 GB por projeto, 5 GB de saída/mês | Suspende após 5 min sem atividade, sem pausa por inatividade; ao esgotar, fica suspenso até o próximo ciclo. Backup: 1 snapshot manual, histórico de 6 h | [preços](https://neon.com/pricing), [planos](https://neon.com/docs/introduction/plans) |
| Supabase | Sim | 500 MB, 2 projetos, 5 GB de saída | Pausa após 1 semana inativo; sem backup automático | [Supabase](https://supabase.com/pricing) |
| Aiven | "$0/month" sem limite de tempo | 1 GB, sem escolha de região nem pooling | Pode encerrar se ficar sem uso por longo período | [Aiven](https://www.aiven.io/pricing) |
| Render Postgres | Sim | 1 GB | Expira em 30 dias: descartado | [Render](https://render.com/docs/free) |
| Koyeb Postgres | Sim | 5 h de atividade, 1 GB | Pouco tempo ativo: descartado | [Koyeb](https://www.koyeb.com/docs/faqs/pricing) |

## Critérios de decisão

| # | Critério | Situação da escolha |
|---|---|---|
| 1 | O bot nunca dorme | Oracle: sempre ligada, mas a instância ociosa pode ser reclaimed. A F0-06 mede |
| 2 | O banco não expira e tem backup | Neon não expira. O backup nativo não basta, então o dump externo é obrigatório (F1-24) |
| 3 | Custo zero sem cartão, ou com cartão apenas para verificação | Neon: sem cartão. Oracle: não confirmado. Cloudflare: não consultado. Google exige conta de faturamento, o que pode ferir o critério |
| 4 | Deploy automatizável pelo GitHub Actions | Workers: a página do Hono documenta. Bot: a provar na F0-06 |
| 5 | Migração para outro provedor em um dia | Mantido: Hono portátil para Node, Postgres padrão e bot em container. Ainda não exercitado |

## Consequências e restrições

### Neon e sinais frequentes

Cada escrita acorda o banco, que só suspende após 5 min sem atividade. Um sinal a cada minuto (heartbeat do bot ou do timer) impediria a suspensão e gastaria as 400 h em cerca de 17 dias, deixando o banco suspenso até o próximo ciclo. **Sinais frequentes não podem tocar o banco a cada envio.**

**Decisão do usuário:** sinal em memória na VM e gravação periódica a cada 30 min, cerca de 120 h por mês. Essa conta vale para uma única série de gravações, sem o resto do uso. O ADR 0007 define a regra de fechamento das órfãs dentro dessa restrição.

Consequências:

- Se o processo do bot morrer, o último sinal em memória se perde, e o fim da sessão órfã pode errar em até 30 min.
- O timer guarda o tempo até o último sinal recebido, mas não passa pela VM. Como aplicar o intervalo a ele fica para a implementação do timer, com duas atenções: fechar o site sem aviso pode perder até um intervalo, e gravações fora de sincronia com as do bot somam horas acordadas além das 120 h.
- Qualquer verificador periódico de órfãs também acorda o banco e entra nessa conta.

Estimativa nossa do tempo acordado com gravações periódicas 24 h por dia, a 0,25 CU, sem contar o resto do uso:

| Gravação a cada | Horas por mês (de 400) |
|---|---|
| 5 min ou menos | 720: nunca suspende |
| 10 min | 360 |
| 15 min | 240 |
| 30 min | 120 |

Opções consideradas:

| Opção | Custo no banco | Limitação |
|---|---|---|
| A. Sinal do bot em memória na VM; o banco só recebe eventos reais e a reconciliação (**escolhida, com B**) | Mínimo | Perdendo o processo, o horário do último sinal se perde |
| B. Gravação periódica de um único sinal do bot (não um por sessão), só com sessão aberta (**escolhida, a cada 30 min**) | Tabela acima | O fim da sessão órfã erra até um intervalo |
| C. Guardar o sinal fora do Postgres (por exemplo, KV ou Durable Objects) | Só ao consolidar | Limites gratuitos ainda não consultados |
| D. Timer: último sinal guardado no navegador e enviado na volta | Só em eventos | Perde o sinal se a pessoa não voltar |

### Fase 1 aberta e limites compartilhados

Sem allowlist, todos os usuários dividem as 400 h, 1 GB e os limites diários. Ao esgotar o Neon, o site e a coleta param até o próximo ciclo, e o que ocorrer nesse período pode se perder. O monitoramento (F1-25) precisa acompanhar esse consumo.

### Backup (a implementar na F1-24)

O backup nativo do Neon não protege o histórico, então é preciso um dump externo.

**Decisão do usuário:** o dump diário roda pela VM. O destino continua em aberto, com levantamento pendente. Pontos a tratar:

- se a F0-06 levar a um provedor sem VM, como o Northflank Sandbox, é preciso rever onde o dump roda;
- a VM precisa de uma credencial só de leitura, separada, já que o bot grava pela API;
- o dump acorda o banco e provavelmente consome a saída de 5 GB/mês (não confirmado);
- a retenção precisa respeitar a exclusão de conta: backups expiram em até 30 dias.

Os termos do GitHub Actions restringem usos não ligados ao desenvolvimento ("develop and test"; em runners hospedados, nada "unrelated to the production, testing, deployment, or publication" do projeto). Não apoiar o backup no Actions sem revisar.

### Docker

Revisa o texto anterior, "todo o projeto é empacotado em Docker desde o início". Docker agora vale para o **bot** e para o **banco local**. API e front rodam localmente com Wrangler. A reversibilidade da API vem da portabilidade do Hono para Node.

### Oracle Always Free

A imagem do bot precisa rodar na arquitetura escolhida (x86 no E2.1.Micro, ARM no A1). A F0-06 observa o risco de reclaim por 7 dias, além das 72 h de estabilidade. Se os três limites forem cumulativos, um A1 com pouca memória alocada pode ficar acima de 20% de memória; a redação lida não permite afirmar isso.

### Plano de saída

- **Bot:** Northflank Sandbox ou Google e2-micro, ou outra máquina com o mesmo container.
- **Banco:** restaurar o dump em outro Postgres gratuito (Supabase ou Aiven têm limites diferentes).
- **API:** Hono em Node, em servidor próprio.

## Alternativas consideradas

- **Bot, API e Postgres em uma única VM** (direção proposta em 2026-11-04): elimina o limite de CPU e o de horas do banco, mas concentra tudo em uma máquina que pode ser reclaimed e obriga a operar o banco. O usuário preferiu API e front na Cloudflare e banco em outro provedor gratuito.
- **Bot na Cloudflare:** descartado. Containers não existem no plano Free, e Durable Objects não garantem a conexão de saída.
- **Sem VM, com um Worker agendado consultando [`GET /guilds/{guild.id}/voice-states/{user.id}`](https://docs.discord.com/developers/resources/voice.md) a cada minuto:** descartado por decisão do usuário. Decisão: seguir com o bot conectado; a consulta fica como opção a rever se a hospedagem da VM falhar. Motivos (fontes consultadas em 2026-11-06):
  - A documentação do Discord não oferece voz por [webhook](https://docs.discord.com/developers/events/webhook-events); só pelo Gateway.
  - A precisão fica em cerca de 1 min.
  - O Workers Free tem [50 subrequests por invocação e 5 Cron Triggers por conta](https://developers.cloudflare.com/workers/platform/limits/), e não há endpoint que liste todos os estados de voz de um servidor. Isso limita a escala numa Fase 1 aberta.
  - O backup precisaria sair da VM.
  - Nunca testados: a resposta para quem não está em call e se o bot precisa ter conectado ao Gateway.

## Pendências

- [ ] F0-06: bot no provedor candidato, com resultado medido (72 h de estabilidade e 7 dias de observação na Oracle); define o provedor final.
- [ ] F0-07: SPA e API no mesmo Worker e cookie de refresh.
- [ ] Levantar e escolher o destino do backup.
- [ ] F1-24: backup externo e restauração testada.
- [ ] Confirmar a exigência de cartão na Oracle e na Cloudflare.
