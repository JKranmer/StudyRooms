# ADR 0002: SPA com React + Vite (em vez de Next.js)

- **Status:** Aceito
- **Data:** 2026-11-04
- **Fase:** 1

## Contexto

O front-end é um dashboard autenticado: gráficos de estudo por período, mapa de calor por hora, timer de sessão e, na Fase 2, presença ao vivo nas salas. Todo o conteúdo depende do usuário logado.

Isso significa que:
- não há necessidade de SEO nas telas principais;
- o primeiro carregamento não depende de HTML renderizado no servidor para ser útil;
- a API já existe como serviço separado (Fastify), então um servidor de renderização adicionaria uma segunda camada de back-end sem necessidade.

## Decisão

Construir o front-end como **SPA** com:

- **React** + **TypeScript**
- **Vite** como bundler e servidor de desenvolvimento
- **TanStack Router** para rotas tipadas e **TanStack Query** para estado de servidor (cache, revalidação, mutações otimistas)
- **Tailwind CSS** + **shadcn/ui** para componentes
- **Recharts** (ou visx para o mapa de calor) para visualizações
- **React Hook Form** + schemas Zod de `packages/shared` para formulários

O build é um conjunto de arquivos estáticos, que pode ser hospedado em qualquer CDN gratuita de estáticos.

## Consequências

**Positivas**
- Deploy simples e barato (estático), compatível com o requisito de hospedagem gratuita.
- Uma fronteira clara: o front só fala com a API por HTTP, e o mesmo contrato servirá ao futuro app mobile.
- Ciclo de desenvolvimento rápido com HMR do Vite.
- Menos conceitos para manter (sem Server Components, sem decisões de SSR/SSG/ISR por rota).

**Negativas / custos**
- Páginas públicas (landing, perfil público, ranking compartilhável) não terão SEO nem pré-visualização rica em redes sociais se forem parte da SPA.
- O carregamento inicial depende de JavaScript. Mitigação: code splitting por rota e lazy loading de gráficos.

## Gatilho para revisão

Se o produto passar a ter **páginas públicas que precisem ser indexadas ou compartilhadas com preview** (ex.: perfil público de sala de estudo), avaliar:
1. uma landing page separada e estática, ou
2. migrar para Next.js apenas se houver mais de um caso real de renderização no servidor.

## Alternativas consideradas

- **Next.js (App Router):** excelente para conteúdo público e SEO, mas traz um runtime de servidor, hospedagem menos trivial no plano gratuito e decisões de renderização que não agregam valor a um dashboard autenticado. Mantido como alternativa documentada para um projeto futuro do portfólio.
- **Vue + Vite:** totalmente viável, descartado por preferência de ecossistema (React tem mais opções maduras para gráficos e componentes) e para diversificar a stack do portfólio.
