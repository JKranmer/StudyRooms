# ADR 0003: Autenticação com JWT (access token curto + refresh token rotativo)

> **Nota (2026-11-06):** o item 6 será resolvido pelo ADR 0011 (planejado). O login passa a ser por Google além de Discord, sem e-mail e senha; o detalhe fica no ADR de login que a F1-45 produz.

- **Status:** Aceito
- **Data:** 2026-11-04
- **Fase:** 1

## Contexto

Os usuários entram com a conta do Discord (OAuth2, escopo `identify`), o que também vincula o `discord_id` usado pelo bot para atribuir tempo de voz.

Há um requisito de futuro: **clientes mobile**. Autenticação baseada em sessão com cookie funciona muito bem para navegador, mas é desconfortável em apps nativos (armazenamento de cookie, CSRF não se aplica da mesma forma, múltiplos clientes com o mesmo mecanismo). Um token em `Authorization: Bearer` serve igualmente web e mobile.

## Decisão

1. **Login via Discord OAuth2.** A API troca o `code` por dados do usuário e **emite os próprios tokens**. Os tokens do Discord não são repassados ao cliente.
2. **Access token JWT de curta duração** (ex.: 15 minutos), enviado em `Authorization: Bearer`. Claims mínimas: `sub` (id interno do usuário), `iat`, `exp`, `jti`. Nenhum dado sensível dentro do token.
3. **Refresh token opaco e rotativo** (não é JWT):
   - gerado aleatoriamente, **armazenado apenas como hash** no Postgres, associado a usuário, dispositivo e data de expiração;
   - **rotacionado a cada uso**; reutilizar um refresh token já consumido é tratado como roubo e **revoga toda a família** de tokens daquele dispositivo;
   - na web, entregue em **cookie `httpOnly`, `Secure`, `SameSite`** e restrito à rota de refresh; no mobile, guardado em armazenamento seguro do sistema (Keychain/Keystore).
4. **Na web, o access token fica apenas em memória**, nunca em `localStorage`. Ao recarregar a página, o front obtém um novo access token pelo refresh.
5. **Assinatura:** começar com HS256 e um único emissor/validador (a API). Migrar para assimétrico (EdDSA/ES256) se outro serviço precisar validar tokens sem conhecer o segredo.
6. O **bot não usa JWT de usuário**. Ele autentica na API (ou grava direto no banco, conforme o ADR de arquitetura do bot) com uma credencial própria de serviço.

## Consequências

**Positivas**
- O mesmo mecanismo atende SPA e futuro app mobile.
- A API fica stateless para requisições comuns (validação do access token não toca o banco).
- Revogação possível pelo lado do refresh token, com janela de exposição limitada pelo tempo de vida do access token.

**Negativas / custos**
- Mais complexidade do que sessão em cookie: rotação, detecção de reuso, limpeza de tokens expirados.
- Um access token já emitido não pode ser revogado antes de expirar (aceito pelo tempo curto). Se isso virar problema, adicionar denylist por `jti` em cache.
- Guardar o access token só em memória exige a chamada de refresh a cada carregamento de página.
- Segurança do cookie de refresh exige cuidado com CORS e CSRF na rota de refresh.

## Alternativas consideradas

- **Sessão em cookie (server-side session):** mais simples e com revogação imediata, ótima para web pura. Descartada porque o futuro cliente mobile pediria um segundo mecanismo ou adaptações.
- **JWT único de longa duração:** simples, mas sem revogação adequada e com impacto alto se vazar. Rejeitado.
- **Provedor gerenciado (Auth0, Clerk etc.):** reduz código, mas esconde justamente a parte que o portfólio quer demonstrar e cria dependência externa e limites no plano gratuito.

## Testes esperados

- Rotação do refresh token e rejeição do token antigo.
- Detecção de reuso revogando a família.
- Expiração do access token e renovação transparente no front.
- Rota de refresh protegida contra CSRF.
