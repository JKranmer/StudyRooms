# ADR 0004: Hospedagem gratuita (bot, API, banco e front)

- **Status:** Proposto (decidir antes do primeiro deploy)
- **Data:** 2026-11-04
- **Fase:** 1

## Contexto

Restrição definida pelo autor: **apenas planos gratuitos**. Os componentes têm necessidades diferentes:

| Componente | Necessidade |
|---|---|
| Front (SPA) | Arquivos estáticos |
| API (Fastify) | Processo HTTP, tolerante a cold start moderado |
| **Bot do Discord** | **Processo sempre ligado.** Mantém conexão persistente com o Gateway, então não pode dormir nem rodar em serverless puro |
| PostgreSQL | Dados persistentes e duradouros (o histórico de estudo é o ativo do projeto) |

## Pontos de atenção levantados na pesquisa (nov/2026)

Os planos gratuitos mudam com frequência e as fontes consultadas eram blogs e agregadores, algumas com meses de idade. **Cada ponto abaixo deve ser reconfirmado na página oficial do provedor antes de decidir.**

- Serviços web gratuitos que **dormem após inatividade** (modelo descrito para o Render) não servem ao bot, porque derrubam a conexão com o Gateway.
- Bancos gratuitos que **expiram** (o Postgres gratuito do Render foi descrito como válido por 30 dias) são inadequados para guardar histórico.
- Alguns provedores oferecem **crédito mensal em vez de gratuidade total** (Railway foi descrito com US$ 5 de crédito/mês), o que pode acabar antes do fim do mês.
- Existem hospedagens gratuitas voltadas a bots, mas com recursos pequenos, regras próprias e permanência incerta. Servem para testes, não como base de um projeto de portfólio.
- Uma **VM always-free** (ex.: Oracle Cloud Always Free) foi apontada como a opção realmente sempre ligada e gratuita, com o custo de **você operar a máquina**, e com o risco de recursos ociosos serem reclamados pelo provedor.
- Plataformas serverless de borda (ex.: Cloudflare Workers) não mantêm conexão de Gateway; só atendem bots de interações HTTP, o que não cobre eventos de voz.

## Direção proposta (a validar)

- **Front:** CDN gratuita de arquivos estáticos (Cloudflare Pages, Netlify ou GitHub Pages).
- **Bot + API + Postgres:** uma **VM always-free** rodando `docker compose`, com backups periódicos do banco para fora da VM (ex.: dump diário para um armazenamento gratuito).
- **Alternativa se a VM não for viável:** separar o banco em um Postgres gerenciado com plano gratuito sem expiração e manter bot e API em um provedor sem sleep.

Operar a VM é trabalho a mais, mas também gera conteúdo de portfólio: Docker, CI/CD com deploy por SSH, systemd/compose, backups, monitoramento e um runbook.

## Critérios de decisão

1. O bot nunca dorme.
2. O banco não expira e tem backup.
3. Custo zero sem cartão de crédito, ou com cartão apenas para verificação.
4. Deploy automatizável pelo GitHub Actions.
5. Migração para outro provedor em um dia (tudo em containers, configuração por variáveis de ambiente).

## Consequências

- Todo o projeto é **empacotado em Docker desde o início**, independentemente do provedor escolhido. Isso mantém a decisão reversível.
- Registrar no README a data da verificação dos planos e o que fazer se o plano gratuito mudar.

## Pendências

- [ ] Reconfirmar limites e regras atuais nas páginas oficiais dos candidatos.
- [ ] Testar um deploy de prova (bot que apenas loga eventos de voz) antes de fechar a decisão.
- [ ] Atualizar o status deste ADR para Aceito e registrar a escolha final.
