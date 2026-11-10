# Runbook: bot na Oracle, do zero (F0-06)

Passo a passo para criar a VM do bot na Oracle Cloud, preparar o Ubuntu, subir o bot com o systemd e medir a estabilidade da F0-06. Quem executa é o usuário. A supervisão e a operação do dia a dia (códigos de saída, reinícios, comandos do systemd) estão no [runbook do bot na VM](vm-bot.md).

**Regras deste runbook:**

- Nenhum segredo passa pelo chat: token do Discord, conexão do Neon e chave SSH privada ficam só no seu PC e na VM. Se precisar de ajuda, mande as mensagens de erro, nunca o `.env`.
- O log do bot tem IDs do Discord (usuário e canal). Não cole o log no chat; use os comandos de contagem deste runbook, que não mostram IDs.
- A VM do n8n (a `VM.Standard.E2.1.Micro` que já existe) **não é tocada**: nem a VM nem a rede dela.
- Só recursos marcados como **Always Free**. Não faça "Upgrade to Paid" para fugir de falta de capacidade.

Os nomes dos botões do console da Oracle mudam de vez em quando. Se algum não bater, procure o equivalente na mesma tela.

## Visão geral

| Etapa | Onde | Tempo aproximado |
|---|---|---|
| 1. Chave SSH | PowerShell no PC | 5 min |
| 2. Criar a VM | Console da Oracle | 15 min (mais as tentativas, se faltar capacidade) |
| 3. Rede e firewall | Console da Oracle e VM | 10 min |
| 4. Preparar o Ubuntu e o Docker | VM, por SSH | 20 min |
| 5. Clonar o código | VM | 5 min |
| 6. Criar o `.env` | VM | 10 min |
| 7. Construir, ligar e verificar | VM e PC | 30 min |
| 8. Medições (72 h e 7 dias) | Console, VM e PC | alguns minutos por dia |

## 1. Chave SSH no Windows

O Windows 10 já tem o cliente OpenSSH (`C:\Windows\System32\OpenSSH`, versão 9.5, conferido em 2026-11-10). Não precisa instalar nada.

A chave fica em `C:\Users\<você>\.ssh`, a pasta padrão do SSH. É um arquivo de poucos bytes, então não pesa no C:, e o OpenSSH do Windows confere as permissões dessa pasta. **Nunca** guarde a chave dentro da pasta do projeto (`A:\PRJ\...`), no OneDrive ou em pasta compartilhada.

No PowerShell:

```powershell
ssh-keygen -t ed25519 -C "studyrooms-oracle-bot" -f "$env:USERPROFILE\.ssh\studyrooms_oracle_ed25519"
```

- Ele pede uma **passphrase** (senha da chave). Use uma, de preferência guardada num gerenciador de senhas: se alguém copiar o arquivo da chave, sem a passphrase ele não serve. A passphrase é pedida a cada conexão.
- São criados dois arquivos:
  - `studyrooms_oracle_ed25519`: a chave **privada**. Nunca compartilhe, nunca cole em chat, e-mail ou issue, nunca envie para a VM.
  - `studyrooms_oracle_ed25519.pub`: a chave **pública**. É esta que vai para a Oracle; pode ser mostrada sem problema.

Confira as permissões da privada:

```powershell
icacls "$env:USERPROFILE\.ssh\studyrooms_oracle_ed25519"
```

O esperado é aparecer só o seu usuário, `SYSTEM` e `Administradores`. Se o `ssh` reclamar de `UNPROTECTED PRIVATE KEY FILE` mais tarde, restrinja ao seu usuário:

```powershell
icacls "$env:USERPROFILE\.ssh\studyrooms_oracle_ed25519" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Mostre a pública para copiar no passo 2:

```powershell
Get-Content "$env:USERPROFILE\.ssh\studyrooms_oracle_ed25519.pub"
```

É uma linha só, começando por `ssh-ed25519`.

**Cópia de segurança:** guarde a privada e a passphrase no gerenciador de senhas (ou num pendrive guardado). Se perder a chave, não há como entrar na VM por SSH; a saída mais simples é recriar a VM e refazer este runbook (a fila do bot na VM se perde, mas os eventos já gravados no Neon ficam).

Se o console da Oracle recusar a chave `ed25519`, gere uma RSA no lugar e use os mesmos passos com o novo nome:

```powershell
ssh-keygen -t rsa -b 4096 -C "studyrooms-oracle-bot" -f "$env:USERPROFILE\.ssh\studyrooms_oracle_rsa"
```

## 2. Criar a VM no console da Oracle

**Antes de tudo, confira o tipo da conta:** Menu (☰) → **Billing & Cost Management** → **Upgrade and Manage Payment** (ou **Subscriptions**). Deve aparecer **Free Tier** (ou "Always Free"), e não "Pay As You Go". Se aparecer outra coisa, pare e avise a equipe antes de criar a VM: numa conta paga, uma escolha errada no formulário pode gerar cobrança.

1. Entre em <https://cloud.oracle.com> e confira, no alto à direita, que a região é **Brazil East (Sao Paulo)**.
2. Menu (☰) → **Compute** → **Instances** → **Create instance**.
3. **Name:** `studyrooms-bot`.
4. **Compartment:** o compartimento raiz da conta (o que tem o nome da conta, com `(root)`), a não ser que a VM do n8n esteja em outro e você prefira o mesmo. O compartimento só organiza; não muda custo.
5. **Placement:** São Paulo tem um só domínio de disponibilidade (`AD-1`). Deixe o padrão. O **fault domain** pode ficar em "let Oracle choose".
6. **Image and shape** → **Edit**:
   1. **Change shape** → **Virtual machine** → **Ampere** → marque **VM.Standard.A1.Flex**.
   2. Ajuste **Number of OCPUs: 1** e **Amount of memory (GB): 2**. O padrão da Oracle é 6 GB por OCPU; baixe para 2.
   3. Confirme com **Select shape**. Ao lado da forma deve aparecer o selo **Always Free-eligible**.
   4. **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** (não a "Minimal"). Com a forma Ampere escolhida, o console oferece a versão **aarch64** (ARM); confira que o nome da imagem termina com `aarch64-...`. Também deve ter o selo **Always Free-eligible**.
7. **Security:** deixe como está (Shielded instance desligada; a A1 não precisa).
8. **Networking** (veja também o passo 3):
   - **Recomendado:** **Create new virtual cloud network** e **Create new public subnet**, com os nomes sugeridos ou `studyrooms-vcn` e `studyrooms-subnet`. Assim a VM do bot não herda as regras de entrada da rede do n8n (que pode ter portas do n8n abertas), e mexer numa não afeta a outra. A franquia gratuita inclui 2 VCNs; se o console disser que o limite foi atingido, use a opção abaixo.
   - **Alternativa:** **Select existing virtual cloud network**, a mesma do n8n, e a subnet pública dela. Nesse caso, **não altere** a lista de segurança do n8n; no passo 3, crie um Network Security Group só para o bot.
   - **Automatically assign public IPv4 address:** marcado (a VM precisa de saída para a internet, e você precisa do IP para o SSH).
9. **Add SSH keys** → **Paste public keys** → cole a linha do `.pub` do passo 1. Nunca cole a privada.
10. **Boot volume:** deixe o padrão (cerca de 47 GB), sem **Specify a custom boot volume size**. A franquia gratuita é de 200 GB de disco no total, somando os discos de boot: n8n (cerca de 47 GB) mais o bot (cerca de 47 GB) cabem com folga. Deixe a criptografia em trânsito no padrão.
11. Revise e clique em **Create**.

**Faça o passo 3 logo em seguida.** A rede criada pelo assistente deixa a porta 22 aberta para qualquer IP (`0.0.0.0/0`) até você restringi-la. O login só aceita a sua chave, mas, quanto menos tempo a porta ficar aberta para todos, melhor. Restrinja antes mesmo do primeiro acesso.

A VM aparece como **Provisioning** e depois **Running**. Anote, num lugar seu, o **Public IP address** que aparece na página da instância.

**Como saber que tudo é Always Free:** a forma e a imagem têm o selo **Always Free-eligible**; a conta está em Free Tier (sem cobrança), e recursos pagos nem seriam criados sem upgrade. Para confirmar, depois de um ou dois dias: Menu → **Billing & Cost Management** → **Cost Analysis**, que deve mostrar 0,00. Em **Governance** → **Limits, Quotas and Usage**, o uso de A1 deve ficar em 1 de 2 OCPUs e 2 de 12 GB.

### Se aparecer "Out of capacity"

A mensagem é algo como `Out of capacity for shape VM.Standard.A1.Flex in availability domain AD-1`. Significa falta temporária de máquinas gratuitas na região; não é erro seu nem cobra nada.

1. Tente de novo em outro **fault domain** (FD-1, FD-2, FD-3), no mesmo formulário.
2. Tente em outros horários (madrugada e início da manhã costumam ter mais sobra) por um ou dois dias. O formulário pode ser refeito em 2 minutos; não há outro domínio de disponibilidade em São Paulo.
3. **Plano B:** se não sair em até 2 dias (ou antes, se preferir), crie a segunda **VM.Standard.E2.1.Micro** da franquia, com os mesmos passos, mudando só:
   - **Change shape** → **Virtual machine** → **Specialty and previous generation** → **VM.Standard.E2.1.Micro** (1 OCPU AMD, 1 GB, Always Free-eligible);
   - imagem **Canonical Ubuntu 24.04** na versão **x86_64** (não a aarch64);
   - no passo 4, o swap de 2 GB passa a ser obrigatório.

   A imagem do bot é multiarquitetura e roda nas duas. Avise a equipe qual forma foi criada: muda a medição de memória no passo 8 (o limite de memória do reclaim vale só para A1).

Não faça upgrade para conta paga para ganhar capacidade: sai da regra de planos gratuitos.

## 3. Rede e firewall

O bot só faz conexões **de saída** (Discord, Neon, e na preparação `apt`, Docker Hub e GitHub). Ele não abre nenhuma porta. A única entrada necessária é o SSH (porta 22), e só para o seu IP.

### Restringir o SSH ao seu IP

1. Descubra seu IP público, no PowerShell:

   ```powershell
   curl.exe -s https://ifconfig.me
   ```

2. No console: Menu → **Networking** → **Virtual cloud networks** → `studyrooms-vcn` → aba **Security** (ou **Security Lists**) → **Default Security List for studyrooms-vcn** → **Ingress rules** (ou **Security rules**).
3. Edite a regra com **Destination Port Range 22**: troque **Source CIDR** de `0.0.0.0/0` para `SEU.IP.AQUI/32`. Salve.
4. Não acrescente nenhuma outra regra de entrada. Pode deixar as duas regras ICMP que vieram por padrão (servem para a rede ajustar o tamanho dos pacotes). As regras de **saída** (Egress) ficam como estão: tudo liberado.

**Se você usou a VCN do n8n (alternativa do passo 2):** não edite a lista de segurança dela. Na mesma VCN, crie em **Network Security Groups** um grupo `studyrooms-bot-nsg` com uma só regra de entrada (TCP 22, origem `SEU.IP.AQUI/32`) e associe o grupo à placa de rede da VM (página da instância → **Attached VNICs** → a VNIC → **Edit** → Network security groups). Atenção: as regras da lista de segurança da subnet continuam valendo para a VM do bot também; confira com a equipe quais portas a lista do n8n abre.

**Se seu IP mudar** (comum em internet residencial), o SSH passa a dar `Connection timed out`. Não é preciso entrar na VM para resolver: repita os passos 1 a 3 com o IP novo. O bot continua rodando nesse meio tempo.

### Firewall dentro do Ubuntu

As imagens Ubuntu da Oracle já vêm com regras de `iptables` que só aceitam SSH na entrada e recusam o resto, salvas pelo `netfilter-persistent`. **Não ligue o `ufw`**: ele briga com essas regras e com as regras que o Docker cria. Para conferir, depois do primeiro acesso:

```bash
sudo iptables -L INPUT -n --line-numbers
```

O esperado é ver uma regra `ACCEPT` para `tcp dpt:22` e, no fim, uma `REJECT`. Não abra portas aqui.

## 4. Primeiro acesso e preparação do Ubuntu

### Atalho de SSH no PC

Crie (ou edite) o arquivo `C:\Users\<você>\.ssh\config`, sem extensão, com:

```
Host studyrooms-bot
    HostName IP.PUBLICO.DA.VM
    User ubuntu
    IdentityFile ~/.ssh/studyrooms_oracle_ed25519
    IdentitiesOnly yes
```

Conecte:

```powershell
ssh studyrooms-bot
```

Na primeira vez, ele mostra a impressão digital da VM e pergunta se confia: responda `yes`. Depois pede a passphrase da chave. O usuário é `ubuntu`, que tem `sudo`; o login como `root` vem desligado.

Todos os comandos daqui em diante, até o passo 7, rodam **na VM**.

### Atualizar

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
sudo reboot
```

As opções evitam as telas interativas do Ubuntu 24.04: `NEEDRESTART_MODE=a` reinicia sozinho os serviços atualizados (a tela roxa do `needrestart`), e `--force-confold` mantém os arquivos de configuração locais, como o `sshd_config` ajustado pelo cloud-init da Oracle. Se mesmo assim aparecer uma tela perguntando sobre um arquivo de configuração, escolha **keep the local version currently installed** (manter a versão local); se for a lista de serviços a reiniciar, só aperte **Enter**.

Espere um minuto e conecte de novo. As atualizações de segurança automáticas (`unattended-upgrades`) já vêm ligadas e não reiniciam a VM sozinhas.

### Swap

Com 2 GB, um swap pequeno evita que o kernel mate um processo num pico (por exemplo, durante o build da imagem). Na E2.1.Micro do plano B, com 1 GB, use `2G` no lugar de `1G`.

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system
free -m
```

O `free -m` deve mostrar a linha `Swap` com cerca de 1023.

### Fuso em UTC e relógio

```bash
sudo timedatectl set-timezone UTC
timedatectl
```

O esperado é `Time zone: Etc/UTC (UTC, +0000)` e `System clock synchronized: yes`. O bot já grava tudo em UTC; o fuso da VM em UTC deixa os logs na mesma referência.

### Docker Engine e plugin compose (repositório oficial)

Os comandos abaixo seguem o guia oficial do Docker para Ubuntu e funcionam igual em ARM (aarch64) e x86:

```bash
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Confira:

```bash
sudo docker run --rm hello-world
docker compose version
systemctl is-enabled docker
```

O `hello-world` imprime `Hello from Docker!`; o último comando, `enabled` (o Docker sobe sozinho no boot, e o bot depende disso).

### Usuário de operação, sem root

- Você entra como `ubuntu`, não como `root`.
- O bot roda dentro do container como o usuário `node`, sem privilégios, com o sistema de arquivos só leitura (`read_only`, `cap_drop: ALL` no `compose.yaml`).
- Para rodar `docker` sem `sudo`, ponha o `ubuntu` no grupo `docker`:

  ```bash
  sudo usermod -aG docker ubuntu
  exit
  ```

  Conecte de novo para valer. **Atenção:** quem está no grupo `docker` tem, na prática, poder de root na máquina. Por isso a chave SSH com passphrase e o SSH restrito ao seu IP importam. Se preferir não usar o grupo, pule este passo e ponha `sudo` na frente de cada `docker`.

## 5. Levar o código para a VM

O repositório <https://github.com/JKranmer/StudyRooms> estava **público** em 2026-11-10 (a API do GitHub respondeu 200 sem login). Então basta clonar:

```bash
sudo mkdir -p /opt/studyrooms
sudo chown ubuntu:ubuntu /opt/studyrooms
git clone --branch dev --single-branch https://github.com/JKranmer/StudyRooms.git /opt/studyrooms
cd /opt/studyrooms
git log -1 --oneline
```

Anote o commit mostrado pelo `git log` (ele entra nas medições).

**Se o repositório virar privado:** use uma *deploy key* só de leitura, específica da VM.

1. Na VM: `ssh-keygen -t ed25519 -C "studyrooms-vm-deploy" -f ~/.ssh/studyrooms_deploy` (aqui, sem passphrase, porque a VM precisa usá-la sozinha; ela só lê este repositório).
2. `cat ~/.ssh/studyrooms_deploy.pub` e, no GitHub: repositório → **Settings** → **Deploy keys** → **Add deploy key**, colando a pública, com **Allow write access desmarcado**.
3. Na VM, crie `~/.ssh/config` com:

   ```
   Host github.com
       IdentityFile ~/.ssh/studyrooms_deploy
       IdentitiesOnly yes
   ```

4. Clone com `git clone --branch dev --single-branch git@github.com:JKranmer/StudyRooms.git /opt/studyrooms` (para um clone já existente: `git -C /opt/studyrooms remote set-url origin git@github.com:JKranmer/StudyRooms.git`).

## 6. O `.env` da VM

O `.env` da VM tem **só três variáveis**:

| Variável | Valor |
|---|---|
| `DISCORD_BOT_TOKEN` | O token **novo** do bot (veja o aviso abaixo) |
| `BOT_TEST_ALLOWLIST_USER_IDS` | Só o seu ID do Discord (D-29: só você está na lista) |
| `BOT_DATABASE_URL` | O **valor** de `NEON_BOT_URL` do `.env` do PC (o texto depois do `=`) |

**Nunca** coloque `NEON_ADMIN_URL` nem `NEON_BACKUP_URL` na VM: se ela for invadida, com `NEON_BOT_URL` só dá para inserir eventos; com as outras, daria para ler ou apagar tudo. `BOT_QUEUE_DIR` não entra: no container, o padrão já é o volume da fila.

**Troque o token do bot antes.** O token atual vazou num teste. No [Discord Developer Portal](https://discord.com/developers/applications) → sua aplicação → **Bot** → **Reset Token**. O token antigo para de funcionar na hora. Atualize também o `DISCORD_BOT_TOKEN` do `.env` do PC, e use o novo na VM.

**Como criar sem passar os segredos pelo chat:** você copia os valores do seu `.env` do PC (aberto no seu editor) e cola direto no editor da VM, pela sessão SSH, que é cifrada. Nada vai para o chat, para arquivos temporários ou para o histórico do shell.

Na VM:

```bash
cd /opt/studyrooms
install -m 600 /dev/null .env
nano .env
```

O `install` cria o arquivo vazio já com permissão 600 (só o `ubuntu` lê e escreve; o systemd roda como root e também lê). No `nano`, escreva:

```
DISCORD_BOT_TOKEN=
BOT_TEST_ALLOWLIST_USER_IDS=
BOT_DATABASE_URL=
```

e cole cada valor depois do `=`, sem aspas e sem espaços. No PowerShell do Windows, colar no terminal é com o botão direito do mouse. Salve com `Ctrl+O`, `Enter`, e saia com `Ctrl+X`.

Confira, sem mostrar valores:

```bash
ls -l .env
grep -c '=' .env
cut -d= -f1 .env
docker compose config --quiet && echo "compose ok"
```

O esperado é `-rw-------` com dono `ubuntu`, `3`, os três nomes de variável (sem valores) e `compose ok`. Se a linha da conexão do banco terminar com `sslmode=verify-full`, está certa (D-50).

Nunca rode `cat .env`, `docker compose config` sem `--quiet` ou `env` com o bot no ar, se alguém estiver vendo sua tela: todos mostram os segredos.

## 7. Construir, ligar e verificar

### Construir a imagem na VM

```bash
cd /opt/studyrooms
docker compose build bot
uname -m
docker image inspect studyrooms-bot:local --format '{{.Architecture}}'
```

O `uname -m` deve mostrar `aarch64` (na A1) ou `x86_64` (no plano B), e o último comando, `arm64` ou `amd64`, respectivamente. A imagem é construída na própria VM, para a arquitetura dela. O primeiro build demora alguns minutos; anote quanto.

### Instalar e ligar a unidade do systemd

```bash
sudo install -m 644 /opt/studyrooms/deploy/systemd/studyrooms-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now studyrooms-bot
systemctl status studyrooms-bot --no-pager -n 0
```

O esperado é `active (running)`. O `-n 0` esconde as últimas linhas do log, que o `systemctl status` mostraria e podem ter IDs do Discord; use-o sempre que alguém puder ver sua tela. Detalhes da unidade, dos códigos de saída e dos reinícios: [runbook do bot na VM](vm-bot.md#supervisão-pelo-systemd).

**Só uma instância do bot por vez.** A fila em disco (F1-47) não tem trava contra dois processos na mesma pasta. Com a unidade ativa, não rode outro bot na VM (`docker compose run`, `docker compose up` com outro `-p`, ou `node` fora do Docker), e **desligue o bot do PC** enquanto o da VM estiver no ar: os dois usam o mesmo token, e dois bots com o mesmo token disputam a conexão com o Discord.

### Ver o log sem expor IDs

Os comandos abaixo mostram só as linhas sem IDs ou só contagens:

```bash
journalctl -u studyrooms-bot -b --no-pager -o cat | grep -E '^\[(bot|fila|db|systemd)\]' | tail -n 20
```

O esperado, logo depois de ligar: `[bot] conectado como "...#...."; servidores: 1.` Linhas `[db] ... acesso=N` contam os acessos ao Neon.

Para ver o log completo (com IDs), só na sua tela: `journalctl -u studyrooms-bot -f`. Não copie esse log para o chat.

### Roteiro de verificação (o mesmo da F0-02, no ambiente hospedado)

1. No Discord, **entre** num canal de voz do servidor de teste, espere uns 10 segundos, **troque** para outro canal de voz, espere, e **saia**.
2. Na VM, conte o que o bot viu nos últimos 10 minutos, sem IDs:

   ```bash
   journalctl -u studyrooms-bot --since "-10min" -o cat | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z (entrou|saiu|trocou|visto)(_na_queda)? ' | awk '{print $2}' | sort | uniq -c
   ```

   O esperado é pelo menos `1 entrou`, `1 trocou` e `1 saiu`. O padrão só olha a palavra logo depois do horário no início da linha, então um nome de canal com "saiu" ou "entrou" não muda a contagem.

3. No **PC**, na pasta do projeto, confira que chegou ao Neon (usa a conexão só leitura do backup, `NEON_BACKUP_URL`, e não mostra IDs):

   ```powershell
   pnpm --filter @studyrooms/db neon summary --hours 1
   ```

   Exemplo do formato:

   ```
   Eventos no Neon na última 1 h (horários em UTC):
     voice_join         1  último em 2026-11-10 21:03:12
     voice_leave        1  último em 2026-11-10 21:04:05
     voice_move         1  último em 2026-11-10 21:03:40
     voice_present      0
     bot_start          1  último em 2026-11-10 21:00:01
     ...
   Total: 4. Pessoas distintas: 1. Última gravação no banco: 2026-11-10 21:04:06.
   ```

   O esperado: `voice_join`, `voice_move` e `voice_leave` com pelo menos 1, `bot_start` com 1 e **Pessoas distintas: 1** (só você). Os eventos podem levar alguns segundos para chegar; se ainda não estiverem lá, rode de novo em 1 minuto. Para outro período, troque `--hours 1` (de 1 a 720).

   Se o resumo não mostrar nada e o log da VM mostrar os eventos, confira no log `[fila]` e `[db]` (o bot guarda na fila em disco quando o banco não responde) e o `BOT_DATABASE_URL` do `.env` da VM.

4. **Reinício da máquina** (comportamento da F0-12): na VM, `sudo reboot`. Espere 2 minutos, conecte e rode:

   ```bash
   systemctl status studyrooms-bot --no-pager -n 0
   systemctl show -p NRestarts -p ActiveEnterTimestamp studyrooms-bot
   ```

   O esperado: `active (running)`, `NRestarts=0` (o boot não conta como reinício por falha) e o horário de entrada logo depois do boot. No PC, `neon summary --hours 1` deve mostrar um `bot_start` a mais.

**A coleta começa aqui.** Com `BOT_DATABASE_URL` apontando para o Neon, cada entrada e saída sua passa a ser gravada a partir desta subida. Anote a data e a hora (UTC) do primeiro `bot_start` que aparecer no resumo: é a data de início da coleta, que a F1-49 registra no roadmap.

### Atualizar o bot depois

```bash
cd /opt/studyrooms
git pull --ff-only
docker compose build bot
sudo systemctl restart studyrooms-bot
systemctl status studyrooms-bot --no-pager -n 0
docker image prune -f
```

O `docker image prune -f` apaga só as imagens **sem nome** (`<none>`), que sobram quando o build dá o nome `studyrooms-bot:local` à imagem nova. A imagem em uso nunca é apagada: o Docker não remove imagem com nome nem imagem usada por um container. Rode-o só depois de ver `active (running)`. Não use `docker image prune -a` nem `docker system prune -a`: eles apagariam também imagens com nome que estejam paradas (inclusive a do bot, se ele estiver parado), e o bot não voltaria no boot (a unidade usa `--no-build` e sairia com 78). Também nunca use `docker volume prune` nem `down -v`: apagam a fila em disco com os eventos pendentes.

## 8. Medições da F0-06

O que a F0-06 precisa provar: bot no ar por **72 h seguidas, sem intervenção**; volta sozinho depois do reboot; custo zero; e, ao longo de **7 dias**, como a VM fica em relação à regra de recuperação de instâncias ociosas da Oracle (ADR 0004).

**A regra de ociosidade da Oracle:** uma instância Always Free pode ser recuperada (*reclaimed*) se, num período de 7 dias, ao mesmo tempo, a CPU no percentil 95 ficar abaixo de 20%, o uso de rede abaixo de 20% e (só na A1) o uso de memória abaixo de 20%. Um bot quieto fica com CPU e rede bem abaixo disso. Na A1, a memória é o que decide: com 2 GB, se o uso total da VM ficar abaixo de cerca de 410 MB, os três limites ficam abaixo de 20%. Por isso a memória é a medida mais importante. O ADR 0004 registra que a Oracle não diz se avisa antes nem se a VM é parada ou apagada.

### Durante as primeiras 72 h

Não mexa na VM nem no bot (sem `restart`, sem `git pull`). Uma vez por dia, de preferência no mesmo horário, na VM:

```bash
date -u
uptime
systemctl show -p NRestarts -p ActiveEnterTimestamp studyrooms-bot
journalctl -u studyrooms-bot --since "-24h" -o cat | grep -c '^\[bot\] conectado'
free -m
docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}'
df -h /
```

E no PC:

```powershell
pnpm --filter @studyrooms/db neon summary --hours 24
```

Cada `neon summary` acorda o Neon por alguns minutos e gasta um pouco das horas do plano gratuito: uma vez por dia basta.

O bot grava um sinal (`bot_heartbeat`) a cada 30 min (D-19): em 24 h no ar, o resumo deve mostrar perto de 48. Bem menos que isso indica que o bot ficou fora do ar ou sem banco por um tempo.

No fim das 72 h, `neon summary --hours 72` dá o total do período, incluindo `bot_disconnect` e `bot_resume` (quedas e retomadas da conexão com o Discord, que o bot resolve sozinho e não contam como intervenção).

**Passou nas 72 h se:** `NRestarts=0`, o `ActiveEnterTimestamp` é o mesmo do início (ninguém reiniciou), `[bot] conectado` apareceu só na subida, e o roteiro de voz continua gravando no Neon.

### Durante os 7 dias, no console da Oracle

Página da instância → **Metrics** (as métricas vêm do Oracle Cloud Agent, ligado por padrão nas imagens da Oracle; se aparecer "no data", confira em **Oracle Cloud Agent** que o plugin **Compute Instance Monitoring** está ativo).

Para o percentil 95, use Menu → **Observability & Management** → **Monitoring** → **Metrics Explorer**, namespace `oci_computeagent`, com a instância selecionada, em modo de consulta (**Advanced mode**):

```
CpuUtilization[1d].percentile(0.95)
MemoryUtilization[1d].mean()
NetworksBytesIn[1d].sum()
NetworksBytesOut[1d].sum()
```

Uma vez por dia (ou de uma vez no fim dos 7 dias, com o período de 7 dias selecionado), anote os valores.

### O que anotar

Guarde num lugar seu e repasse à equipe (nenhum desses dados é segredo, mas não inclua IP nem IDs):

| Item | Quando |
|---|---|
| Forma obtida (A1 1 OCPU / 2 GB, ou E2.1.Micro do plano B), quantas tentativas e se houve "Out of capacity" | Na criação |
| Saída de `uname -m` e a arquitetura da imagem (`arm64` ou `amd64`) | Passo 7 |
| Commit do clone (`git log -1 --oneline`) e tempo do primeiro build | Passo 7 |
| Data e hora UTC do início (primeiro `bot_start` no resumo) | Passo 7 |
| Resultado do roteiro de voz e do teste de reboot | Passo 7 |
| Por dia: `NRestarts`, número de `[bot] conectado`, memória usada (`free -m`, coluna `used`), memória do container (`docker stats`), uso de disco | 72 h e 7 dias |
| Fim das 72 h: `neon summary --hours 72` (só as contagens) e se houve alguma intervenção | 72 h |
| Por dia: CPU p95, memória média (%), bytes de rede de entrada e saída | 7 dias |
| Custo em **Cost Analysis** (deve ser 0,00) | Fim dos 7 dias |
| Qualquer e-mail ou aviso da Oracle sobre instância ociosa | Sempre |
| Horas de computação do Neon nas primeiras 24 h (painel do Neon → **Usage** ou **Monitoring**) | 24 h após o início (vale também para a F1-49) |

Se a memória média ficar abaixo de 20% ao longo dos dias, avise a equipe: a resposta é decisão do usuário (veja as decisões pendentes da F0-06).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ssh: connect to host ... Connection timed out` | Seu IP mudou, ou a regra da porta 22 está errada | Passo 3, com o IP atual |
| `Permission denied (publickey)` | Chave errada no `IdentityFile`, ou a pública colada não é a desta chave | Confira o `config` do SSH; compare o `.pub` com a chave mostrada na página da instância |
| `UNPROTECTED PRIVATE KEY FILE` | Permissões largas na chave privada | O `icacls` do passo 1 |
| `permission denied ... docker.sock` | O `ubuntu` não está no grupo `docker` (ou não reconectou) | Passo 4, "Usuário de operação", e conecte de novo |
| Unidade `failed` com `status=78/CONFIG` | Erro de configuração: token, lista, conexão do banco, `.env` ausente, imagem não construída | `journalctl -u studyrooms-bot -b -o cat \| grep -E '^\[(bot\|systemd)\]'` mostra a causa; corrija e rode `sudo systemctl restart studyrooms-bot` |
| `[bot] conectado` não aparece e o log repete tentativas de login | Sem saída para a internet | Confira as regras de saída (Egress) da VCN e se a subnet tem Internet Gateway (a VCN criada pelo assistente já tem) |
| O build falha baixando pacotes | Mesmo caso acima, ou o Docker Hub fora | Tente de novo; confira a saída para a internet |
| Bot morto com código 137 | Faltou memória | Confira o swap (passo 4) e `free -m` |
| Bot do PC e da VM ligados ao mesmo tempo | Mesmo token em dois lugares | Desligue o do PC |
