# Runbook: Neon da coleta antecipada (F1-48)

Este passo a passo prepara o Neon para receber os eventos de voz do bot. Quem executa é o usuário, no próprio PC. Os comandos leem as conexões do `.env` da raiz e **nunca as imprimem**. Nenhum agente lê o `.env` nem recebe as conexões.

## Visão geral

São três papéis (usuários do banco), cada um com sua conexão:

| Variável no `.env` | Papel | Pode | Onde fica |
|---|---|---|---|
| `NEON_ADMIN_URL` | `neondb_owner` (dono, criado pelo Neon) | Tudo: migrations, criar papéis, apagar dados a pedido | Só no PC |
| `NEON_BOT_URL` | `studyrooms_bot` | Só inserir em `raw_voice_events`. Não lê, não altera, não apaga | PC (referência) e VM, em `BOT_DATABASE_URL` |
| `NEON_BACKUP_URL` | `studyrooms_backup` | Só ler | Só no PC (backup da F1-24) |

As variáveis do banco local (`DATABASE_URL`, `BOT_DATABASE_URL` e `POSTGRES_*`) continuam como estão: o PC segue usando o banco local para desenvolvimento, e os comandos do Neon usam só as variáveis `NEON_*`.

Todos os comandos abaixo rodam na pasta do projeto, num terminal comum (PowerShell), sem precisar do Docker.

## 1. Copiar a conexão do dono

1. No painel do Neon, abra o projeto e clique em **Connect**.
2. Escolha o branch `production` (ou o único que existir), o banco `neondb` e o papel `neondb_owner`.
3. **Desligue "Connection pooling"**: as migrations precisam da conexão direta. O host não pode ter `-pooler`.
4. Copie a URL. Ela tem o formato `postgresql://neondb_owner:SENHA@ep-....us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
5. No `.env` da raiz, crie a linha `NEON_ADMIN_URL=` e cole a URL depois do `=`, sem aspas.
6. No fim da URL, troque `sslmode=require` por `sslmode=verify-full`. Com o driver do projeto, os dois verificam o certificado do servidor, mas `require` gera um aviso de segurança no log. O `channel_binding=require` pode ficar ou sair: o driver o ignora.
7. Salve o `.env` como UTF-8, sem BOM.

**Teste, sem imprimir a URL:**

```
pnpm --filter @studyrooms/db neon ping
```

O esperado é `Conectado: usuário neondb_owner, banco neondb, Postgres 17, SSL sim.` (o número do Postgres é o escolhido ao criar o projeto). Se der erro, veja [Problemas comuns](#problemas-comuns).

## 2. Aplicar as migrations

```
pnpm --filter @studyrooms/db neon migrate
```

O esperado é `Migrations em dia no Neon.` Rodar de novo não muda nada. As migrations só acrescentam: nenhuma apaga eventos.

## 3. Criar os papéis do bot e do backup

```
pnpm --filter @studyrooms/db neon roles
```

O comando:

- cria `studyrooms_bot` e `studyrooms_backup`, com senhas aleatórias de 43 caracteres;
- aplica as permissões de [`packages/db/sql/roles.sql`](../../packages/db/sql/roles.sql): o bot só insere, sem escolher `id` nem `recorded_at`; o backup só lê, inclusive tabelas de migrations futuras;
- grava as duas conexões novas no arquivo `.env.neon.local`, na raiz do projeto, **sem imprimi-las**. O arquivo fica fora do Git (regra `.env.*` do `.gitignore`).

Depois:

1. Abra o `.env.neon.local` e copie as linhas `NEON_BOT_URL=...` e `NEON_BACKUP_URL=...` para o `.env`.
2. **Apague o `.env.neon.local`.** Enquanto ele existir, o comando se recusa a rodar de novo, para não sobrescrever uma senha ainda não copiada.

Não crie esses papéis pelo painel do Neon: papéis criados por lá recebem o `neon_superuser`, com poder demais para o bot.

## 4. Conferir as permissões

```
pnpm --filter @studyrooms/db neon check
```

O comando conecta com o papel do bot e com o do backup e confere, numa transação desfeita no fim (nada fica gravado):

- as duas conexões usam SSL e o usuário certo;
- o bot insere, mas não lê, não altera, não apaga eventos, não apaga a tabela e não lê outras tabelas;
- o backup lê, mas não insere nem apaga.

O esperado é uma lista de `ok` e, no fim, `Tudo certo.` Qualquer `FALHOU` vem com o código do erro; não siga para a VM antes de resolver.

## 5. Levar a conexão do bot para a VM

Isto acontece na F0-06 ou na F1-49, quando a VM existir. No `.env` da VM, `BOT_DATABASE_URL` recebe o **valor** de `NEON_BOT_URL` (o texto depois do `=`). `NEON_ADMIN_URL` e `NEON_BACKUP_URL` nunca vão para a VM: se ela for comprometida, quem a invadir só consegue inserir eventos.

## Trocar as senhas

Se uma conexão vazar, ou por rotina:

```
pnpm --filter @studyrooms/db neon roles --rotate
```

As senhas antigas param de funcionar na hora. Copie as conexões novas do `.env.neon.local` para o `.env` do PC, atualize `BOT_DATABASE_URL` na VM, reinicie o bot (`sudo systemctl restart studyrooms-bot`) e apague o `.env.neon.local`. Enquanto a VM estiver com a senha antiga, os eventos ficam na fila em disco e chegam ao banco depois da troca.

A senha do `neondb_owner` é trocada pelo painel do Neon (Roles, Reset password). Depois, atualize `NEON_ADMIN_URL`.

## Quarentena (`quarantine.jsonl`)

Quando o banco recusa um evento por conteúdo inválido (códigos das classes 22 e 23, como `23514`, restrição violada), o bot o separa em `quarantine.jsonl`, para não travar os outros. Uma linha da fila que ficou ilegível (escrita cortada por uma queda de energia) também vai para lá. Na prática, um evento recusado indica bot e banco em versões diferentes, ou um defeito no bot.

**O arquivo tem IDs do Discord.** Não o copie para fora da máquina, não o anexe em issue nem o cole em chat.

Onde fica:

- **VM:** no volume `studyrooms_bot-queue`, montado em `/var/lib/studyrooms-bot` no container.
- **PC, com o bot fora do Docker:** `.data/bot-queue/quarantine.jsonl`, na raiz do projeto.

O bot avisa no log a cada evento separado (`evento recusado pelo banco (código: ...); separado em quarentena`). As ferramentas abaixo nunca imprimem IDs. Na VM, rode na pasta do clone (`/opt/studyrooms`), onde estão o `compose.yaml` e o `.env`. O `-p studyrooms` fixa o nome do projeto, o mesmo da unidade do systemd, para o comando usar o volume da fila do bot. De outra pasta, acrescente `--project-directory /opt/studyrooms` (ou o caminho do clone). No PC, troque o começo por `node apps/bot/src/quarantine-cli.ts`.

**Inspecionar** (pode rodar com o bot ligado):

```
docker compose -p studyrooms run --rm --no-deps --entrypoint node bot src/quarantine-cli.ts resumo
```

Mostra quantas linhas há, por motivo (`recusado_pelo_banco`, `linha_ilegivel`), por código de erro e o período, em UTC.

Para corrigir ou descartar, **pare o bot antes** (`sudo systemctl stop studyrooms-bot`) e ligue de novo no fim (`sudo systemctl start studyrooms-bot`): a fila em disco não tem trava contra dois processos.

**Corrigir:** depois que a causa for resolvida (uma migration nova no Neon ou uma versão nova do bot), devolva os recusados à fila. O bot os grava ao ligar; a chave de idempotência impede duplicata, e o que o banco recusar de novo volta para a quarentena.

```
docker compose -p studyrooms run --rm --no-deps --entrypoint node bot src/quarantine-cli.ts reenfileirar
```

**Descartar:** linhas ilegíveis não têm conserto e podem ser descartadas. Descartar apaga a quarentena inteira; sem `--confirm`, o comando só mostra quantas linhas há.

```
docker compose -p studyrooms run --rm --no-deps --entrypoint node bot src/quarantine-cli.ts descartar --confirm
```

## Exclusão a pedido (D-47)

Quem deixa de consentir sai da lista e, se pedir, tem todos os eventos apagados. É a única exceção à regra de preservar o dado bruto. Eventos da pessoa que ainda estavam na fila em disco quando ela saiu da lista são gravados quando o banco volta (comportamento atual, D-47) e caem no passo 4.

1. **Tirar da lista.** No `.env` da VM, remova o ID de `BOT_TEST_ALLOWLIST_USER_IDS`.
2. **Parar o bot:** `sudo systemctl stop studyrooms-bot`.
3. **Limpar a fila e a quarentena da VM:**

   ```
   docker compose -p studyrooms run --rm --no-deps --entrypoint node bot src/quarantine-cli.ts esquecer ID_DA_PESSOA
   ```

4. **Ligar o bot:** `sudo systemctl start studyrooms-bot`. A partir daqui, nada novo da pessoa é gravado.
5. **Apagar no Neon**, no PC. Sem `--confirm`, o comando só conta; com ele, apaga de vez:

   ```
   pnpm --filter @studyrooms/db neon forget ID_DA_PESSOA
   pnpm --filter @studyrooms/db neon forget ID_DA_PESSOA --confirm
   pnpm --filter @studyrooms/db neon count ID_DA_PESSOA
   ```

   O último comando deve mostrar 0.
6. **Fila local do PC**, se o bot rodou no PC com essa pessoa na lista: `node apps/bot/src/quarantine-cli.ts esquecer ID_DA_PESSOA`, com o bot local parado.
7. **Cópias que sobram:** os backups locais da F1-24 (em `backups/`, apagados depois de 30 dias) e o histórico de restauração do próprio Neon ainda têm os eventos até expirarem. O que fazer com eles está em aberto (veja Decisões pendentes da F1-48).
8. Anote a data do pedido e da exclusão num lugar privado, sem o ID.

## Problemas comuns

O erro aparece só como código, nunca com a URL.

| Código | Causa provável | O que fazer |
|---|---|---|
| Mensagem `não definida` | Variável ausente ou vazia no `.env` | Confira o nome e se o `.env` está na raiz |
| `sem SSL obrigatório` | Falta `?sslmode=verify-full` no fim da URL | Acrescente |
| `aponta para a máquina local` | A variável `NEON_*` recebeu a conexão do banco local | Use a URL do painel do Neon |
| `28P01` | Senha errada | `neondb_owner`: copie de novo do painel. Bot ou backup: `neon roles --rotate` |
| `ENOTFOUND`, `EAI_AGAIN` | Host errado ou sem internet | Copie a URL de novo |
| `3D000` | Banco inexistente | O banco do Neon é `neondb`, salvo se você criou outro |
| `42501` | Permissão negada | No `check`, é falha de permissão: rode `neon roles` de novo (ele reaplica as permissões) |
| `53300` | Conexões demais | O bot tem limite de 3 conexões, e o backup, de 2. Confira se não há dois bots rodando |
| `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Antivírus ou proxy inspecionando o TLS | Desligue a inspeção de HTTPS para `*.neon.tech` |
