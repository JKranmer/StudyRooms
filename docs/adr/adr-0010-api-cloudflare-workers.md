# ADR 0010: API em Cloudflare Workers com Hono

- **Status:** Aceito quanto a Workers. Hono é uma escolha proposta pela equipe, sujeita à prova abaixo
- **Data:** 2026-11-06
- **Fase:** 1
- **Substitui:** a referência a Fastify do README e dos ADRs 0001, 0002 e 0004

## Contexto

O usuário decidiu publicar a versão 1 da API na Cloudflare, de graça ([ADR 0004](adr-0004-hospedagem.md)). O plano previa Fastify em processo Node. Workers atende requisições por um fetch handler. Não foi confirmado se Fastify roda em Workers; isso não foi testado nem descartado.

## Decisão

1. **API em Cloudflare Workers**, no plano Free: 100.000 requisições/dia e 10 ms de CPU por invocação ([preços](https://developers.cloudflare.com/workers/platform/pricing/), consultado em 2026-11-06).
2. **Hono no lugar do Fastify**, sujeito à prova. A [página oficial do Hono](https://hono.dev/docs/getting-started/cloudflare-workers) documenta o uso em Workers, e o Hono também [roda em Node](https://hono.dev/docs/getting-started/nodejs), o que mantém a saída para um servidor próprio.
3. **Zod e OpenAPI continuam.** Os schemas de `packages/shared` seguem como fonte única dos contratos, e o OpenAPI continua gerado deles. A biblioteca de integração será escolhida na implementação; a documentação do Hono lista exemplos de terceiros.
4. **Acesso ao banco via Hyperdrive**, com node-postgres e `nodejs_compat`, como recomenda a página consultada.

## Prova do Hono

Uma rota real precisa, em ambiente publicado:

- validar a entrada com Zod, verificar um JWT e consultar o Neon com Drizzle via Hyperdrive, dentro de 10 ms de CPU, medidos também em cold start;
- gerar OpenAPI a partir dos schemas sem custo relevante por requisição;
- rodar o mesmo código de rotas em Node, para comprovar a saída;
- permitir que o Neon suspenda com o Hyperdrive conectado (não confirmado; se o pool o mantiver acordado, as 400 h deixam de ser suficientes).

Se a falha vier do framework, troca-se o framework. Se a rota não couber no limite com qualquer framework, vale o gatilho de revisão.

## Consequências

**Positivas**
- Custo zero, sem processo de API para operar.
- A SPA e a API podem ficar no mesmo Worker, a provar na F0-07.
- Hono portátil para Node, Postgres padrão e bot em container mantêm o critério 5 do ADR 0004.

**Negativas / custos**
- **Limite de 10 ms de CPU:** cuidado com operações pesadas por requisição, como cálculo de streak, fatiamento por fuso, união de intervalos e agregações. É uma restrição direta do **ADR 0008**, que deve considerar agregar em SQL, usar rollups ou calcular no cliente com a lógica pura de `packages/shared`. Não foi confirmado nas páginas lidas se a espera por I/O conta nesse limite; a prova mede.
- **Hash forte de senha:** relatos de terceiros, a confirmar, indicam que não cabe em 10 ms. A conta sem Discord está decidida, e isso pesa na escolha, ainda em aberto, da forma de login dela. O refresh token do ADR 0003 não tem esse problema, pois é aleatório, e a verificação do hash pode ser rápida.
- **Sinais frequentes:** não podem tocar o banco a cada envio, e cada um também consome requisições do limite diário (ADR 0004).
- **Testes:** Testcontainers roda em Node e não prova o comportamento no runtime de Workers. Será preciso também um teste no runtime real ou no ambiente publicado. A conexão local com Postgres via Wrangler ainda não foi confirmada.
- **Migrations:** rodam no CI ou localmente, com conexão direta ao Neon, e não dentro do Worker.
- **Código portátil:** o que é específico de Workers (bindings, acesso ao ambiente) precisa ficar isolado na entrada da aplicação.
- **Fase 2:** Redis pub/sub, SSE e o teste de carga com k6 precisam ser reavaliados sob Workers, no **ADR 0009**. Nada é decidido aqui.

## Gatilho de revisão

Rever este ADR ao **estourar os limites gratuitos**, ou por **decisão de investir dinheiro** no projeto.

## Alternativas consideradas

- **Fastify em Workers:** compatibilidade não confirmada. Hono tem o uso documentado.
- **Fastify em Containers da Cloudflare:** "N/A" no plano Free.
- **Fastify na VM do bot:** viável, sem limite de 10 ms, mas contraria a decisão de manter a API na Cloudflare e junta API e bot na mesma máquina. Continua como destino de saída, com Hono em Node.
