# Roadmap do StudyRooms

Aprovado com pendências em 2026-11-06. Revisado em 2026-11-09 para incluir a [coleta antecipada](#trilha-de-coleta-antecipada) (D-26) e a [base de login e dashboard em paralelo](#trilha-paralela-base-de-login-e-dashboard) (D-28); no mesmo dia, os pontos a confirmar dessa revisão viraram as decisões D-29 a D-32. Revisado de novo em 2026-11-09 com D-33 a D-41: TypeScript 6 com ESLint, regras de meia-noite e AFK, Recharts e o novo [bloco I, de atividades e categorias](#bloco-i-atividades-e-categorias). Atualizado em 2026-11-09 com a F1-47 concluída e as [pendências que ela deixou](#notas-da-f1-47). Atualizado de novo em 2026-11-09 com D-42 a D-48 resolvidas (o usuário aceitou as recomendações da Nina) e as [contas criadas na Oracle e no Neon](#contas-criadas-u-03). Atualizado em 2026-11-10 com a F0-12 concluída, a preparação da F1-48 aprovada (aguardando o usuário executar o runbook do Neon), as informações da Oracle para a F0-06 e as decisões D-49 e D-50 em aberto. As pendências estão em [Em aberto](#em-aberto). Tecnologias: ver `README.md` e `docs/adr/`.

Referências usadas neste plano: **D-xx** são decisões do usuário, **U-xx** são pré-requisitos do usuário e **S-xx** são suposições aceitas. Os IDs das atividades são estáveis e não seguem a ordem de execução: novas atividades recebem o próximo número, e as tabelas estão na ordem recomendada.

Branches: `dev` integra e `main` guarda o que está estável. Os commits são feitos direto em `dev`, sem PR nem branch curta (D-12). Levar `dev` para `main` depende de o usuário considerar estável.

## Visão geral e ordem de execução

| Ordem | Etapa | Entrega | Por que nesta posição |
|---|---|---|---|
| 1 | Linha do bot da Fase 0 e [coleta antecipada](#trilha-de-coleta-antecipada) | Bot na Oracle, 24 h por dia, gravando eventos brutos de voz no Neon, com backup local | O Discord não informa tempo passado: cada dia sem coleta é dado perdido para sempre. Prioridade do usuário (D-26) |
| 1, em paralelo | [Base de login e dashboard](#trilha-paralela-base-de-login-e-dashboard), local | Base da SPA (Lia), base da API (Rafa) e rascunho dos ADRs que bloqueiam o login | Não depende de conta externa (D-28). Rafa prioriza a coleta e avança aqui enquanto espera as contas |
| 2 | Linha da API da Fase 0 e F0-08 | Hono provado em Workers com Neon, HTTPS e cookie de refresh comprovados, provedor do bot confirmado | Depende da conta na Cloudflare, criada só na F0-10 (D-27) |
| 3 | Fase 1, blocos A e B | Monorepo, CI, banco, ADRs de modelagem e schema | O schema depende de decisões que ficam caras de mudar com dados reais |
| 4 | Fase 1, blocos C, D e E | Login, consentimento, privacidade e coleta pela API, aberta a qualquer pessoa | Encerra a exceção da coleta antecipada (D-26) |
| 5 | Fase 1, blocos F e G | Cálculos, timer, registro manual e dashboard | Como a regra é aplicada na leitura, o dashboard já nasce com os dados da coleta antecipada. O bloco F é lógica pura e pode começar em paralelo ao bloco C |
| 5, em seguida | Fase 1, bloco I | Atividades e categorias: cadastro, ligação de canal a atividade, seleção no timer e no manual, correção no dashboard e gráficos por categoria | Depende do login, das sessões e das regras de contagem. Os contratos e a lógica (F1-51 e F1-56) podem começar junto com o bloco F |
| 6 | Fase 1, bloco H | Documentação e uso diário comprovado | Encerra a fase e libera a Fase 2 |
| 7 | Fase 2 | Salas em tempo real | Só começa com a Fase 1 em produção |

## Fase 0: spike do bot e deploy de prova

Saída da fase: F0-08 concluída, com a ressalva do provedor do bot encerrada no ADR 0004 e o Hono aprovado na prova do ADR 0010. O Neon já está decidido (D-23), mas F0-11 ainda precisa provar que ele suspende com o Hyperdrive conectado.

Depois de F0-01, há duas linhas que podem andar em paralelo: bot (F0-02, F0-03, F0-04, F0-12, F0-06) e API (F0-10, F0-11, F0-07). A linha do bot agora leva à [coleta antecipada](#trilha-de-coleta-antecipada) e vem primeiro. A linha da API espera a conta na Cloudflare (D-27). A observação de F0-06 corre sozinha, já com a coleta ligada, enquanto a linha da API avança.

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F0-09 | Criar a branch `dev` a partir da `main`. | Nina | nenhuma | `dev` existe e aponta para o mesmo commit da `main` no momento da criação. A publicação no remoto segue D-12. | concluída | sem commit |
| F0-01 | Criar o workspace pnpm mínimo com `apps/bot` e `.env.example`. | Rafa | F0-09 | Em clone limpo, `pnpm install --frozen-lockfile` e o typecheck de `apps/bot` terminam com código 0; `.env.example` documenta as variáveis, sem valores reais. | concluída | `chore(repo): cria workspace mínimo com apps/bot` |
| F0-05 | Confirmar o que o levantamento do ADR 0004 deixou em aberto. | Rafa | nenhuma | ADR 0004 responde, com link oficial e data, se Oracle e Cloudflare exigem cartão e se a exigência fere o critério 3; o que seguir sem resposta fica marcado como não confirmado. | concluída, com ressalva ([notas](#notas-da-fase-0)) | `docs(adr): registra verificação dos planos gratuitos` |
| F0-02 | Logar no console entrada, saída e troca de canal de voz. | Rafa | F0-01, U-01, U-02, U-06 | Roteiro manual: entrar, trocar e sair geram 3 linhas com tipo, canal e horário UTC; mutar ou transmitir não gera linha; conta fora da allowlist de teste não aparece no log; o código não usa intent privilegiada nem lê mensagens. A allowlist existe só no spike, por privacidade. | concluída ([notas](#notas-da-fase-0)) | `feat(bot): loga eventos de voz no console` |
| F0-03 | Provar que o bot enxerga quem já está na call ao iniciar e que sobrevive a reconexões. | Rafa | F0-02 | Iniciar com a conta de teste na call gera log do estado atual; após queda de rede simulada, o bot reconecta sozinho e volta a logar eventos; o relatório diz, com teste, se a intent `guilds` é necessária além de `guild_voice_states`. O resultado alimenta o ADR 0007. Trata também os problemas conhecidos atribuídos a ela nas [notas](#notas-da-fase-0). | concluída ([notas](#notas-da-fase-0)) | `feat(bot): loga estado de voz na inicialização e reconexões` |
| F0-04 | Empacotar o bot em Docker. | Rafa | F0-02, U-05 | `docker compose up bot` repete o roteiro de F0-02; o token não aparece em `docker history` nem em `docker inspect` da imagem; Ctrl+C (ou `docker compose stop`) encerra o bot também com login ou reconexão pendente; com o bot saindo com código 1, a política de reinício não entra em laço. Trata também os problemas conhecidos atribuídos a ela nas [notas](#notas-da-fase-0). | aguardando roteiro manual do usuário ([notas](#notas-da-fase-0)) | `build(bot): adiciona Dockerfile e compose do bot` |
| F0-12 | Fazer o bot voltar sozinho na VM sem entrar em laço. | Rafa | F0-04 | Verificável localmente com Docker: erro de rede no login faz o bot tentar de novo dentro do processo, com espera crescente e teto, sem sair; erro de configuração (token inválido, allowlist inválida) sai com um código próprio (proposta do Rafa: 78) e não é reiniciado; depois de reiniciar o Docker Engine, simulando o reboot da VM, o bot volta sozinho; `docker compose stop` deixa o bot parado. O Docker não filtra código de saída na política de reinício, então a forma (systemd com exceção para o código, ou outra) é escolha técnica do Rafa e fica no runbook de F0-06. Ver a [pendência](#notas-da-fase-0). | concluída (aprovada pelo Theo em 2026-11-10; ver [notas](#notas-da-fase-0)) | `fix(bot): ajusta reinício para rodar na VM` |
| F0-06 | Colocar o bot na Oracle e medir a estabilidade. | Rafa (o usuário cria a VM) | F0-04, F0-05, F0-12 (U-03 Oracle atendida e confirmada em 2026-11-10; plano da VM nas [contas criadas](#contas-criadas-u-03)) | Imagem roda na arquitetura escolhida, na região São Paulo; bot online por 72 h seguidas, sem intervenção; roteiro de F0-02 funciona no ambiente hospedado; após reiniciar a máquina, o bot volta sozinho, com o comportamento de F0-12; custo apurado no painel é zero; existe runbook de subida, que avisa que a fila em disco da F1-47 não tem trava contra duas instâncias do bot e que só uma pode rodar por vez sobre o mesmo volume. Além das 72 h, 7 dias de observação; na Oracle, CPU, rede e memória comparadas aos limites de reclaim do ADR 0004. Pode subir antes da gravação no banco: a coleta é ligada em F1-49, sem esperar o fim da observação. Antes do cadastro, o usuário lê as [notas](#notas-da-fase-0). | a fazer (desbloqueada: o usuário está disponível para criar a VM) | `docs(infra): adiciona runbook do deploy de prova` |
| F0-10 | Provar uma rota real do Hono em Workers dentro do limite de CPU. | Rafa | F0-01, F0-05, U-03 (Cloudflare e Neon) | Em ambiente publicado, uma rota valida a entrada com Zod, verifica um JWT e consulta o Neon com Drizzle via Hyperdrive; 100 chamadas, incluindo a primeira após um novo deploy, terminam sem erro de limite de CPU; o OpenAPI é gerado dos schemas sem custo relevante por requisição; o ADR 0010 registra as medições e se a espera por I/O conta no limite. Se o Hyperdrive exigir plano pago, a decisão volta ao usuário ([notas](#notas-da-fase-0)). | a fazer | `feat(api): adiciona prova do Hono em Workers` |
| F0-11 | Provar a saída para Node e a suspensão do Neon com o Hyperdrive conectado. | Rafa | F0-10 | O mesmo código de rotas responde igual em Node; com o Hyperdrive conectado e sem requisições, o painel do Neon mostra a suspensão em até 15 min, e a chamada seguinte responde sem erro. Se o Neon não suspender, a falha vai ao usuário antes de F0-08, pois as 400 h deixam de bastar. | a fazer | `test(api): prova execução em Node e suspensão do Neon` |
| F0-07 | Provar HTTPS, fallback da SPA e cookie de refresh com SPA e API no mesmo Worker. | Ambos (Lia: página; Rafa: endpoint) | F0-10 | Playwright em Chromium, Firefox e WebKit, em `workers.dev`: a página publicada chama a API por HTTPS e recebe cookie `httpOnly` e `Secure` com `SameSite`; após recarregar, o cookie é reenviado à rota de teste; recarregar uma rota interna da SPA entrega a aplicação; rotas da API não caem no fallback. Se falhar, a topologia volta ao usuário (D-02). | a fazer | `chore(infra): adiciona prova de HTTPS e cookie` |
| F0-08 | Confirmar o provedor do bot e encerrar a ressalva do ADR 0004. | Rafa | F0-03, F0-06, F0-07, F0-10, F0-11, D-20 | ADR 0004 encerra a ressalva, com o provedor do bot confirmado pelo usuário, os resultados medidos e as pendências da Fase 0 fechadas; ADR 0010 diz se o Hono foi aprovado; README atualizado com o resultado. | a fazer | `docs(adr): confirma provedor do bot no ADR 0004` |

### Notas da Fase 0

**F0-02, concluída.** A call real com a conta da lista foi relatada pelo usuário como funcionando. A conta fora da lista foi coberta só no Discord simulado do Theo; o teste real está em [Testes pendentes do usuário](#testes-pendentes-do-usuário).

**F0-05, concluída com ressalva.** A Oracle pede cartão só para verificação. Na Cloudflare, a exigência de cartão não foi confirmada: o usuário anota ao criar a conta (U-03).

**F0-03, concluída.** O usuário validou no Discord real o estado inicial: entrar na call antes de ligar o bot gera `já estava`, e ele relatou que funcionou. A reconexão foi coberta no Discord simulado do Theo; a queda de internet real segue em [Testes pendentes do usuário](#testes-pendentes-do-usuário). Pode aparecer `queda detectada` no primeiro login, sem conexão anterior; não afeta o spike e deve ser evitado na reconciliação de F1-21.

**F0-04, aguardando roteiro manual do usuário.** O Theo aprovou tudo que dava para testar sem voz real: token fora da imagem, encerramento com login ou reconexão pendentes e reinício limitado. Falta o usuário repetir o roteiro de F0-02 com `docker compose up bot` no Discord real ([Testes pendentes do usuário](#testes-pendentes-do-usuário)); com isso, a F0-04 fica concluída.

**Intent `Guilds`, fechada na F0-03.** São necessárias `Guilds` e `GuildVoiceStates`. Sem `Guilds`, o Discord não envia `GUILD_CREATE` e os canais não entram no cache (medido pelo Rafa).

**Problemas conhecidos, levantados pelo Theo para o Rafa:**

| Severidade | Problema | Tratar em | Situação |
|---|---|---|---|
| P1 | O primeiro Ctrl+C não encerra o bot com login pendente; o mesmo acontece durante a reconexão, com Hello ou READY pendentes | F0-04 | resolvido na F0-04, validado pelo Theo: `shutdown.ts` encerra em até 3 s |
| P2 | `JSON.stringify` não escapa U+2028, U+0085, U+009B e U+202E no log | F0-03 | resolvido: U+2028, U+2029, U+0085, U+009B e U+202E são escapados |
| P3 | Allowlist malformada sobe sem aviso | F0-04 | resolvido na F0-04, validado pelo Theo: allowlist inválida recusa subir |
| P3 | `.env` com BOM perde a primeira variável | F0-04 | resolvido na F0-04, validado pelo Theo: o BOM é removido e a variável, recuperada |
| Sem severidade atribuída | `entrou` falso para quem muda o estado de mudo sem estado em cache | F0-03 | resolvido: agora gera `visto ... estado_anterior=desconhecido` |
| Sem severidade atribuída | `index.ts` sem teste automatizado | F0-03 | resolvido: `index.test.ts` usa um Discord falso local; o Theo validou com 18 mutações |
| Sem severidade atribuída | A política de reinício do container pode entrar em laço quando o bot sai com código 1 (token inválido ou erro sem reconexão) | F0-04 | resolvido na F0-04, validado pelo Theo: `restart: on-failure:5`; substituído na F0-12 por `restart: "no"` no compose e systemd na VM |

**F0-12, concluída (aprovada pelo Theo em 2026-11-10).** Erro de rede no login é tentado de novo dentro do processo, com espera crescente (5 s, 10 s, 30 s, 1 min, 2 min e depois a cada 5 min); erro de configuração sai com código 78, outras falhas com 1 e o encerramento pedido com 0. O Docker não reinicia o bot (`restart: "no"`); na VM, quem reinicia é o systemd (`deploy/systemd/studyrooms-bot.service`, runbook em `docs/runbooks/vm-bot.md`), que volta após o boot e não reinicia o 78. A volta depois do reboot real é conferida na F0-06. A F0-12 também resolveu a observação do Theo na F1-47 sobre religar com o disco cheio ([notas da F1-47](#notas-da-f1-47)).

**Pendência baixa deixada pela F0-12 (observação do Theo), sem atividade própria:** com `STUDYROOMS_CHECK_TIMEOUT` inválido, a mensagem de erro aponta a causa errada; o código de saída (78) está correto. Fica em `deploy/systemd/studyrooms-bot-start.sh`; corrigir quando o Rafa mexer de novo nesse script, na F0-06.

**Pendência levantada pelo Rafa para a VM, resolvida na F0-12:** `on-failure:5` não zera a contagem de tentativas, e, depois de um reboot da VM, o bot provavelmente não volta, pois sai com código 0 no SIGTERM. Recomendação do Rafa: tentar de novo o login com espera crescente, dentro do processo, quando o erro for de rede; e usar `unless-stopped` ou systemd, sem reiniciar quando o código indicar erro de configuração (por exemplo, 78).

**F0-06, para o usuário, antes do cadastro:**

- A região da Oracle é permanente: a conta já existe, em São Paulo (ver [contas criadas](#contas-criadas-u-03)).
- Se o Hyperdrive exigir plano pago, a F0-10 devolve a decisão ao usuário, avaliando antes o driver serverless do Neon.

### Contas criadas (U-03)

Registro de 2026-11-09, nas palavras do usuário: "eu já tinha uma do oracle em são paulo e o neon foi para virginia".

| Conta | Situação | Efeito |
|---|---|---|
| Oracle | Conta preexistente, região São Paulo. Confirmado pelo usuário em 2026-11-10: conta em Free Tier (sem cobrança); home region Brazil East (São Paulo); já existe uma VM.Standard.E2.1.Micro (AMD, 1 OCPU, 1 GB, Ubuntu 24.04), sempre ligada, rodando n8n | Libera F0-06. Plano para a F0-06: nova VM Ampere A1 Flex com 1 OCPU, 2 GB e Ubuntu 24.04, só para o bot (a cota A1 é separada da E2.1.Micro). Plano B, se a Oracle responder "Out of capacity": a segunda E2.1.Micro livre da franquia. A VM do n8n não é usada (1 GB fica apertado). O usuário gera uma chave SSH nova na hora da criação e está disponível para criar a VM nos próximos passos |
| Neon | Projeto criado em AWS US East (N. Virginia) | Libera F1-48 quanto à conta. O bot em São Paulo grava em Virgínia, com latência estimada acima de 100 ms por ida e volta; irrelevante para a coleta, pois os eventos são assíncronos e têm fila em disco (F1-47). Para a API em Workers com Hyperdrive (F0-10), Virgínia é uma boa região |
| Cloudflare | Ainda não criada | Só quando chegar a F0-10 (D-27). A exigência de cartão segue a anotar pelo usuário ao criar |

## Trilha de coleta antecipada

Decisão do usuário em 2026-11-09 (D-26): até a API existir, o bot grava direto no Neon, numa tabela só de eventos brutos. É uma exceção temporária à D-03, que continua valendo: quando a API existir, o bot passa a gravar por ela (F1-20), e os eventos já gravados seguem como dado bruto preservado. Continua valendo que o bot só registra quem consentiu (ver [consentimento na coleta antecipada](#consentimento-na-coleta-antecipada)).

Ordem recomendada. As atividades da Fase 0 (F0-12 e F0-06) estão na tabela da Fase 0; as demais, abaixo. F1-04 e F1-24 saíram dos blocos A e E e foram ajustadas para esta trilha.

1. F0-12: concluída em 2026-11-10. F1-04, F1-46 e F1-47 também estão concluídas.
2. F1-48: preparação concluída e aprovada em 2026-11-10; falta o usuário executar o runbook do Neon (`docs/runbooks/neon.md`).
3. F0-06: a conta na Oracle está confirmada (U-03, em São Paulo, Free Tier); o plano da VM está nas [contas criadas](#contas-criadas-u-03). Pode correr em paralelo com a execução do runbook da F1-48.
4. F1-49: liga a coleta na VM. A partir daqui, os dados reais começam a ser gravados.
5. F1-24: backup local, logo depois de F1-49.

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-04 | Subir Postgres no compose e criar `packages/db` com Drizzle. | Rafa | F0-01, U-05 | `docker compose up db` fica saudável; migrate em banco vazio funciona e a segunda execução não altera nada; um teste com Testcontainers conecta ao banco no Docker atual. Se o Testcontainers não funcionar com esse Docker, Rafa relata antes de seguir. Não espera o Turborepo: `packages/db` entra no workspace pnpm e é integrado ao Turborepo em F1-01. | concluída | `feat(db): adiciona Postgres e Drizzle` |
| F1-46 | Criar a tabela de eventos brutos de voz e a migration. | Rafa | F1-04 | Integração com Testcontainers: a tabela guarda tipo do evento, ID do usuário no Discord, `guild_id`, canal de origem e de destino quando houver, horário do fato em `timestamptz` (UTC) e horário da gravação; os tipos são entrada, saída e troca, mais `voice_present` e os marcos do bot (D-30); não existe coluna de mudo, transmissão nem mensagem; cada evento tem uma chave de idempotência única, e gravar o mesmo evento duas vezes deixa uma linha só; a migration roda em banco vazio e a segunda execução não altera nada. | concluída | `feat(db): adiciona tabela de eventos brutos de voz` |
| F1-47 | Gravar os eventos de voz no banco sem perder evento quando o banco cair. | Rafa | F1-46, F0-12 | Testes com eventos simulados e Postgres local: só quem está na [lista de consentimento](#consentimento-na-coleta-antecipada) é gravado, e quem não está não aparece no banco nem no log; mudo e transmissão não geram gravação; com o banco parado por 10 min e eventos nesse intervalo, o bot não cai, guarda os eventos numa fila em disco (volume do container, que hoje é `read_only`) e grava todos, na ordem e sem duplicar, quando o banco volta; matar o bot com a fila cheia e religar não perde nem duplica eventos; fora os eventos, o único acesso ao banco é o sinal a cada 30 min (D-19), e o bot registra no log quantas vezes acessou o banco, para estimar as horas do Neon; o encerramento continua dentro do prazo de 3 s da F0-04. | concluída (aprovada pelo Theo em 2026-11-09; ver [notas](#notas-da-f1-47)) | `feat(bot): grava eventos brutos de voz no banco` |
| F1-48 | Preparar o Neon para a coleta. | Rafa (o usuário cria a conta e entrega a conexão) | F1-46 (U-03 Neon atendida em 2026-11-09: projeto em AWS US East, N. Virginia) | A migration é aplicada no Neon por conexão direta, a partir da máquina local; o bot usa um papel que só insere na tabela de eventos brutos (e no que a idempotência e o sinal exigirem): com a credencial dele, `DELETE`, `DROP` e leitura de outras tabelas falham; o backup usa outro papel, só de leitura; as conexões ficam só no `.env` local e no da VM, e o `.env.example` documenta as variáveis sem valores; o runbook explica como apagar os eventos de uma pessoa que deixe de consentir, inclusive os que ainda estavam na fila em disco quando ela saiu da lista e foram gravados depois (D-47), e o que fazer com `quarantine.jsonl` (eventos recusados pelo banco: como inspecionar, corrigir ou descartar, lembrando que o arquivo tem IDs do Discord). | aguardando execução do usuário (preparação aprovada pelo Theo em 2026-11-10: comando `neon`, papéis, runbook `docs/runbooks/neon.md` e ferramenta de quarentena; falta o usuário aplicar a migration e criar os papéis no Neon pelo runbook; D-49 e D-50 em [Em aberto](#em-aberto)) | `feat(db)`, `feat(bot)` e `docs(infra)` de 2026-11-10 |
| F1-49 | Ligar a coleta na VM. | Rafa, com roteiro do usuário | F0-06 (bot no ar, sem esperar as 72 h), F1-47, F1-48 | Roteiro manual do usuário no Discord real: entrar, trocar e sair geram as linhas correspondentes no Neon, em UTC; depois de reiniciar a VM, o bot volta e segue gravando; com a conexão do banco cortada na VM por alguns minutos, os eventos do intervalo aparecem no Neon quando ela volta; o consumo de horas do Neon nas primeiras 24 h fica anotado e projetado para o mês; a data de início da coleta fica registrada neste roadmap; `BOT_TEST_ALLOWLIST_USER_IDS` ganha um nome de lista de consentimento (proposta: `BOT_CONSENT_USER_IDS`), e o nome antigo continua aceito, com aviso no log, sem impedir a subida. O teste com uma segunda conta fora da lista entra em [Testes pendentes do usuário](#testes-pendentes-do-usuário). | a fazer | `docs(infra): registra início da coleta antecipada` |
| F1-24 | Fazer backup local do Neon e testar a restauração. | Rafa (script); o usuário executa | F1-48 | Um comando documentado gera, com o papel só de leitura, um dump do Neon em `backups/`, com a data UTC no nome do arquivo; `git status` não mostra o arquivo; restaurar o dump no Postgres local do compose devolve as mesmas contagens por tabela; o mesmo comando apaga dumps com mais de 30 dias (D-10); horas e saída do Neon gastas por dump ficam medidas. Roda no PC do usuário, diariamente, quando ele estiver ligado (D-31). A forma definitiva será revista depois que tudo estiver no ar e funcionando (D-18). | a fazer | `chore(infra): adiciona backup local e restauração` |

### Notas da F1-47

**Aviso para o usuário:** depois desta integração, o bot só sobe com `BOT_DATABASE_URL` no `.env`. Para rodar localmente, suba o banco (`docker compose up -d --wait db`), aplique as migrations e preencha a variável, como explica o `README.md` em "Gravação dos eventos no banco". `BOT_QUEUE_DIR` é opcional.

Pendências deixadas pela F1-47, já distribuídas nas atividades:

- Renomear `BOT_TEST_ALLOWLIST_USER_IDS` para um nome de lista de consentimento, aceitando o antigo com aviso: F1-49.
- A fila em disco não tem trava contra duas instâncias do bot sobre a mesma pasta. Documentar no runbook: F0-06.
- Procedimento para `quarantine.jsonl`: resolvido na preparação da F1-48 (runbook do Neon e `apps/bot/src/quarantine-cli.ts`).
- Observação baixa do Theo: se o bot religar com o disco cheio e com linhas ilegíveis na fila, ele sai com código 1 em vez de seguir rodando. Resolvida em 2026-11-10, junto da F0-12: o bot sobe e mantém as linhas na fila até caberem na quarentena.
- Eventos de quem sai da lista com fila pendente: resolvido em [D-47](#resolvidas). São gravados depois, como hoje, e apagados a pedido pelo runbook da F1-48; o bot não muda.

### Consentimento na coleta antecipada

O consentimento real (F1-18) ainda não existe; hoje só há a allowlist de teste do spike. Decidido pelo usuário em 2026-11-09 (D-29):

- A allowlist de teste vira a **lista de consentimento explícito** da coleta antecipada, com a mesma validação (lista inválida impede o bot de subir). Ela tem só o ID do próprio usuário, nas palavras dele: "apenas eu estarei na lista".
- Se um dia outra pessoa entrar, será por nova decisão do usuário e com consentimento explícito dela, anotado com data num registro local, fora do Git.
- Quem não está na lista não é gravado nem aparece no log, como já acontece no spike.
- Revogar é tirar o ID da lista e reiniciar o bot; quem pedir exclusão tem os eventos apagados pelo procedimento do runbook de F1-48.
- Em F1-26, a lista é substituída pelo consentimento real e removida. Os eventos do período antecipado ficam ligados à conta pelo ID do Discord, conforme ADR 0005.

### Custo do Neon na coleta antecipada

Sem sinal frequente: o sinal do bot fica em memória e só é gravado a cada 30 min (D-19). Estimativa da Nina, não medida: se cada gravação acorda o Neon e ele só suspende depois de 5 min parado, o sinal sozinho mantém o banco acordado cerca de 4 h por dia, perto de 120 h por mês, ou 30% das 400 h. F1-47 e F1-49 medem o valor real. Se confirmado, rever D-19 é decisão do usuário.

## Trilha paralela: base de login e dashboard

Decisão do usuário em 2026-11-09 (D-28): Lia na base da SPA e Rafa na base da API, localmente, sem contas externas. A coleta antecipada tem prioridade para o Rafa; ele avança aqui enquanto espera as contas.

O que pode começar já:

| Atividade | Resp. | Ajuste feito para começar já |
|---|---|---|
| F1-16, base da SPA | Lia | Depende só de F0-01; a integração ao Turborepo fica para F1-01, e o modo de servir os estáticos é conferido em F0-07 e F1-22 |
| F1-02, `packages/shared` com Vitest | Rafa | Depende só de F0-01, pelo mesmo motivo |
| F1-12, base da API com Hono e Wrangler local | Rafa | Depende de F1-02, não mais de F1-09: os schemas de health e de erro ficam em `packages/shared`. `wrangler dev` roda local, sem conta na Cloudflare |
| Rascunho dos ADRs 0005, 0006, 0011 e de login (F1-05, F1-06, F1-07, F1-45) | Rafa | Não dependem mais de F0-08. Eles bloqueiam os contratos (F1-09) e, por consequência, as tabelas de usuário e o login |
| F1-01, Turborepo e `packages/config` | Rafa | Depende de F0-04, não mais de F0-08, para integrar cedo os pacotes novos |

Atividade nova, aprovada pelo usuário em 2026-11-09 (D-32):

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-50 | Prototipar o dashboard com dados simulados, sem API. | Lia | F1-16 | Em `apps/web`, sem nenhuma chamada a API: o dashboard mostra totais por período, streak e mapa de calor a partir de dados falsos fixos no código; toda tela com dado falso tem aviso visível de que os dados são simulados; os dados falsos ficam num módulo separado, fácil de remover; a rota segue protegida pelo login simulado da F1-16; os gráficos usam Recharts (D-35); lint, typecheck e testes passam. Não define contrato: os dados reais entram em F1-35 e F1-36, pelos schemas de F1-09. | concluída, aprovada pelo Theo na revalidação (pendências de baixa severidade passadas para F1-36) | `feat(web): adiciona protótipo do dashboard com dados simulados` |

Risco aceito: a base da API usa Hono antes da prova de F0-10. Se o Hono reprovar no limite de CPU, a base é refeita. O OAuth real só depende das credenciais de U-07, e o login segue simulado nos testes.

## Fase 1: tracker

### Bloco A: fundação

F1-04 foi para a [trilha de coleta antecipada](#trilha-de-coleta-antecipada). F1-01 e F1-02 podem começar já ([trilha paralela](#trilha-paralela-base-de-login-e-dashboard)).

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-01 | Completar o monorepo com Turborepo e `packages/config`. | Rafa | F0-04 | Em clone limpo, lint, typecheck e test via Turborepo passam, incluindo os pacotes criados antes dele (`packages/db`, `packages/shared`, `apps/api`, `apps/web`); a segunda execução usa cache; a estrutura segue o ADR 0001, com a API do ADR 0010; o que passa no typecheck e quebra ao rodar (import `./dep.js`, decorators, `accessor`, `require` e `__dirname`) é tratado por lint ou por smoke test com `start`; o repositório todo usa TypeScript 6 com ESLint e `typescript-eslint` (D-33): `apps/bot` e `packages/db` passam de TypeScript 7.0.2 para 6 e passam no lint e no typecheck, e `pnpm why typescript` não mostra nenhuma versão 7. | a fazer | `chore(repo): configura Turborepo e packages/config` |
| F1-02 | Criar `packages/shared` com Vitest. | Rafa | F0-01 | Um teste de exemplo passa (pelo Turborepo, depois de F1-01); o pacote é importável por `apps/bot`; não há dependência de I/O. | a fazer | `chore(shared): cria pacote com Vitest` |
| F1-03 | Rodar lint, typecheck e testes no GitHub Actions. | Rafa | F1-01, F1-02 | Um push em `dev` com erro de lint proposital fica vermelho e, sem o erro, verde, com o resultado visível no GitHub; mudança só em `apps/web` não executa tarefas de `apps/bot`. | a fazer | `ci(github): adiciona lint, typecheck e testes` |

### Bloco B: decisões e modelo

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-05 | Decidir o ADR 0005, de modelo de sessões. | Rafa | F0-03, F1-46 | ADR aceito pelo usuário cobre as três origens (manual, timer, bot), com início e fim obrigatórios no manual; grava do bot só presença e duração, com `guild_id`, sem mudo nem transmissão; define como o canal AFK é identificado e excluído, com a ida ao AFK dividindo a sessão em duas e o tempo no AFK fora da contagem (D-34), como a troca de canal é representada e o que é regra de leitura; define como os eventos brutos da coleta antecipada (F1-46) viram sessões, sem apagá-los; define onde fica a atividade da sessão derivada, sem alterar os eventos brutos, e a precedência da correção manual sobre a ligação canal→atividade, aplicada na leitura (D-37, D-40, D-41). | a fazer | `docs(adr): aceita ADR 0005 de modelo de sessões` |
| F1-06 | Decidir o ADR 0006, de fuso horário. | Rafa | nenhuma | ADR aceito pelo usuário define origem e mudança do fuso, efeito da mudança no histórico, casos de horário de verão e períodos de calendário com semana de domingo a sábado; registra que a sessão que cruza a meia-noite conta em cada dia só a parte que caiu nele (D-34). | a fazer | `docs(adr): aceita ADR 0006 de fuso horário` |
| F1-07 | Registrar como o bot grava sessões. | Rafa | F1-46 | ADR 0011 aceito pelo usuário define a escrita pela API e a credencial de serviço, resolvendo o item 6 do ADR 0003, e estima o consumo do limite diário de requisições; registra a exceção temporária da coleta antecipada (D-26) e como ela termina em F1-20, com a fila em disco de F1-47 reaproveitada ou não. | a fazer | `docs(adr): aceita ADR 0011 de escrita do bot` |
| F1-08 | Decidir o ADR 0007, de sessões órfãs. | Rafa | F0-03, F1-05, F1-07 | ADR aceito pelo usuário define o sinal do bot, a regra de fechamento, o horário atribuído ao fim da sessão, o tempo da queda e o caso de quem segue na call; o sinal do bot fica em memória na VM, com gravação periódica a cada 30 min (D-19); o ADR também define onde fica o último sinal do timer (D-14), sem tocar o banco a cada envio, e estima as horas de Neon consumidas; trata também os eventos da coleta antecipada, inclusive os intervalos em que o bot ficou fora. | a fazer | `docs(adr): aceita ADR 0007 de sessões órfãs` |
| F1-45 | Decidir o ADR de login por Google e Discord. | Rafa | nenhuma | ADR aceito pelo usuário define o login por Google e Discord, sem e-mail e senha; como a conta Google vincula o Discord depois e o que acontece se esse Discord já tiver conta; os escopos pedidos; como isso convive com o ADR 0003; e o custo de CPU no limite de 10 ms. | a fazer | `docs(adr): aceita ADR de login por Google e Discord` |
| F1-09 | Definir os contratos Zod de usuário, consentimento, sessão e evento de voz. | Ambos (combinam; Rafa aplica) | F1-02, F1-05, F1-06, F1-45 | Testes aceitam exemplos válidos das três origens e de conta sem Discord, e rejeitam fuso inexistente, horário sem UTC, fim anterior ao início e registro manual sem início ou fim; Lia confirma que o contrato atende às telas. | a fazer | `feat(shared): adiciona contratos de usuário e sessão` |
| F1-10 | Criar as tabelas de usuário, consentimento e refresh token. | Rafa | F1-04, F1-09 | Integração: `discord_id` e identidade Google opcionais e, quando presentes, únicos, e toda conta tem ao menos um dos dois; refresh guarda só hash, com família, dispositivo e expiração, conforme ADR 0003; consentimento é global, por usuário, e o aceite tem data. | a fazer | `feat(db): adiciona usuários, consentimento e refresh tokens` |
| F1-11 | Criar a tabela de sessões. | Rafa | F1-05, F1-08, F1-10 | Integração: horários em `timestamptz`; origem distingue bot, timer e manual; sessão do bot guarda `guild_id`; o banco impede duas sessões abertas para a mesma origem e usuário; a migration preserva dados de um banco já populado. | a fazer | `feat(db): adiciona tabela de sessões` |

**F1-08, o que a F0-03 ensinou (insumo, sem decisão):**

- A reconciliação precisa ocorrer a cada `GUILD_CREATE`, não só ao iniciar o bot.
- Há dois modos de queda: a conexão é retomada (`resume`) ou começa uma sessão nova (`identify`).
- Nenhum horário registrado na queda é o horário do fato: o bot só percebe a queda e a volta depois que elas aconteceram.
- Servidor indisponível não é saída de quem estava na call.
- A queda do processo, sem reconexão, só é detectável com sinal periódico do bot ou com as sessões abertas no banco.

Decisões que o Rafa levou ao usuário, para o ADR 0007:

- Horário de fim de quem saiu durante a queda. Recomendação do Rafa: guardar o intervalo da queda e fechar a sessão no início dele.
- Se conta o tempo de quem seguiu na call durante a queda.

### Bloco C: login e consentimento

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-12 | Criar a base da API em Hono com health check, OpenAPI e erros padronizados. | Rafa | F1-02 | Com `wrangler dev` local, sem conta na Cloudflare, `/health` responde 200; o OpenAPI vem dos schemas Zod de `packages/shared`; entrada inválida retorna 400 sem detalhes internos; o que é específico de Workers fica isolado na entrada da aplicação. | a fazer | `feat(api): cria base Hono com OpenAPI` |
| F1-13 | Implementar o login OAuth2 com Discord. | Rafa | F1-10, F1-12, U-07 | Com Discord simulado: `state` inválido é rejeitado, só o escopo `identify` é pedido, nenhum token do Discord chega ao cliente e qualquer conta pode entrar, sem allowlist. Login real feito uma vez pelo usuário. | a fazer | `feat(api): adiciona login com Discord` |
| F1-14 | Implementar access token e refresh rotativo. | Rafa | F1-13 | Testes do ADR 0003 passam: rotação e rejeição do token antigo, reuso revoga a família, expiração do access e CSRF na rota de refresh. | a fazer | `feat(api): adiciona JWT e refresh rotativo` |
| F1-40 | Verificar a API no runtime real de Workers, pois Testcontainers roda em Node. | Rafa | F1-14 | Verificação no runtime de Workers ou em Worker publicado cobre `/health`, uma rota autenticada com consulta via Hyperdrive e o refresh, sem erro de limite de CPU, e pode ser repetida por comando; o relatório diz se a conexão local do Wrangler com Postgres funciona. | a fazer | `test(api): adiciona verificação no runtime de Workers` |
| F1-15 | Expor perfil, fuso e consentimento. | Rafa | F1-14 | Integração: fuso inválido retorna 400; sem token, 401; um usuário não lê nem altera dados de outro; aceitar duas vezes não duplica registro. | a fazer | `feat(api): adiciona perfil e consentimento` |
| F1-16 | Criar a base da SPA com rotas, TanStack Query, Tailwind e shadcn/ui. | Lia | F0-01 | Build gera os estáticos (servi-los conforme a topologia fica para F0-07 e F1-22); rota protegida, com o login ainda simulado, redireciona ao login; rota inexistente mostra página de erro; lint, typecheck e testes passam. | concluída | `feat(web): cria base da SPA` |
| F1-17 | Implementar login, renovação e logout no navegador. | Lia | F1-14, F1-16 | Playwright com Discord simulado: nada de token em `localStorage` ou `sessionStorage`; recarregar mantém o login; 401 renova sem o usuário perceber; logout encerra a sessão. | a fazer | `feat(web): adiciona fluxo de autenticação` |
| F1-18 | Implementar o onboarding com consentimento e fuso. | Lia | F1-15, F1-17 | Playwright: sem aceite, o bot não registra e a pessoa segue usando timer e registro manual; fuso do navegador vem sugerido e pode ser alterado; o texto informa que só presença e duração em call são registradas, sem mudo, transmissão ou mensagens, e avisa que o consentimento vale para qualquer servidor que tenha o bot (D-24); fluxo funciona só com teclado. | a fazer | `feat(web): adiciona onboarding de consentimento` |
| F1-44 | Implementar o login com Google e o vínculo posterior do Discord. | Ambos (Rafa: API; Lia: tela) | F1-14, F1-17, F1-45, U-07 | Com provedores simulados: `state` inválido é rejeitado e nenhum token do Google chega ao cliente; conta Google entra e usa timer e registro manual; o bot não registra nada dela até vincular o Discord e consentir; vincular um Discord que já tem conta segue o ADR de F1-45; não existe formulário de e-mail e senha. Login real feito uma vez pelo usuário. | a fazer | `feat(api): adiciona login com Google` e `feat(web): adiciona login com Google` |

### Bloco D: coleta de voz

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-19 | Criar o caminho de escrita de eventos de voz com credencial de serviço. | Rafa | F1-07, F1-11, F1-15 | Integração: sem credencial, 401; evento repetido não duplica; evento de quem não consentiu não grava nada. | a fazer | `feat(api): adiciona ingestão de eventos de voz` |
| F1-20 | Persistir entrada, saída e troca de canal pelo bot, em vários servidores, pela API, encerrando a exceção da coleta antecipada. | Rafa | F0-03, F1-19, F1-49 | Com eventos simulados: cada caso gera o registro definido no ADR 0005, com `guild_id`, inclusive troca entre servidores com eventos em qualquer ordem; mudo e transmissão não geram gravação; quem não consentiu não gera registro. O bot deixa de gravar direto no Neon, o papel de escrita de F1-48 é revogado, e os eventos brutos já gravados continuam no banco e são lidos conforme o ADR 0005 (D-26). Roteiro manual no servidor de teste confirma com o banco. | a fazer | `feat(bot): persiste sessões de voz` |
| F1-21 | Reconciliar na inicialização e fechar órfãs. | Rafa | F1-08, F1-20 | Matar o bot com alguém na call e religar produz o resultado definido no ADR 0007, sem duplicar, em todos os servidores; o sinal do bot fica em memória na VM, com gravação periódica a cada 30 min (D-19); API fora do ar não derruba o bot nem perde a reconciliação ao voltar; o primeiro login, sem conexão anterior, não é tratado como queda (na F0-03 ele pode gerar `queda detectada`). | a fazer | `feat(bot): reconcilia e fecha sessões órfãs` |
| F1-41 | Permitir que a pessoa escolha em qual servidor colocar o bot. | Ambos (Lia: tela; Rafa: link e bot) | F1-17, F1-20 | A tela abre o convite do Discord, onde a pessoa escolhe o servidor, com permissões mínimas e OAuth de login ainda só com `identify`. Roteiro manual em um segundo servidor: quem consentiu é registrado com o `guild_id` certo, quem não consentiu não é; remover o bot do servidor não derruba o bot nem deixa sessão aberta daquele servidor; remover e recolocar o bot não é tratado como queda (na F0-03 isso gera `saiu_na_queda` sem ter havido queda). O relatório confirma, em fonte oficial, a partir de quantos servidores o Discord exige verificação. | a fazer | `feat(web): adiciona convite do bot` |

### Bloco E: coleta em produção

F1-24 (backup) foi para a [trilha de coleta antecipada](#trilha-de-coleta-antecipada), na forma inicial decidida em D-18. A coleta do usuário número 1 já começa em F1-49; F1-26 abre a coleta pela API para qualquer pessoa com consentimento real.

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-22 | Fechar o ambiente local: banco e bot no compose, API e web com Wrangler. | Rafa | F1-04, F1-12, F1-16, F1-21 | Em clone limpo, com `.env` copiado do `.env.example` e seguindo o README, `docker compose up` deixa banco e bot saudáveis, Wrangler sobe API e web, e o bot no container alcança a API local; imagens sem segredos. | a fazer | `build(repo): fecha ambiente local com compose e Wrangler` |
| F1-23 | Automatizar o deploy pelo GitHub Actions. | Rafa | F0-08, F1-03, F1-22, F1-40, U-08 | O merge de `dev` na `main`, que só acontece quando o usuário considera `dev` estável, publica só o que mudou (filtros do ADR 0001): Worker com Wrangler e bot na VM; migrations rodam antes da API, com conexão direta ao Neon e fora do Worker; a verificação de F1-40 roda após publicar; falha de deploy deixa a versão anterior no ar; logs sem segredos. | a fazer | `ci(deploy): adiciona deploy automático` |
| F1-25 | Adicionar monitoramento mínimo, gatilho de limites e runbook de produção. | Rafa | F1-23, F1-49 | Parar o bot gera alerta em até 10 min; banco inacessível gera alerta em até 1 h; a verificação não mantém o Neon acordado; consumo de horas, armazenamento e saída do Neon e dos limites diários da Cloudflare fica visível; atingir 70% de qualquer limite (proposta deste plano) alerta o usuário, que decide a resposta; seguir o runbook recupera o serviço e restaura um backup. | a fazer | `docs(infra): adiciona runbook de produção` |
| F1-37 | Permitir revogar o consentimento e excluir a conta. Vem antes de abrir a coleta, pois a Fase 1 não tem allowlist. | Ambos | F1-17, F1-20 | E2E: a tela mostra o servidor de origem dos registros do bot (D-17); depois de revogar, nova call não gera registro e o histórico continua; depois de excluir, as tabelas do usuário ficam sem linhas dele, com sessões de timer e manual semeadas no banco junto com as do bot, e os tokens são recusados. Timer e manual reais repetem o critério em F1-31 e F1-42. | a fazer | `feat(api): adiciona revogação e exclusão de conta` e `feat(web): adiciona tela de privacidade` |
| F1-26 | Abrir a coleta em produção pela API, com consentimento real, começando pelo usuário número 1. | Ambos | F1-18, F1-20, F1-21, F1-23, F1-24, F1-25, F1-37, F1-41 | O usuário faz login, consente e convida o bot em produção; uma sessão real aparece no banco em UTC; conta sem vínculo na mesma call não gera registro; a lista de consentimento da coleta antecipada é removida, e os eventos do período antecipado aparecem ligados à conta do usuário. | a fazer | `docs(infra): registra início da coleta em produção` |

### Bloco F: cálculos (TDD, pode começar após F1-09)

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-27 | Fatiar sessões por dia e hora no fuso do usuário. | Rafa | F1-06, F1-09 | Testes: virada de meia-noite, com cada dia recebendo só a parte da sessão que caiu nele (D-34), virada de ano, fusos com deslocamento fracionário e dias de 23 h e 25 h; a soma das fatias é igual à duração da sessão. | a fazer | `feat(shared): adiciona fatiamento de sessões` |
| F1-28 | Aplicar as regras de contagem na leitura. | Rafa | F1-27 | Testes: canal AFK fica de fora, e uma sessão com ida ao AFK no meio vira duas, sem contar o tempo no AFK (D-34); manual, timer e call sobrepostos contam pela união dos intervalos; sessão de 24 h conta inteira, sem limite de duração; a entrada não é alterada. | a fazer | `feat(shared): adiciona regras de contagem` |
| F1-29 | Calcular a streak. | Rafa | F1-28 | Testes: sessão que cruza a meia-noite, mínimo de 15 min no dia, dia de hoje só quebra ao terminar, tempo manual retroativo conta e fica marcado como manual, mudança de fuso, horário de verão e histórico vazio. | a fazer | `feat(shared): adiciona cálculo de streak` |

### Bloco G: timer, registro manual e dashboard

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-30 | Decidir o ADR 0008, de agregação. | Rafa | F1-28, F1-40 | ADR aceito pelo usuário escolhe entre SQL, rollups ou cálculo no cliente, com medição de CPU no runtime de Workers, volume sintético definido no próprio ADR e o gatilho para rever a decisão. | a fazer | `docs(adr): aceita ADR 0008 de agregação` |
| F1-31 | Expor iniciar e parar timer de forma idempotente, sem exigir Discord. | Rafa | F1-11, F1-15, F1-37, F1-44 | Integração: parar duas vezes não cria dois registros; iniciar com timer aberto não abre outro; um usuário não para o timer de outro; conta sem Discord usa o timer; ao fechar o site, o tempo é guardado até o último sinal recebido; o sinal do timer não toca o banco a cada envio; excluir a conta apaga as sessões criadas pelo timer. | a fazer | `feat(api): adiciona timer` |
| F1-32 | Implementar a tela do timer. | Lia | F1-17, F1-31 | Playwright: iniciar, recarregar a página e parar mantém a contagem pelo horário do servidor; clique duplo não duplica; estados de carregamento e erro aparecem. | a fazer | `feat(web): adiciona timer` |
| F1-33 | Expor totais por período e streak. | Rafa | F1-29, F1-30 | Integração: semana de domingo a sábado, mês, trimestre, semestre e ano batem com dados conhecidos em dois fusos; a estratégia do ADR 0008 cabe no limite de CPU, medido no runtime. | a fazer | `feat(api): adiciona totais por período e streak` |
| F1-34 | Expor o mapa de calor. | Rafa | F1-28, F1-30 | Integração: sessão conhecida cai nas células certas de dia e hora em dois fusos; a soma das células é igual ao total do período; a estratégia do ADR 0008 cabe no limite de CPU, medido no runtime. | a fazer | `feat(api): adiciona mapa de calor` |
| F1-35 | Implementar o dashboard por período e a streak. | Lia | F1-17, F1-33 | Playwright: valores batem com dados semeados nos 5 períodos; estado vazio tem mensagem; gráficos feitos com Recharts (D-35) são carregados sob demanda, fora do bundle inicial. | a fazer | `feat(web): adiciona dashboard por período` |
| F1-36 | Implementar o mapa de calor. | Lia | F1-34, F1-35 | Playwright: células batem com a API e cada uma expõe o valor em texto, não só por cor; navegação por teclado funciona; usa Recharts (D-35) ou componente próprio, se o Recharts não atender ao mapa de calor com acessibilidade, a critério da Lia; as pendências da F1-50, listadas logo abaixo desta tabela, ficam resolvidas. | a fazer | `feat(web): adiciona mapa de calor` |
| F1-42 | Expor o registro manual, inclusive retroativo. | Rafa | F1-11, F1-15, F1-37 | Integração: registro retroativo grava com origem manual em UTC; registro sem início ou fim, fim anterior ao início e horário no futuro retornam 400; reenvio não duplica; um usuário não altera dados de outro; o usuário corrige e exclui os próprios registros manuais, e sessões de bot e timer não podem ser alteradas por essas rotas; excluir a conta apaga os registros manuais. | a fazer | `feat(api): adiciona registro manual` |
| F1-43 | Implementar a tela de registro manual. | Lia | F1-35, F1-42 | Playwright: horário informado no fuso do usuário cai no dia certo do dashboard; registro sobreposto a timer ou call não conta em dobro; corrigir ou excluir um registro atualiza o dashboard; início e fim são obrigatórios; erros de validação aparecem; fluxo funciona só com teclado. | a fazer | `feat(web): adiciona registro manual` |

**Pendências da F1-50 para a F1-36, de baixa severidade (levantadas pelo Theo):**

- O `svg` do gráfico tem `role="application"` sem nome acessível.
- O tooltip some nos dias futuros.

### Bloco I: atividades e categorias

Funcionalidade pedida pelo usuário em 2026-11-09: "deve poder cadastrar no que estava estudando e categorias. exemplo: python (categoria programação), leitura (categoria livro), rpg (categoria lazer)". Decisões D-36 a D-41 e, depois, D-42 a D-46 e D-48, todas em [Resolvidas](#resolvidas).

Princípios que valem para todo o bloco:

- Cada usuário cria as próprias atividades e categorias; toda atividade pertence a uma categoria (D-36).
- A sessão tem no máximo uma atividade; sem atividade é permitido e aparece como "sem atividade" (D-38, D-40).
- Os eventos brutos (`raw_voice_events`, F1-46) não mudam. A atividade fica na sessão derivada (D-41).
- Atividade efetiva de uma sessão do bot, calculada na leitura: correção manual, se houver; senão, a ligação do canal a uma atividade; senão, "sem atividade". Por ser aplicada na leitura, a ligação vale também para sessões gravadas antes de ela existir, inclusive as da coleta antecipada (D-37, D-41).
- A categoria diz se conta para a sequência (D-39). Categoria nova conta por padrão, e mudar a opção vale também para o passado, com aviso na tela (D-43). Tempo "sem atividade" conta para a sequência (D-42).
- Atividade com sessões é arquivada, não excluída; sem sessões, é excluída. Categoria só é excluída vazia (D-44).
- Sobreposição: o total geral é a união dos intervalos; cada categoria conta o próprio tempo, com aviso quando a soma passar do total; a sequência usa a união só do que conta para ela (D-45).
- A sessão do bot não é dividida na Fase 1 quando o assunto muda sem trocar de canal (D-46).

Ordem recomendada: F1-51 e F1-56 (lógica pura) junto com o bloco F; F1-52 depois de F1-11; API (F1-53, F1-54, F1-55, F1-57) depois do login; telas por último. F1-60 estende o timer e o registro manual depois de prontos, para não atrasá-los.

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-51 | Definir os contratos Zod de categoria, atividade, ligação canal→atividade e atividade da sessão. | Ambos (combinam; Rafa aplica) | F1-09 | Testes em `packages/shared`: aceitam categoria com nome e "conta para a sequência", atividade com nome e categoria, ligação com `guild_id`, canal e atividade, e sessão sem atividade; rejeitam nome vazio, atividade sem categoria e atividade em mais de uma categoria; o contrato de correção distingue "voltar à regra do canal" de "marcar sem atividade"; Lia confirma que atende às telas de F1-58 a F1-62. | a fazer | `feat(shared): adiciona contratos de atividades e categorias` |
| F1-52 | Criar as tabelas de categorias, atividades, ligações canal→atividade e a atividade da sessão. | Rafa | F1-11, F1-51 | Integração com Testcontainers: a migration não altera `raw_voice_events` (estrutura e linhas iguais antes e depois, num banco populado); toda atividade pertence a uma categoria do mesmo usuário, e o banco recusa ligar atividade de outro usuário; há no máximo uma ligação por usuário, servidor e canal; sessão de timer e manual guarda a atividade, opcional; a correção da sessão do bot fica fora dos eventos brutos; excluir a conta apaga categorias, atividades, ligações e correções do usuário (estende F1-37); a migration preserva dados existentes; a atividade tem um estado de arquivada, e o banco recusa excluir atividade que tenha sessões ou categoria que tenha atividades, inclusive arquivadas (D-44). | a fazer | `feat(db): adiciona atividades e categorias` |
| F1-53 | Expor o CRUD de categorias e atividades. | Rafa | F1-15, F1-52 | Integração: sem token, 401; um usuário não lê, altera nem exclui categoria ou atividade de outro; nome vazio retorna 400; categoria criada sem informar "conta para a sequência" nasce contando (D-43); mudar a atividade de categoria e mudar "conta para a sequência" funcionam e são refletidos na leitura, inclusive do passado (D-43); excluir atividade com sessões a arquiva (some da listagem de seleção, mas segue com o nome no histórico), e sem sessões a exclui; excluir categoria com atividades retorna erro, e vazia a exclui (D-44); excluir a conta não deixa linhas do usuário. | a fazer | `feat(api): adiciona CRUD de atividades e categorias` |
| F1-54 | Expor a ligação de canal de voz a uma atividade. | Rafa | F1-20, F1-53 | Integração: a API lista os canais em que o usuário tem sessões do bot, por servidor, com o nome do canal, que pode ser guardado (D-48; a forma, cache do bot ou tabela de nomes, é escolha técnica do Rafa); canal sem nome conhecido aparece com o ID, sem erro; criar, trocar e remover a ligação funciona; ligar a atividade de outro usuário ou uma atividade arquivada retorna 400 ou 404 (D-44); depois de ligar, sessões antigas daquele canal, inclusive da coleta antecipada, passam a ter a atividade na leitura, sem alterar `raw_voice_events`; remover a ligação as devolve a "sem atividade". | a fazer | `feat(api): adiciona ligação de canal a atividade` |
| F1-55 | Expor a correção da atividade de uma sessão. | Rafa | F1-20, F1-31, F1-42, F1-53 | Integração: o usuário marca ou corrige a atividade de qualquer sessão própria (bot, timer ou manual); na sessão do bot, a correção vence a ligação do canal, e remover a correção volta à regra do canal; marcar "sem atividade" vence a ligação; um usuário não corrige sessão de outro; `raw_voice_events` fica igual; reenvio não duplica. | a fazer | `feat(api): adiciona correção de atividade da sessão` |
| F1-56 | Aplicar a atividade e "conta para a sequência" nas regras de contagem. | Rafa | F1-29, F1-51 | Testes em `packages/shared`: a atividade efetiva segue a ordem correção, ligação do canal, "sem atividade"; uma ligação criada depois vale para sessões anteriores; a streak só soma tempo de categorias que contam para a sequência, e "sem atividade" conta (D-42); com sessões sobrepostas de categorias diferentes, o total geral é a união dos intervalos (D-07), cada categoria recebe o próprio tempo inteiro, e a streak usa a união só dos intervalos que contam para ela, sem contar duas vezes (D-45); mudar a flag de uma categoria muda o cálculo do histórico (D-43); a entrada não é alterada. | a fazer | `feat(shared): aplica atividades nas regras de contagem` |
| F1-57 | Filtrar e agrupar totais e mapa de calor por categoria e atividade. | Rafa | F1-33, F1-34, F1-56 | Integração: com dados semeados em dois fusos, os totais por categoria e por atividade batem com o esperado nos 5 períodos, e o filtro por categoria vale também no mapa de calor; "sem atividade" aparece como grupo próprio; o total geral é a união, cada categoria traz o próprio tempo, e a resposta indica quando a soma das categorias passa do total (D-45); a estratégia do ADR 0008 continua no limite de CPU, medido no runtime, mesmo com ligação e flag aplicadas na leitura. | a fazer | `feat(api): agrupa totais por categoria` |
| F1-58 | Implementar o cadastro de categorias e atividades. | Lia | F1-17, F1-53 | Playwright: criar, renomear e excluir categoria e atividade, marcar se a categoria conta para a sequência e mover uma atividade de categoria; a opção vem marcada numa categoria nova, e mudá-la mostra o aviso de que a sequência passada pode mudar (D-43); erros de validação aparecem; excluir pede confirmação, e a tela diz se a atividade será arquivada (tem sessões) ou excluída, e por que uma categoria com atividades não pode ser excluída (D-44); fluxo funciona só com teclado. | a fazer | `feat(web): adiciona cadastro de atividades e categorias` |
| F1-59 | Implementar a tela de ligação de canal a atividade. | Lia | F1-54, F1-58 | Playwright: os canais aparecem pelo nome, agrupados por servidor (D-48); atividades arquivadas não são oferecidas (D-44); ligar um canal muda a atividade das sessões antigas daquele canal no dashboard; a tela avisa que a ligação vale também para o passado; remover a ligação volta as sessões a "sem atividade"; fluxo funciona só com teclado. | a fazer | `feat(web): adiciona ligação de canal a atividade` |
| F1-60 | Escolher a atividade ao iniciar o timer e ao lançar o registro manual. | Ambos (Rafa: rotas; Lia: telas) | F1-31, F1-32, F1-42, F1-43, F1-53 | Integração: iniciar timer e lançar registro manual aceitam atividade opcional; atividade de outro usuário retorna 400. Playwright: a seleção é opcional e deixa a sessão "sem atividade" se ficar vazia; atividades arquivadas não aparecem na seleção (D-44); trocar de assunto no timer encerra a sessão atual e abre outra com a nova atividade (D-40, D-46); dois assuntos no manual são dois registros (D-46); o registro manual corrigido em F1-43 permite trocar a atividade. | a fazer | `feat(api): adiciona atividade ao timer e ao registro manual` e `feat(web): adiciona seleção de atividade` |
| F1-61 | Corrigir a atividade de uma sessão no dashboard. | Lia | F1-35, F1-55 | Playwright: o dashboard lista as sessões do dia escolhido com origem e atividade efetiva, indicando quando ela veio da ligação do canal; marcar ou corrigir a atividade atualiza totais e gráficos; é possível voltar à regra do canal e marcar "sem atividade"; a sessão do bot recebe uma atividade inteira, sem opção de dividi-la (D-46); fluxo funciona só com teclado. | a fazer | `feat(web): adiciona correção de atividade no dashboard` |
| F1-62 | Filtrar e agrupar os gráficos por categoria. | Lia | F1-36, F1-57 | Playwright: os gráficos em Recharts (D-35) mostram o tempo por categoria e por atividade nos 5 períodos, batendo com a API; o filtro por categoria vale também no mapa de calor; "sem atividade" aparece como grupo; quando a soma das categorias passa do total geral, por sobreposição, o gráfico mostra um aviso em texto (D-45); as cores não são a única forma de distinguir categorias (legenda e valor em texto). | a fazer | `feat(web): agrupa gráficos por categoria` |

### Bloco H: encerramento

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-38 | Atualizar a documentação pública. | Ambos | F1-26 a F1-37, F1-40 a F1-62 | Seguir o "Como rodar" do README em clone limpo funciona; status, roadmap, tabela de ADRs e seção de privacidade refletem o que está no ar. | a fazer | `docs(readme): atualiza execução e status da Fase 1` |
| F1-39 | Comprovar o uso diário em produção. | Ambos | F1-38 | S-04: 14 dias seguidos de uso pelo usuário, sem sessão perdida conhecida, com um fluxo E2E completo de Theo aprovado em produção. | a fazer | `docs(planejamento): encerra a Fase 1` |

## Fase 2: tempo real (alto nível)

Começa só com F1-39 concluída e ADR 0009 aceito. Será detalhada nesse momento.

- Presença nas salas ("quem está estudando agora").
- Timer sincronizado entre dispositivos.
- Ranking semanal ao vivo.
- Redis pub/sub, SSE e teste de carga com k6, a reavaliar sob Workers no ADR 0009, dentro dos limites gratuitos.

## ADRs pendentes

| ADR | Situação | Decidir | Bloqueia | Observação |
|---|---|---|---|---|
| Login por Google e Discord (revisão do 0003 ou ADR novo) | A criar | Já, em rascunho (F1-45) | F1-09, F1-44 e, por consequência, F1-31 | O ADR 0003 só prevê Discord. Direção decidida em D-13 |
| 0004 Hospedagem | Aceito, com ressalva | F0-08 | Saída da Fase 0 | Falta confirmar o provedor do bot (D-20). O banco está decidido (D-23). A seção de backup diz que o dump roda pela VM; precisa refletir D-18 e D-31 (dump diário no PC do usuário, em `backups/`) |
| 0005 Sessões | Planejado | Já, em rascunho (F1-05) | F1-09, F1-11, F1-20, F1-52 | É o mais urgente: precisa dizer como os eventos brutos da coleta antecipada viram sessões. A tabela bruta (F1-46) não espera por ele, pois só guarda o fato. Precisa incluir também: ida ao AFK divide a sessão (D-34); atividade na sessão derivada, sem tocar os eventos brutos, com a precedência correção > ligação do canal > sem atividade, aplicada na leitura (D-37, D-40, D-41); onde fica a correção da sessão do bot; o arquivamento de atividade com sessões (D-44); e que a sessão do bot não se divide por troca de assunto sem troca de canal (D-46) |
| 0006 Fuso | Planejado | Já, em rascunho (F1-06) | F1-09, F1-27 e, por consequência, F1-33 e F1-34 | Registrar a regra da meia-noite: cada dia conta só a parte da sessão que caiu nele (D-34) |
| 0007 Órfãs | Planejado | Bloco B (F1-08), com o resultado de F0-03 | F1-11, F1-21 | Segue D-14 e D-19. Precisa respeitar o limite de horas do Neon |
| 0008 Agregação | Planejado | Após F1-28 (F1-30) | F1-33, F1-34, F1-57 | O limite de 10 ms de CPU restringe a escolha; dados brutos permitem trocá-la sem migrar histórico. Precisa considerar o agrupamento por categoria e atividade e que ligação de canal, correção e "conta para a sequência" mudam o resultado do passado: rollups teriam de ser recalculados a cada mudança |
| 0009 SSE ou WebSocket | Planejado | Início da Fase 2 | Toda a Fase 2 | Reavaliar Redis, SSE e k6 sob Workers |
| 0010 API em Workers | Aceito quanto a Workers; Hono sujeito à prova | F0-08, com F0-10 e F0-11 | F1-12 | Se a rota não couber no limite com qualquer framework, vale o gatilho de revisão |
| 0011 Escrita do bot | Planejado | Já, em rascunho (F1-07) | F1-08, F1-19 | Resolve o item 6 do ADR 0003 e registra a exceção temporária da coleta antecipada (D-26). Não bloqueia a coleta antecipada |

## Riscos principais

| Risco | Efeito | Resposta |
|---|---|---|
| Fase 1 aberta sobre um único banco gratuito (400 h e 1 GB compartilhados) | Ao esgotar, site e coleta param até o próximo ciclo, e dados podem se perder | Consumo visível e alerta em 70%, proposta deste plano (F1-25); a resposta ao gatilho é decisão do usuário |
| Rota real não cabe em 10 ms de CPU | API inviável em Workers no plano gratuito | F0-10 mede antes do código real; F1-30, F1-33, F1-34 e F1-40 acompanham; gatilho de revisão do ADR 0010 |
| Neon não suspende com o Hyperdrive conectado, ou sinais frequentes o mantêm acordado | As 400 h acabam antes do fim do mês | F0-11; D-19; F1-08 estima o consumo |
| O sinal de 30 min da coleta antecipada mantém o Neon acordado (estimativa: cerca de 120 h por mês) | Sobram menos horas para a API e o site | Medir em F1-47 e F1-49; [custo do Neon](#custo-do-neon-na-coleta-antecipada); rever D-19 é decisão do usuário |
| Bot com credencial de escrita direta no banco (exceção da D-26) | VM comprometida alcança o banco | Papel que só insere na tabela bruta (F1-48); revogado em F1-20 |
| Banco fora do ar ou conexão perdida durante a coleta antecipada | Eventos perdidos sem recuperação | Fila em disco com idempotência (F1-47), provada também na VM (F1-49) |
| Backup local depende do PC do usuário ligado e do comando rodando | Dias sem backup passam despercebidos | Forma inicial aceita (D-18), a rever depois que estiver no ar; o histórico curto do Neon não substitui o dump |
| Plano gratuito muda, falta capacidade ou a VM ociosa é reclaimed | Bot fora do ar, histórico em perigo | F0-05, F0-06, plano de saída do ADR 0004, bot em container, backup local (F1-24) |
| Cookie de refresh falha com SPA e API no mesmo Worker | Login cai ao recarregar a página, e a topologia volta ao usuário, podendo envolver domínio pago | F0-07 testa antes de existir login real; D-02 |
| Testes com Testcontainers dependem do Docker ligado manualmente (U-05) | Com a distro `docker-engine` desligada, os testes de `packages/db` falham, o que pode parecer erro de código | F1-04 provou que o Testcontainers funciona com o Engine no WSL e o repasse no Windows; o README explica o erro e como ligar o Docker |
| Base da API feita em Hono antes da prova de F0-10 | Retrabalho se o Hono não couber no limite de CPU | Base pequena (F1-12); F0-10 assim que a conta na Cloudflare existir |
| Testcontainers roda em Node e não prova o comportamento em Workers | Falha só aparece no ar | F1-40, repetida no deploy (F1-23) |
| Evento de voz perdido não tem recuperação | Tempo falso ou histórico incompleto | F0-03, F1-21, coleta em produção cedo |
| Discord real não pode ser automatizado em E2E | Falha só aparece em produção | Eventos e OAuth simulados na suíte, roteiro manual com o usuário (S-03) |
| Erro de fuso e horário de verão na streak | Perda de confiança no dado principal | TDD em F1-27 a F1-29, cálculo sempre refeito a partir do bruto |
| Registrar quem não consentiu, inclusive em logs, agora sem allowlist em produção | Quebra a regra de privacidade do projeto | Allowlist de teste no spike (F0-02); lista de consentimento explícito na coleta antecipada (F1-47); testes em F1-19, F1-20, F1-26 e F1-41; revogar e excluir antes de abrir (F1-37) |
| Bot em muitos servidores pode exigir verificação do Discord (limite a confirmar) | Novos convites podem parar de funcionar | Confirmar em F1-41 e acompanhar o número de servidores |

## Pré-requisitos do usuário

Situação em 2026-11-09.

| ID | Pré-requisito | Necessário para | Situação |
|---|---|---|---|
| U-01 | Aplicação no Discord com bot e token, sem intents privilegiadas, com o token só no `.env` local | F0-02 | Em uso na F0-02, por relato do usuário |
| U-02 | Servidor de teste com canal de voz, canal AFK e uma segunda conta que não se vincula; depois, um segundo servidor | F0-02, F1-20, F1-41 | Parcial: canal de voz em uso na F0-02; o usuário ainda não tem segunda conta (ver [Testes pendentes do usuário](#testes-pendentes-do-usuário)); canal AFK e segundo servidor não verificados |
| U-03 | Contas na Oracle, no Neon e na Cloudflare. Cartão: a Oracle pede só para verificação (F0-05); na Cloudflare, não confirmado, a anotar pelo usuário ao criar a conta | Oracle: F0-06. Neon: F1-48. Cloudflare: F0-10, F0-07 | Parcial: Oracle confirmada em 2026-11-10 (Free Tier, home region São Paulo, uma E2.1.Micro já usada pelo n8n); Neon criado em AWS US East (N. Virginia). Cloudflare só quando chegar a F0-10 (D-27). Detalhes em [contas criadas](#contas-criadas-u-03) |
| U-04 | pnpm funcionando | Nenhuma atividade pendente (F0-01 não depende mais dele) | Resolvido |
| U-05 | Docker ligado manualmente: `wsl -d docker-engine`, com o terminal aberto enquanto usar (ver README). Sem início automático, por escolha do usuário; Docker Desktop não é mais usado | F0-04, F0-12, F1-04, F1-22, F1-24 (restauração), testes com Testcontainers | Definido; a ligar a cada uso |
| U-06 | Disponibilidade para os roteiros manuais de voz | F0-02, F0-03, F0-06, F1-49, F1-20, F1-26, F1-41 | Ver S-03 |
| U-07 | `client_id`, `client_secret` e redirect URIs do OAuth2 do Discord e do Google | F1-13, F1-44 | Não verificado |
| U-08 | Secrets no GitHub para deploy | F1-23 | A fazer |

## Testes pendentes do usuário

Lista de testes para o usuário fazer depois, a pedido dele.

| Teste | Atividade | Responsável | Motivo | Status |
|---|---|---|---|---|
| Com uma segunda conta, fora da allowlist, entrar e sair de um canal de voz e confirmar que nada aparece no terminal. | F0-02 | Usuário | No momento ele só tem um usuário | a fazer |
| Com o Docker ligado, rodar `docker compose up --build bot` e repetir o roteiro de F0-02 no Discord real: entrar, trocar e sair geram as 3 linhas; mutar não gera linha; `Ctrl+C` encerra o bot. | F0-04 | Usuário | O Theo não entra em canal de voz (S-03) | a fazer |
| Queda de internet: com o celular em dados móveis na call e o bot rodando no PC, deixar o PC sem rede por pelo menos 3 min. Anotar o `modo` (`resume` ou `identify`), as linhas `queda detectada` e `retomada` e a hora em que saiu da call pelo celular. Repetir ficando na call. Encerrar com Ctrl+C e confirmar que não aparece linha falsa de queda. | F0-03 | Usuário | A reconexão só foi testada no Discord simulado | a fazer |
| Com uma segunda conta, fora da lista de consentimento, entrar e sair de um canal de voz com o bot na VM e confirmar que nada aparece no Neon nem no log. | F1-49 | Usuário | No momento ele só tem um usuário | a fazer, depois de F1-49 |

## Suposições aceitas

- **S-01:** o código do spike fica em `apps/bot` e pode ser reescrito na Fase 1.
- **S-02:** Rafa redige os ADRs e atualiza o README, com a Lia no que tocar o front, e o usuário decide o aceite.
- **S-03:** o Theo não consegue entrar em canal de voz. Nos roteiros com Discord real, o usuário executa e o Theo confere logs e banco. Até lá, o critério conta como não testado.
- **S-04:** "usado diariamente", da Fase 1 no README, significa 14 dias seguidos.
- **S-05:** quem consente durante uma call passa a ser contado a partir do consentimento, sem tempo retroativo.
- **S-06:** aplicações Discord separadas para teste e produção.

## Decisões

### Resolvidas

| ID | Pergunta | Decisão do usuário | Ainda depende de |
|---|---|---|---|
| D-01 | Onde hospedar? | Front e API na Cloudflare; banco no Neon (D-23); bot em VM gratuita. Oracle como primeira opção e as alternativas do ADR 0004 são recomendação da equipe | Provedor do bot: D-20 |
| D-02 | Como ficam front e API para o cookie de refresh funcionar, e haverá domínio próprio? | Tentar SPA e API no mesmo Worker, em `workers.dev`, sem comprar domínio | F0-07; se falhar, volta ao usuário |
| D-03 | O bot grava pela API ou direto no banco? | Pela API, com credencial de serviço (ADR 0011) | F1-07. Exceção temporária até a API existir: D-26 |
| D-04 | O que faz um dia contar para a streak? | Mínimo de 15 min no dia, no fuso do usuário, somando as fatias; o dia de hoje só quebra a streak quando termina | |
| D-05 | Quais regras valem no cálculo da Fase 1? | O bot só registra quem está na call e por quanto tempo, sem gravar mudo nem transmissão; só o canal AFK fica de fora | |
| D-06 | Quais servidores e canais contam? | Vários servidores: a pessoa escolhe em qual colocar o bot; guardar `guild_id` | |
| D-07 | Timer e call ao mesmo tempo somam em dobro? | Não: conta a união dos intervalos, mantendo os dois registros brutos | |
| D-08 | O que fazer com sessão esquecida aberta? | Sem limite de duração: a sessão pode durar 24 h, se não for para o AFK | |
| D-09 | Quem pode entrar na Fase 1? | Qualquer pessoa, sem allowlist, com consentimento obrigatório para a coleta pelo bot | |
| D-10 | O que acontece ao revogar o consentimento e excluir a conta? | Revogar para a coleta e mantém o histórico; excluir apaga tudo de forma definitiva, e os backups expiram em até 30 dias | |
| D-11 | Os períodos são de calendário ou móveis, e quando começa a semana? | Calendário, com semana de domingo a sábado | |
| D-12 | Quando autorizar push, PR, GitHub Actions e GitHub Projects? | Push ao aprovar este plano; Projects logo depois, com as atividades daqui como itens. Push direto em `dev`, sem PR, porque o login do `gh` não funcionou; pode ser revista. O `gh` fica instalado em `A:\gh` e não deve ser removido (2026-11-09) | Forma do merge de `dev` para `main`: em aberto, a perguntar depois |
| D-13 | De que forma se entra sem Discord? | Google e Discord; sem e-mail e senha | F1-45 |
| D-14 | O que acontece com o timer ao fechar o site? | Guardar até o último sinal recebido | F1-08 |
| D-15 | Tempo manual retroativo conta na streak? | Conta, marcado como manual | |
| D-16 | O registro manual exige início e fim? | Sim | |
| D-17 | O consentimento é global ou por servidor? | Global na Fase 1, mostrando o servidor de origem | |
| D-18 | Qual o destino do backup? | Em 2026-11-09, decidido inicialmente: dump em arquivo físico local, fora do Git, na pasta `backups/` (já no `.gitignore`). A forma definitiva será revista depois que estiver no ar e funcionando | F1-24; revisão posterior. Onde e quando roda: D-31 |
| D-19 | Como tratar sinais frequentes sem gastar o Neon? | Sinal em memória na VM e gravação periódica a cada 30 min | F1-08 |
| D-21 | O registro manual pode ser corrigido ou excluído? | Sim, pode ser corrigido e excluído | |
| D-22 | Tempo manual sobreposto a timer ou call entra na união? | Sim | |
| D-23 | Provedor do banco: confirmar o Neon? | Sim, Neon confirmado | F0-11 prova a suspensão com o Hyperdrive |
| D-24 | O texto do consentimento avisa sobre o alcance global (D-17)? | Sim: avisa que o consentimento vale para qualquer servidor que tenha o bot | F1-18 |
| D-25 | Bot conectado ou Worker agendado consultando estados de voz? | Bot conectado (Gateway em VM); a alternativa de Worker agendado foi descartada. Detalhes no ADR 0004 | |
| D-26 | Começar a coletar antes da API existir? | Em 2026-11-09: sim. Até a API existir, o bot grava direto no Neon, numa tabela só de eventos brutos (entrada, saída e troca, com horário UTC e IDs), como exceção temporária à D-03, que segue valendo. Quando a API existir, o bot passa a gravar por ela, e os eventos já gravados seguem como dado bruto preservado. Só registra quem consentiu. Sem sinal frequente: o sinal fica em memória e é gravado a cada 30 min (D-19). Motivo, nas palavras do usuário: "como os dados são reais, quanto mais tempo perdemos menos dados vamos ter" | [Trilha de coleta antecipada](#trilha-de-coleta-antecipada); D-29 e D-30 |
| D-27 | Quais contas criar agora? | Em 2026-11-09: o usuário cria as contas na Oracle e no Neon (U-03). Cloudflare só quando chegar a F0-10. No mesmo dia: Oracle preexistente em São Paulo e Neon em N. Virginia ([contas criadas](#contas-criadas-u-03)) | U-03 (Cloudflare) |
| D-28 | Login e dashboard esperam a coleta? | Em 2026-11-09: não. Lia na base da SPA (`apps/web`) e Rafa na base da API (`apps/api`), em paralelo e localmente | [Trilha paralela](#trilha-paralela-base-de-login-e-dashboard) |
| D-29 | Quem está na lista de consentimento da coleta antecipada? | Em 2026-11-09: só o próprio usuário ("apenas eu estarei na lista"). Outra pessoa só com nova decisão dele e consentimento explícito dela ([detalhes](#consentimento-na-coleta-antecipada)) | F1-47, F1-49 |
| D-30 | Além de entrada, saída e troca, gravar quem já estava na call quando o bot conecta e os marcos do bot? | Em 2026-11-09: sim. Grava `voice_present` e os marcos de início, queda, retomada, sinal de 30 min e parada do bot, o que confirma a proposta já implementada na F1-46. Sem eles, uma sessão aberta durante uma queda do bot não pode ser fechada depois (insumo de F1-08) | F1-47 |
| D-31 | Onde e com que frequência roda o dump de D-18? | Em 2026-11-09: no PC do usuário, na pasta `backups/` do repositório, diariamente, quando o PC estiver ligado. O ADR 0004 diz que o dump roda pela VM e precisa ser atualizado pelo Rafa | F1-24, ADR 0004 |
| D-32 | A Lia faz um protótipo do dashboard com dados simulados antes da API? | Em 2026-11-09: sim, depois da F1-16, em `apps/web`, sem API e com os dados falsos claramente marcados (F1-50). Nas palavras do usuário: "seria de grande ajuda" | F1-50 |
| D-33 | Qual versão do TypeScript e qual linter valem no repositório todo? | Em 2026-11-09: TypeScript 6 com ESLint (`typescript-eslint`) no repositório todo. `apps/bot` e `packages/db` passam de 7.0.2 para 6 na F1-01. Reavaliar o TypeScript 7 quando o `typescript-eslint` o suportar | F1-01 |
| D-34 | Como contar a sessão que cruza a meia-noite e a ida ao canal AFK? | Em 2026-11-09: a sessão que cruza a meia-noite conta em cada dia só a parte que caiu nele; a ida ao AFK divide a sessão em duas, e o tempo no AFK não conta. Entram nos ADRs 0005 e 0006 | F1-05, F1-06, F1-27, F1-28 |
| D-35 | Qual biblioteca de gráficos? | Em 2026-11-09: Recharts, instalado já no protótipo (F1-50) | F1-35, F1-36, F1-62 |
| D-36 | Quem define atividades e categorias? | Em 2026-11-09: cada usuário cria livremente as suas; toda atividade pertence a uma categoria. Exemplo do usuário: python (programação), leitura (livro), rpg (lazer) | [Bloco I](#bloco-i-atividades-e-categorias) |
| D-37 | Como a sessão do Discord recebe a atividade? | Em 2026-11-09: o usuário pode ligar um canal de voz a uma atividade, e a sessão nesse canal recebe a atividade automaticamente; sem ligação, fica "sem atividade"; pode marcar ou corrigir depois, no dashboard. Sem comando de barra no Discord por enquanto | F1-54, F1-55, F1-59, F1-61 |
| D-38 | Timer e registro manual pedem atividade? | Em 2026-11-09: escolhe ao iniciar ou lançar, de forma opcional ("sem atividade" permitido) | F1-60 |
| D-39 | Toda categoria conta para a sequência? | Em 2026-11-09: cada categoria tem a opção "conta para a sequência" (por exemplo, lazer pode não contar para os 15 min da streak) | F1-56; D-42, D-43 |
| D-40 | Quantas atividades por sessão? | Em 2026-11-09: uma; trocar de assunto divide a sessão | F1-60; D-46 |
| D-41 | Onde fica a atividade em relação ao dado bruto? | Em 2026-11-09: os eventos brutos (`raw_voice_events`) não mudam; a atividade fica na sessão derivada. A ligação canal→atividade é aplicada na leitura e vale também para sessões coletadas antes dela; a correção manual tem precedência | F1-05, F1-52, F1-56 |
| D-42 | Tempo "sem atividade" conta para a sequência? | Em 2026-11-09, aceitando a recomendação da Nina ("sobre os questionamentos da nina eu concordo com as recomendações dela"): sim. Senão, todo o tempo da coleta antecipada e de canais sem ligação deixaria de contar até ser classificado | F1-56 |
| D-43 | Qual o padrão de "conta para a sequência" numa categoria nova, e mudá-lo altera o histórico? | Em 2026-11-09, aceitando a recomendação da Nina: categoria nova conta por padrão; mudar a opção vale também para o passado, pois a regra é aplicada na leitura, com aviso na tela de que a sequência passada pode mudar | F1-53, F1-56, F1-58 |
| D-44 | O que acontece ao excluir uma atividade ou categoria que já tem sessões? | Em 2026-11-09, aceitando a recomendação da Nina: atividade com sessões é arquivada (some da seleção e das ligações novas, mas o histórico continua com o nome); sem sessões, é excluída. Categoria só pode ser excluída sem atividades | F1-52, F1-53, F1-58, ADR 0005 |
| D-45 | Como contar sessões sobrepostas de categorias diferentes (por exemplo, timer de python durante uma call de rpg)? | Em 2026-11-09, aceitando a recomendação da Nina: o total geral segue a união dos intervalos (D-07); cada categoria conta o próprio tempo, e a soma das categorias pode passar do total, com aviso no gráfico; a sequência usa a união só dos intervalos que contam para ela | F1-56, F1-57, F1-62 |
| D-46 | Como dividir uma sessão do bot quando o assunto muda sem trocar de canal? | Em 2026-11-09, aceitando a recomendação da Nina: não dividir na Fase 1. Trocar de canal já divide; no timer, trocar de assunto encerra uma sessão e abre outra (F1-60); no manual, lançam-se dois registros. Dividir uma sessão do bot no dashboard fica para depois, se fizer falta | F1-60, F1-61, ADR 0005 |
| D-47 | Se alguém sai da lista de consentimento enquanto ainda há eventos dele na fila em disco, esses eventos são gravados quando o banco volta ou filtrados ao reabrir a fila? | Em 2026-11-09, aceitando a recomendação da Nina: são gravados depois, como a F1-47 já faz, e, se a pessoa pedir, apagados pelo procedimento do runbook de F1-48. O bot não muda | F1-48 (runbook) |
| D-48 | O nome do canal de voz pode ser guardado, para a tela de ligação mostrar os canais pelo nome? | Em 2026-11-09, por decisão do usuário (pergunta levantada no planejamento da F1-54): sim. A forma (cache do bot, tabela de nomes ou outra) é escolha técnica do Rafa na F1-54. Nunca inclui conteúdo de mensagens | F1-54, F1-59 |

Formas de registrar tempo, também por decisão do usuário: manual (inclusive retroativa), timer no site sem precisar de Discord, e Discord. Por isso, existe conta sem Discord, que entra com Google, e `discord_id` é opcional.

### Em aberto

| ID | Pergunta | Direção ou recomendação (não decidida) | Bloqueia |
|---|---|---|---|
| D-20 | Qual o provedor final do bot? | Sem decisão em 2026-11-09: confirmar a Oracle depois das 72 h e dos 7 dias de F0-06, ou trocar pelo plano de saída do ADR 0004 | F0-08 |
| D-49 | O que fazer com as cópias que ainda têm os eventos de quem pediu exclusão (backups locais da F1-24 e histórico de restauração do Neon)? | Recomendação da Nina e do Rafa, em 2026-11-10: deixar expirar em até 30 dias (D-10) e avisar isso no texto do consentimento | Exclusão a pedido no runbook do Neon (F1-48); texto de consentimento |
| D-50 | Qual `sslmode` usar nas URLs do Neon? | Recomendação em 2026-11-10: `verify-full`, como o runbook já orienta (`require` também verifica o certificado com o driver do projeto, mas gera aviso no log) | Execução do runbook da F1-48 |
