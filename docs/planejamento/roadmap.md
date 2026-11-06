# Roadmap do StudyRooms

Aprovado com pendências em 2026-11-06. As pendências estão em [Em aberto](#em-aberto). Tecnologias: ver `README.md` e `docs/adr/`.

Referências usadas neste plano: **D-xx** são decisões do usuário, **U-xx** são pré-requisitos do usuário e **S-xx** são suposições aceitas. Os IDs das atividades são estáveis e não seguem a ordem de execução: novas atividades recebem o próximo número, e as tabelas estão na ordem recomendada.

Branches: `dev` integra e `main` guarda o que está estável. O trabalho é feito em branches curtas a partir de `dev`, e levar `dev` para `main` depende de o usuário considerar estável.

## Visão geral e ordem de execução

| Ordem | Etapa | Entrega | Por que nesta posição |
|---|---|---|---|
| 1 | Fase 0 | Bot logando voz em VM gratuita, Hono provado em Workers com Neon, HTTPS e cookie de refresh comprovados | Ataca os maiores riscos antes de investir em código: se bot sempre ligado de graça ou a API em 10 ms de CPU não forem viáveis, a arquitetura muda |
| 2 | Fase 1, blocos A e B | Monorepo, CI, banco, ADRs de modelagem e schema | O schema depende de decisões que ficam caras de mudar com dados reais |
| 3 | Fase 1, blocos C, D e E | Login, consentimento, privacidade e coleta de voz em produção, com backup | O Discord não informa tempo passado: cada dia sem coleta é dado perdido para sempre. Por isso a coleta vai ao ar antes do dashboard |
| 4 | Fase 1, blocos F e G | Cálculos, timer, registro manual e dashboard | Como a regra é aplicada na leitura, o dashboard pode vir depois e já nasce com dados reais. O bloco F é lógica pura e pode começar em paralelo ao bloco C |
| 5 | Fase 1, bloco H | Documentação e uso diário comprovado | Encerra a fase e libera a Fase 2 |
| 6 | Fase 2 | Salas em tempo real | Só começa com a Fase 1 em produção |

Publicar a coleta antes do dashboard é uma recomendação deste plano e pode ser revista pelo usuário.

## Fase 0: spike do bot e deploy de prova

Saída da fase: F0-08 concluída, com a ressalva do provedor do bot encerrada no ADR 0004 e o Hono aprovado na prova do ADR 0010. O Neon já está decidido (D-23), mas F0-11 ainda precisa provar que ele suspende com o Hyperdrive conectado.

Depois de F0-01, há duas linhas que podem andar em paralelo: bot (F0-02, F0-03, F0-04, F0-06) e API (F0-10, F0-11, F0-07). A observação de F0-06 corre sozinha enquanto a linha da API avança.

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F0-09 | Criar a branch `dev` a partir da `main`. | Nina | nenhuma | `dev` existe e aponta para o mesmo commit da `main` no momento da criação; o trabalho seguinte parte de uma branch curta de `dev`. A publicação no remoto segue D-12. | concluída | sem commit |
| F0-01 | Criar o workspace pnpm mínimo com `apps/bot` e `.env.example`. | Rafa | F0-09 | Em clone limpo, `pnpm install --frozen-lockfile` e o typecheck de `apps/bot` terminam com código 0; `.env.example` documenta as variáveis, sem valores reais. | a fazer | `chore(repo): cria workspace mínimo com apps/bot` |
| F0-05 | Confirmar o que o levantamento do ADR 0004 deixou em aberto. | Rafa | nenhuma | ADR 0004 responde, com link oficial e data, se Oracle e Cloudflare exigem cartão e se a exigência fere o critério 3; o que seguir sem resposta fica marcado como não confirmado. | a fazer | `docs(adr): confirma pendências do levantamento de planos` |
| F0-02 | Logar no console entrada, saída e troca de canal de voz. | Rafa | F0-01, U-01, U-02, U-06 | Roteiro manual: entrar, trocar e sair geram 3 linhas com tipo, canal e horário UTC; mutar ou transmitir não gera linha; conta fora da allowlist de teste não aparece no log; o código não usa intent privilegiada nem lê mensagens. A allowlist existe só no spike, por privacidade. | a fazer | `feat(bot): loga eventos de voz no console` |
| F0-03 | Provar que o bot enxerga quem já está na call ao iniciar e que sobrevive a reconexões. | Rafa | F0-02 | Iniciar com a conta de teste na call gera log do estado atual; após queda de rede simulada, o bot reconecta sozinho e volta a logar eventos; o relatório diz, com teste, se a intent `guilds` é necessária além de `guild_voice_states`. O resultado alimenta o ADR 0007. | a fazer | `feat(bot): loga estado de voz na inicialização` |
| F0-04 | Empacotar o bot em Docker. | Rafa | F0-02, U-05 | `docker compose up bot` repete o roteiro de F0-02; o token não aparece em `docker history` nem em `docker inspect` da imagem. | a fazer | `build(bot): adiciona Dockerfile e compose do bot` |
| F0-06 | Colocar o bot na VM candidata e medir a estabilidade. | Rafa | F0-04, F0-05, U-03 | Imagem roda na arquitetura escolhida; bot online por 72 h seguidas, sem intervenção; roteiro de F0-02 funciona no ambiente hospedado; após reiniciar a máquina, o bot volta sozinho; custo apurado no painel é zero; existe runbook de subida. Além das 72 h, 7 dias de observação; na Oracle, CPU, rede e memória comparadas aos limites de reclaim do ADR 0004. | a fazer | `docs(infra): adiciona runbook do deploy de prova` |
| F0-10 | Provar uma rota real do Hono em Workers dentro do limite de CPU. | Rafa | F0-01, F0-05, U-03 | Em ambiente publicado, uma rota valida a entrada com Zod, verifica um JWT e consulta o Neon com Drizzle via Hyperdrive; 100 chamadas, incluindo a primeira após um novo deploy, terminam sem erro de limite de CPU; o OpenAPI é gerado dos schemas sem custo relevante por requisição; o ADR 0010 registra as medições e se a espera por I/O conta no limite. | a fazer | `feat(api): adiciona prova do Hono em Workers` |
| F0-11 | Provar a saída para Node e a suspensão do Neon com o Hyperdrive conectado. | Rafa | F0-10 | O mesmo código de rotas responde igual em Node; com o Hyperdrive conectado e sem requisições, o painel do Neon mostra a suspensão em até 15 min, e a chamada seguinte responde sem erro. Se o Neon não suspender, a falha vai ao usuário antes de F0-08, pois as 400 h deixam de bastar. | a fazer | `test(api): prova execução em Node e suspensão do Neon` |
| F0-07 | Provar HTTPS, fallback da SPA e cookie de refresh com SPA e API no mesmo Worker. | Ambos (Lia: página; Rafa: endpoint) | F0-10 | Playwright em Chromium, Firefox e WebKit, em `workers.dev`: a página publicada chama a API por HTTPS e recebe cookie `httpOnly` e `Secure` com `SameSite`; após recarregar, o cookie é reenviado à rota de teste; recarregar uma rota interna da SPA entrega a aplicação; rotas da API não caem no fallback. Se falhar, a topologia volta ao usuário (D-02). | a fazer | `chore(infra): adiciona prova de HTTPS e cookie` |
| F0-08 | Confirmar o provedor do bot e encerrar a ressalva do ADR 0004. | Rafa | F0-03, F0-06, F0-07, F0-10, F0-11, D-20 | ADR 0004 encerra a ressalva, com o provedor do bot confirmado pelo usuário, os resultados medidos e as pendências da Fase 0 fechadas; ADR 0010 diz se o Hono foi aprovado; README atualizado com o resultado. | a fazer | `docs(adr): confirma provedor do bot no ADR 0004` |

## Fase 1: tracker

### Bloco A: fundação

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-01 | Completar o monorepo com Turborepo e `packages/config`. | Rafa | F0-08 | Em clone limpo, lint, typecheck e test via Turborepo passam; a segunda execução usa cache; a estrutura segue o ADR 0001, com a API do ADR 0010. | a fazer | `chore(repo): configura Turborepo e packages/config` |
| F1-02 | Criar `packages/shared` com Vitest. | Rafa | F1-01 | Um teste de exemplo passa pelo Turborepo; o pacote é importável por `apps/bot`; não há dependência de I/O. | a fazer | `chore(shared): cria pacote com Vitest` |
| F1-03 | Rodar lint, typecheck e testes no GitHub Actions. | Rafa | F1-02 | Um PR para `dev` com erro de lint proposital fica vermelho e, sem o erro, verde; mudança só em `apps/web` não executa tarefas de `apps/bot`. | a fazer | `ci(github): adiciona lint, typecheck e testes` |
| F1-04 | Subir Postgres no compose e criar `packages/db` com Drizzle. | Rafa | F1-01, U-05 | `docker compose up db` fica saudável; migrate em banco vazio funciona e a segunda execução não altera nada; um teste com Testcontainers conecta ao banco no Docker atual. Se o Testcontainers não funcionar com esse Docker, Rafa relata antes de seguir. | a fazer | `feat(db): adiciona Postgres e Drizzle` |

### Bloco B: decisões e modelo

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-05 | Decidir o ADR 0005, de modelo de sessões. | Rafa | F0-03, F0-08 | ADR aceito pelo usuário cobre as três origens (manual, timer, bot), com início e fim obrigatórios no manual; grava do bot só presença e duração, com `guild_id`, sem mudo nem transmissão; define como o canal AFK é identificado e excluído, como a troca de canal é representada e o que é regra de leitura. | a fazer | `docs(adr): aceita ADR 0005 de modelo de sessões` |
| F1-06 | Decidir o ADR 0006, de fuso horário. | Rafa | F0-08 | ADR aceito pelo usuário define origem e mudança do fuso, efeito da mudança no histórico, casos de horário de verão e períodos de calendário com semana de domingo a sábado. | a fazer | `docs(adr): aceita ADR 0006 de fuso horário` |
| F1-07 | Registrar como o bot grava sessões. | Rafa | F0-08 | ADR 0011 aceito pelo usuário define a escrita pela API e a credencial de serviço, resolvendo o item 6 do ADR 0003, e estima o consumo do limite diário de requisições. | a fazer | `docs(adr): aceita ADR 0011 de escrita do bot` |
| F1-08 | Decidir o ADR 0007, de sessões órfãs. | Rafa | F0-03, F1-05, F1-07 | ADR aceito pelo usuário define o sinal do bot, a regra de fechamento, o horário atribuído ao fim da sessão, o tempo da queda e o caso de quem segue na call; o sinal do bot fica em memória na VM, com gravação periódica a cada 30 min (D-19); o ADR também define onde fica o último sinal do timer (D-14), sem tocar o banco a cada envio, e estima as horas de Neon consumidas. | a fazer | `docs(adr): aceita ADR 0007 de sessões órfãs` |
| F1-45 | Decidir o ADR de login por Google e Discord. | Rafa | F0-08 | ADR aceito pelo usuário define o login por Google e Discord, sem e-mail e senha; como a conta Google vincula o Discord depois e o que acontece se esse Discord já tiver conta; os escopos pedidos; como isso convive com o ADR 0003; e o custo de CPU no limite de 10 ms. | a fazer | `docs(adr): aceita ADR de login por Google e Discord` |
| F1-09 | Definir os contratos Zod de usuário, consentimento, sessão e evento de voz. | Ambos (combinam; Rafa aplica) | F1-02, F1-05, F1-06, F1-45 | Testes aceitam exemplos válidos das três origens e de conta sem Discord, e rejeitam fuso inexistente, horário sem UTC, fim anterior ao início e registro manual sem início ou fim; Lia confirma que o contrato atende às telas. | a fazer | `feat(shared): adiciona contratos de usuário e sessão` |
| F1-10 | Criar as tabelas de usuário, consentimento e refresh token. | Rafa | F1-04, F1-09 | Integração: `discord_id` e identidade Google opcionais e, quando presentes, únicos, e toda conta tem ao menos um dos dois; refresh guarda só hash, com família, dispositivo e expiração, conforme ADR 0003; consentimento é global, por usuário, e o aceite tem data. | a fazer | `feat(db): adiciona usuários, consentimento e refresh tokens` |
| F1-11 | Criar a tabela de sessões. | Rafa | F1-05, F1-08, F1-10 | Integração: horários em `timestamptz`; origem distingue bot, timer e manual; sessão do bot guarda `guild_id`; o banco impede duas sessões abertas para a mesma origem e usuário; a migration preserva dados de um banco já populado. | a fazer | `feat(db): adiciona tabela de sessões` |

### Bloco C: login e consentimento

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-12 | Criar a base da API em Hono com health check, OpenAPI e erros padronizados. | Rafa | F1-09 | Com Wrangler, `/health` responde 200; o OpenAPI vem dos schemas Zod; entrada inválida retorna 400 sem detalhes internos; o que é específico de Workers fica isolado na entrada da aplicação. | a fazer | `feat(api): cria base Hono com OpenAPI` |
| F1-13 | Implementar o login OAuth2 com Discord. | Rafa | F1-10, F1-12, U-07 | Com Discord simulado: `state` inválido é rejeitado, só o escopo `identify` é pedido, nenhum token do Discord chega ao cliente e qualquer conta pode entrar, sem allowlist. Login real feito uma vez pelo usuário. | a fazer | `feat(api): adiciona login com Discord` |
| F1-14 | Implementar access token e refresh rotativo. | Rafa | F1-13 | Testes do ADR 0003 passam: rotação e rejeição do token antigo, reuso revoga a família, expiração do access e CSRF na rota de refresh. | a fazer | `feat(api): adiciona JWT e refresh rotativo` |
| F1-40 | Verificar a API no runtime real de Workers, pois Testcontainers roda em Node. | Rafa | F1-14 | Verificação no runtime de Workers ou em Worker publicado cobre `/health`, uma rota autenticada com consulta via Hyperdrive e o refresh, sem erro de limite de CPU, e pode ser repetida por comando; o relatório diz se a conexão local do Wrangler com Postgres funciona. | a fazer | `test(api): adiciona verificação no runtime de Workers` |
| F1-15 | Expor perfil, fuso e consentimento. | Rafa | F1-14 | Integração: fuso inválido retorna 400; sem token, 401; um usuário não lê nem altera dados de outro; aceitar duas vezes não duplica registro. | a fazer | `feat(api): adiciona perfil e consentimento` |
| F1-16 | Criar a base da SPA com rotas, TanStack Query, Tailwind e shadcn/ui. | Lia | F1-01 | Build gera estáticos servidos conforme a topologia provada em F0-07; rota protegida redireciona ao login; rota inexistente mostra página de erro; lint, typecheck e testes passam. | a fazer | `feat(web): cria base da SPA` |
| F1-17 | Implementar login, renovação e logout no navegador. | Lia | F1-14, F1-16 | Playwright com Discord simulado: nada de token em `localStorage` ou `sessionStorage`; recarregar mantém o login; 401 renova sem o usuário perceber; logout encerra a sessão. | a fazer | `feat(web): adiciona fluxo de autenticação` |
| F1-18 | Implementar o onboarding com consentimento e fuso. | Lia | F1-15, F1-17 | Playwright: sem aceite, o bot não registra e a pessoa segue usando timer e registro manual; fuso do navegador vem sugerido e pode ser alterado; o texto informa que só presença e duração em call são registradas, sem mudo, transmissão ou mensagens; fluxo funciona só com teclado. | a fazer | `feat(web): adiciona onboarding de consentimento` |
| F1-44 | Implementar o login com Google e o vínculo posterior do Discord. | Ambos (Rafa: API; Lia: tela) | F1-14, F1-17, F1-45, U-07 | Com provedores simulados: `state` inválido é rejeitado e nenhum token do Google chega ao cliente; conta Google entra e usa timer e registro manual; o bot não registra nada dela até vincular o Discord e consentir; vincular um Discord que já tem conta segue o ADR de F1-45; não existe formulário de e-mail e senha. Login real feito uma vez pelo usuário. | a fazer | `feat(api): adiciona login com Google` e `feat(web): adiciona login com Google` |

### Bloco D: coleta de voz

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-19 | Criar o caminho de escrita de eventos de voz com credencial de serviço. | Rafa | F1-07, F1-11, F1-15 | Integração: sem credencial, 401; evento repetido não duplica; evento de quem não consentiu não grava nada. | a fazer | `feat(api): adiciona ingestão de eventos de voz` |
| F1-20 | Persistir entrada, saída e troca de canal pelo bot, em vários servidores. | Rafa | F0-03, F1-19 | Com eventos simulados: cada caso gera o registro definido no ADR 0005, com `guild_id`, inclusive troca entre servidores com eventos em qualquer ordem; mudo e transmissão não geram gravação; quem não consentiu não gera registro. Roteiro manual no servidor de teste confirma com o banco. | a fazer | `feat(bot): persiste sessões de voz` |
| F1-21 | Reconciliar na inicialização e fechar órfãs. | Rafa | F1-08, F1-20 | Matar o bot com alguém na call e religar produz o resultado definido no ADR 0007, sem duplicar, em todos os servidores; o sinal do bot fica em memória na VM, com gravação periódica a cada 30 min (D-19); API fora do ar não derruba o bot nem perde a reconciliação ao voltar. | a fazer | `feat(bot): reconcilia e fecha sessões órfãs` |
| F1-41 | Permitir que a pessoa escolha em qual servidor colocar o bot. | Ambos (Lia: tela; Rafa: link e bot) | F1-17, F1-20 | A tela abre o convite do Discord, onde a pessoa escolhe o servidor, com permissões mínimas e OAuth de login ainda só com `identify`. Roteiro manual em um segundo servidor: quem consentiu é registrado com o `guild_id` certo, quem não consentiu não é; remover o bot do servidor não derruba o bot nem deixa sessão aberta daquele servidor. O relatório confirma, em fonte oficial, a partir de quantos servidores o Discord exige verificação. | a fazer | `feat(web): adiciona convite do bot` |

### Bloco E: coleta em produção

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-22 | Fechar o ambiente local: banco e bot no compose, API e web com Wrangler. | Rafa | F1-04, F1-12, F1-16, F1-21 | Em clone limpo, com `.env` copiado do `.env.example` e seguindo o README, `docker compose up` deixa banco e bot saudáveis, Wrangler sobe API e web, e o bot no container alcança a API local; imagens sem segredos. | a fazer | `build(repo): fecha ambiente local com compose e Wrangler` |
| F1-23 | Automatizar o deploy pelo GitHub Actions. | Rafa | F0-08, F1-03, F1-22, F1-40, U-08 | Merge na `main` publica só o que mudou (filtros do ADR 0001): Worker com Wrangler e bot na VM; migrations rodam antes da API, com conexão direta ao Neon e fora do Worker; a verificação de F1-40 roda após publicar; falha de deploy deixa a versão anterior no ar; logs sem segredos. | a fazer | `ci(deploy): adiciona deploy automático` |
| F1-24 | Automatizar backup diário e testar a restauração. | Rafa | F1-23, D-18 | Dump roda pela VM e aparece no destino de D-18 no dia seguinte, com credencial só de leitura; restaurar em banco limpo devolve as mesmas contagens por tabela; backups expiram em até 30 dias; saída e horas consumidas do Neon ficam medidas. | a fazer | `chore(infra): adiciona backup e restauração` |
| F1-25 | Adicionar monitoramento mínimo, gatilho de limites e runbook de produção. | Rafa | F1-23 | Parar o bot gera alerta em até 10 min; banco inacessível gera alerta em até 1 h; a verificação não mantém o Neon acordado; consumo de horas, armazenamento e saída do Neon e dos limites diários da Cloudflare fica visível; atingir 70% de qualquer limite (proposta deste plano) alerta o usuário, que decide a resposta; seguir o runbook recupera o serviço e restaura um backup. | a fazer | `docs(infra): adiciona runbook de produção` |
| F1-37 | Permitir revogar o consentimento e excluir a conta. Vem antes de abrir a coleta, pois a Fase 1 não tem allowlist. | Ambos | F1-17, F1-20 | E2E: a tela mostra o servidor de origem dos registros do bot (D-17); depois de revogar, nova call não gera registro e o histórico continua; depois de excluir, as tabelas do usuário ficam sem linhas dele, com sessões de timer e manual semeadas no banco junto com as do bot, e os tokens são recusados. Timer e manual reais repetem o critério em F1-31 e F1-42. | a fazer | `feat(api): adiciona revogação e exclusão de conta` e `feat(web): adiciona tela de privacidade` |
| F1-26 | Colocar a coleta em produção com o usuário número 1. | Ambos | F1-18, F1-21, F1-23, F1-24, F1-25, F1-37, F1-41 | O usuário faz login, consente e convida o bot em produção; uma sessão real aparece no banco em UTC; conta sem vínculo na mesma call não gera registro. | a fazer | `docs(infra): registra início da coleta em produção` |

### Bloco F: cálculos (TDD, pode começar após F1-09)

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-27 | Fatiar sessões por dia e hora no fuso do usuário. | Rafa | F1-06, F1-09 | Testes: virada de meia-noite, virada de ano, fusos com deslocamento fracionário e dias de 23 h e 25 h; a soma das fatias é igual à duração da sessão. | a fazer | `feat(shared): adiciona fatiamento de sessões` |
| F1-28 | Aplicar as regras de contagem na leitura. | Rafa | F1-27 | Testes: canal AFK fica de fora; manual, timer e call sobrepostos contam pela união dos intervalos; sessão de 24 h conta inteira, sem limite de duração; a entrada não é alterada. | a fazer | `feat(shared): adiciona regras de contagem` |
| F1-29 | Calcular a streak. | Rafa | F1-28 | Testes: sessão que cruza a meia-noite, mínimo de 15 min no dia, dia de hoje só quebra ao terminar, tempo manual retroativo conta e fica marcado como manual, mudança de fuso, horário de verão e histórico vazio. | a fazer | `feat(shared): adiciona cálculo de streak` |

### Bloco G: timer, registro manual e dashboard

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-30 | Decidir o ADR 0008, de agregação. | Rafa | F1-28, F1-40 | ADR aceito pelo usuário escolhe entre SQL, rollups ou cálculo no cliente, com medição de CPU no runtime de Workers, volume sintético definido no próprio ADR e o gatilho para rever a decisão. | a fazer | `docs(adr): aceita ADR 0008 de agregação` |
| F1-31 | Expor iniciar e parar timer de forma idempotente, sem exigir Discord. | Rafa | F1-11, F1-15, F1-37, F1-44 | Integração: parar duas vezes não cria dois registros; iniciar com timer aberto não abre outro; um usuário não para o timer de outro; conta sem Discord usa o timer; ao fechar o site, o tempo é guardado até o último sinal recebido; o sinal do timer não toca o banco a cada envio; excluir a conta apaga as sessões criadas pelo timer. | a fazer | `feat(api): adiciona timer` |
| F1-32 | Implementar a tela do timer. | Lia | F1-17, F1-31 | Playwright: iniciar, recarregar a página e parar mantém a contagem pelo horário do servidor; clique duplo não duplica; estados de carregamento e erro aparecem. | a fazer | `feat(web): adiciona timer` |
| F1-33 | Expor totais por período e streak. | Rafa | F1-29, F1-30 | Integração: semana de domingo a sábado, mês, trimestre, semestre e ano batem com dados conhecidos em dois fusos; a estratégia do ADR 0008 cabe no limite de CPU, medido no runtime. | a fazer | `feat(api): adiciona totais por período e streak` |
| F1-34 | Expor o mapa de calor. | Rafa | F1-28, F1-30 | Integração: sessão conhecida cai nas células certas de dia e hora em dois fusos; a soma das células é igual ao total do período; a estratégia do ADR 0008 cabe no limite de CPU, medido no runtime. | a fazer | `feat(api): adiciona mapa de calor` |
| F1-35 | Implementar o dashboard por período e a streak. | Lia | F1-17, F1-33 | Playwright: valores batem com dados semeados nos 5 períodos; estado vazio tem mensagem; gráficos são carregados sob demanda. | a fazer | `feat(web): adiciona dashboard por período` |
| F1-36 | Implementar o mapa de calor. | Lia | F1-34, F1-35 | Playwright: células batem com a API e cada uma expõe o valor em texto, não só por cor; navegação por teclado funciona. | a fazer | `feat(web): adiciona mapa de calor` |
| F1-42 | Expor o registro manual, inclusive retroativo. | Rafa | F1-11, F1-15, F1-37 | Integração: registro retroativo grava com origem manual em UTC; registro sem início ou fim, fim anterior ao início e horário no futuro retornam 400; reenvio não duplica; um usuário não altera dados de outro; o usuário corrige e exclui os próprios registros manuais, e sessões de bot e timer não podem ser alteradas por essas rotas; excluir a conta apaga os registros manuais. | a fazer | `feat(api): adiciona registro manual` |
| F1-43 | Implementar a tela de registro manual. | Lia | F1-35, F1-42 | Playwright: horário informado no fuso do usuário cai no dia certo do dashboard; registro sobreposto a timer ou call não conta em dobro; corrigir ou excluir um registro atualiza o dashboard; início e fim são obrigatórios; erros de validação aparecem; fluxo funciona só com teclado. | a fazer | `feat(web): adiciona registro manual` |

### Bloco H: encerramento

| ID | Objetivo | Resp. | Depende de | Critério de aceite | Status | Commit previsto |
|---|---|---|---|---|---|---|
| F1-38 | Atualizar a documentação pública. | Ambos | F1-26 a F1-37, F1-40 a F1-45 | Seguir o "Como rodar" do README em clone limpo funciona; status, roadmap, tabela de ADRs e seção de privacidade refletem o que está no ar. | a fazer | `docs(readme): atualiza execução e status da Fase 1` |
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
| Login por Google e Discord (revisão do 0003 ou ADR novo) | A criar | Bloco B (F1-45) | F1-09, F1-44 e, por consequência, F1-31 | O ADR 0003 só prevê Discord. Direção decidida em D-13 |
| 0004 Hospedagem | Aceito, com ressalva | F0-08 | Saída da Fase 0 | Falta confirmar o provedor do bot. O banco está decidido (D-23) |
| 0005 Sessões | Planejado | Início do bloco B (F1-05) | F1-09, F1-11, F1-20 | É o mais urgente: o que não for gravado desde o início não pode ser recuperado |
| 0006 Fuso | Planejado | Início do bloco B (F1-06) | F1-09, F1-27 e, por consequência, F1-33 e F1-34 | |
| 0007 Órfãs | Planejado | Bloco B (F1-08), com o resultado de F0-03 | F1-11, F1-21 | Segue D-14 e D-19. Precisa respeitar o limite de horas do Neon |
| 0008 Agregação | Planejado | Após F1-28 (F1-30) | F1-33, F1-34 | O limite de 10 ms de CPU restringe a escolha; dados brutos permitem trocá-la sem migrar histórico |
| 0009 SSE ou WebSocket | Planejado | Início da Fase 2 | Toda a Fase 2 | Reavaliar Redis, SSE e k6 sob Workers |
| 0010 API em Workers | Aceito quanto a Workers; Hono sujeito à prova | F0-08, com F0-10 e F0-11 | F1-12 | Se a rota não couber no limite com qualquer framework, vale o gatilho de revisão |
| 0011 Escrita do bot | Planejado | Bloco B (F1-07) | F1-08, F1-19 | Resolve o item 6 do ADR 0003 |

## Riscos principais

| Risco | Efeito | Resposta |
|---|---|---|
| Fase 1 aberta sobre um único banco gratuito (400 h e 1 GB compartilhados) | Ao esgotar, site e coleta param até o próximo ciclo, e dados podem se perder | Consumo visível e alerta em 70%, proposta deste plano (F1-25); a resposta ao gatilho é decisão do usuário |
| Rota real não cabe em 10 ms de CPU | API inviável em Workers no plano gratuito | F0-10 mede antes do código real; F1-30, F1-33, F1-34 e F1-40 acompanham; gatilho de revisão do ADR 0010 |
| Neon não suspende com o Hyperdrive conectado, ou sinais frequentes o mantêm acordado | As 400 h acabam antes do fim do mês | F0-11; D-19; F1-08 estima o consumo |
| Plano gratuito muda, falta capacidade ou a VM ociosa é reclaimed | Bot fora do ar, histórico em perigo | F0-05, F0-06, plano de saída do ADR 0004, bot em container, backup externo (F1-24) |
| Cookie de refresh falha com SPA e API no mesmo Worker | Login cai ao recarregar a página, e a topologia volta ao usuário, podendo envolver domínio pago | F0-07 testa antes de existir login real; D-02 |
| Testcontainers ainda não foi testado com o Docker atual (Engine no WSL, com repasse no Windows) | Testes de integração de F1-04 em diante sem base | F1-04 testa cedo e relata antes de seguir |
| Testcontainers roda em Node e não prova o comportamento em Workers | Falha só aparece no ar | F1-40, repetida no deploy (F1-23) |
| Evento de voz perdido não tem recuperação | Tempo falso ou histórico incompleto | F0-03, F1-21, coleta em produção cedo |
| Discord real não pode ser automatizado em E2E | Falha só aparece em produção | Eventos e OAuth simulados na suíte, roteiro manual com o usuário (S-03) |
| Erro de fuso e horário de verão na streak | Perda de confiança no dado principal | TDD em F1-27 a F1-29, cálculo sempre refeito a partir do bruto |
| Registrar quem não consentiu, inclusive em logs, agora sem allowlist em produção | Quebra a regra de privacidade do projeto | Allowlist de teste no spike (F0-02), testes em F1-19, F1-20, F1-26 e F1-41; revogar e excluir antes de abrir (F1-37) |
| Bot em muitos servidores pode exigir verificação do Discord (limite a confirmar) | Novos convites podem parar de funcionar | Confirmar em F1-41 e acompanhar o número de servidores |

## Pré-requisitos do usuário

Situação em 2026-11-06.

| ID | Pré-requisito | Necessário para | Situação |
|---|---|---|---|
| U-01 | Aplicação no Discord com bot e token, sem intents privilegiadas, com o token só no `.env` local | F0-02 | Não verificado |
| U-02 | Servidor de teste com canal de voz, canal AFK e uma segunda conta que não se vincula; depois, um segundo servidor | F0-02, F1-20, F1-41 | Não verificado |
| U-03 | Contas na Cloudflare, no Neon e na Oracle (exigência de cartão na Oracle e na Cloudflare: ver F0-05) | F0-06, F0-07, F0-10 | Não verificado |
| U-04 | pnpm funcionando | Nenhuma atividade pendente (F0-01 não depende mais dele) | Resolvido |
| U-05 | Docker ligado manualmente: `wsl -d docker-engine`, com o terminal aberto enquanto usar (ver README). Sem início automático, por escolha do usuário; Docker Desktop não é mais usado | F0-04, F1-04, F1-22, testes com Testcontainers | Definido; a ligar a cada uso |
| U-06 | Disponibilidade para os roteiros manuais de voz | F0-02, F0-03, F0-06, F1-20, F1-26, F1-41 | Ver S-03 |
| U-07 | `client_id`, `client_secret` e redirect URIs do OAuth2 do Discord e do Google | F1-13, F1-44 | Não verificado |
| U-08 | Secrets no GitHub para deploy | F1-23 | A fazer |

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
| D-03 | O bot grava pela API ou direto no banco? | Pela API, com credencial de serviço (ADR 0011) | F1-07 |
| D-04 | O que faz um dia contar para a streak? | Mínimo de 15 min no dia, no fuso do usuário, somando as fatias; o dia de hoje só quebra a streak quando termina | |
| D-05 | Quais regras valem no cálculo da Fase 1? | O bot só registra quem está na call e por quanto tempo, sem gravar mudo nem transmissão; só o canal AFK fica de fora | |
| D-06 | Quais servidores e canais contam? | Vários servidores: a pessoa escolhe em qual colocar o bot; guardar `guild_id` | |
| D-07 | Timer e call ao mesmo tempo somam em dobro? | Não: conta a união dos intervalos, mantendo os dois registros brutos | |
| D-08 | O que fazer com sessão esquecida aberta? | Sem limite de duração: a sessão pode durar 24 h, se não for para o AFK | |
| D-09 | Quem pode entrar na Fase 1? | Qualquer pessoa, sem allowlist, com consentimento obrigatório para a coleta pelo bot | |
| D-10 | O que acontece ao revogar o consentimento e excluir a conta? | Revogar para a coleta e mantém o histórico; excluir apaga tudo de forma definitiva, e os backups expiram em até 30 dias | |
| D-11 | Os períodos são de calendário ou móveis, e quando começa a semana? | Calendário, com semana de domingo a sábado | |
| D-12 | Quando autorizar push, PR, GitHub Actions e GitHub Projects? | Push e PR ao aprovar este plano; Projects logo depois, com as atividades daqui como itens | |
| D-13 | De que forma se entra sem Discord? | Google e Discord; sem e-mail e senha | F1-45 |
| D-14 | O que acontece com o timer ao fechar o site? | Guardar até o último sinal recebido | F1-08 |
| D-15 | Tempo manual retroativo conta na streak? | Conta, marcado como manual | |
| D-16 | O registro manual exige início e fim? | Sim | |
| D-17 | O consentimento é global ou por servidor? | Global na Fase 1, mostrando o servidor de origem | |
| D-19 | Como tratar sinais frequentes sem gastar o Neon? | Sinal em memória na VM e gravação periódica a cada 30 min | F1-08 |
| D-21 | O registro manual pode ser corrigido ou excluído? | Sim, pode ser corrigido e excluído | |
| D-22 | Tempo manual sobreposto a timer ou call entra na união? | Sim | |
| D-23 | Provedor do banco: confirmar o Neon? | Sim, Neon confirmado | F0-11 prova a suspensão com o Hyperdrive |

Formas de registrar tempo, também por decisão do usuário: manual (inclusive retroativa), timer no site sem precisar de Discord, e Discord. Por isso, existe conta sem Discord, que entra com Google, e `discord_id` é opcional.

### Em aberto

| ID | Pergunta | Direção ou recomendação (não decidida) | Bloqueia |
|---|---|---|---|
| D-18 | Qual o destino do backup? O backup roda pela VM, por decisão do usuário | Levantamento pendente (Rafa) | F1-24 |
| D-20 | Qual o provedor final do bot? | Decidir com o resultado de F0-06 | F0-08 |
