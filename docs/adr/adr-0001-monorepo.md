# ADR 0001: Monorepo TypeScript (pnpm workspaces + Turborepo)

> **Nota (2026-11-06):** a referência a Fastify foi substituída pelo [ADR 0010](adr-0010-api-cloudflare-workers.md).

- **Status:** Aceito
- **Data:** 2026-11-04
- **Fase:** 1

## Contexto

O projeto tem três aplicações que conversam entre si: o front-end (SPA), a API e o bot do Discord. As três são escritas em TypeScript e precisam concordar sobre os mesmos contratos: formato de uma sessão de estudo, payloads da API, eventos do bot.

Se cada aplicação morar em um repositório próprio, os tipos e schemas de validação acabam duplicados ou publicados como pacote, e qualquer mudança de contrato exige coordenar versões em vários repositórios. O projeto é desenvolvido por uma pessoa só, então o custo de coordenação não traz nenhum benefício.

## Decisão

Usar **um único repositório** com **pnpm workspaces** e **Turborepo** para orquestrar tarefas.

```
apps/
  web/      # SPA React + Vite
  api/      # Fastify + Zod
  bot/      # discord.js
packages/
  shared/   # schemas Zod, tipos e utilitários puros (ex.: cálculo de streak)
  db/       # schema e migrations (Drizzle)
  config/   # tsconfig, eslint e prettier compartilhados
docs/
  adr/
```

- Os schemas Zod vivem em `packages/shared` e são a **fonte única de verdade** dos contratos: a API valida com eles, o front infere os tipos a partir deles e o bot os usa ao enviar eventos.
- A lógica de domínio sem efeitos colaterais (streak, fatiamento de sessões por dia e por hora) também fica em `shared`, o que a torna testável de forma isolada e reutilizável por futuros clientes.

## Consequências

**Positivas**
- Mudança de contrato em um único PR, com o compilador apontando tudo que quebrou.
- Um só lugar para CI, lint, formatação e versões de dependências.
- Cache de build do Turborepo e execução apenas do que foi afetado (`--filter`).

**Negativas / custos**
- Mais configuração inicial (workspaces, tsconfig references, pipelines).
- Os apps podem ter ciclos de deploy diferentes, então o CI precisa de filtros por pasta para não reimplantar tudo a cada commit.
- Se um dia houver mais pessoas ou serviços em outras linguagens, a decisão pode ser revisitada.

## Alternativas consideradas

- **Polirepo (um repositório por app):** isolamento maior, mas duplicação de tipos e coordenação de versões sem ganho real para um time de uma pessoa.
- **Workspaces sem Turborepo:** mais simples, porém sem cache de tarefas e sem orquestração por grafo de dependências. Pode ser uma volta atrás aceitável se a ferramenta se mostrar excessiva.
- **Nx:** mais recursos, mas curva de aprendizado e configuração maiores do que o necessário agora.

## Observação

Projetos futuros do portfólio em Python (ex.: o assistente de RAG) ficam em **repositórios separados**. Este monorepo é intencionalmente TypeScript-only.
