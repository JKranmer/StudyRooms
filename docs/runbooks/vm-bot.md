# Runbook: bot na VM

Este runbook trata da supervisão e da operação do bot na VM (F0-12). A subida completa na Oracle, do zero (chave SSH, criação da VM, rede, Docker, clone, `.env`, verificação e medições de 72 h e 7 dias da F0-06), está em [vm-oracle.md](vm-oracle.md).

## Supervisão pelo systemd

O Docker não sabe deixar de reiniciar um container conforme o código de saída. Por isso, na VM, quem cuida do bot é o systemd, com a unidade [`deploy/systemd/studyrooms-bot.service`](../../deploy/systemd/studyrooms-bot.service), e o `compose.yaml` fica com `restart: "no"` para o bot.

| Situação | O que o bot faz | O que o systemd faz |
|---|---|---|
| Sem internet ou Discord fora no login | Não sai: tenta de novo em 5 s, 10 s, 30 s, 1 min, 2 min e depois a cada 5 min | Nada |
| Erro de configuração: token inválido, allowlist malformada, `BOT_DATABASE_URL` ausente ou inválida, intents recusadas (4004, 4013, 4014), pasta da fila sem permissão | Sai com código 78 | Não reinicia. A unidade fica `failed`, com o erro no log |
| Erro de configuração da VM: sem `.env` na pasta do clone, `compose.yaml` ou `.env` inválidos, imagem não construída (a unidade usa `--no-build`) | Nem chega a subir: o script de início sai com 78, com a causa no log (`[systemd] erro: ...`) | Não reinicia. A unidade fica `failed` |
| Docker sem responder na hora de subir | Nem chega a subir: o script de início sai com 1 | Reinicia, com a espera crescente abaixo |
| Outra falha: código sem reconexão (como 4011), processo morto pelo kernel (137) | Sai com código 1 ou é morto | Reinicia depois de 15 s; a espera dobra a cada nova falha, até 10 min |
| `docker compose stop bot` ou `systemctl stop studyrooms-bot` | Encerra em até 3 s, com código 0 | Não reinicia |
| Reboot da VM ou reinício do Docker | Encerra com código 0 | Sobe o bot de novo quando o Docker voltar |
| Disco cheio ao subir, com linhas ilegíveis na fila | Sobe mesmo assim; as linhas ficam na fila até caber a quarentena, com aviso no log | Nada |

A espera crescente do systemd (`RestartSteps`) exige systemd 254 ou mais novo, como o do Ubuntu 24.04. Em versões antigas, a linha é ignorada, e a espera fica fixa em 15 s.

**O contador de reinícios não zera sozinho.** Ele só volta a 0 num `start` ou `restart` manual; ficar dias no ar não o zera. Depois de cerca de 6 reinícios automáticos, toda nova queda espera 10 min antes de o bot voltar. Para conferir: `systemctl show -p NRestarts studyrooms-bot`. Para zerar, depois de ver no log o motivo das quedas: `sudo systemctl restart studyrooms-bot`. Erro de rede no login não conta, porque o bot tenta de novo sem sair.

### Instalar

Na VM, com o repositório em `/opt/studyrooms`, o `.env` real na raiz e a imagem já construída (`docker compose build bot`):

```
sudo install -m 644 /opt/studyrooms/deploy/systemd/studyrooms-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now studyrooms-bot
```

A unidade chama [`deploy/systemd/studyrooms-bot-start.sh`](../../deploy/systemd/studyrooms-bot-start.sh), que confere o `.env`, o compose e a imagem e então roda o `docker compose up` em primeiro plano, preso ao container do bot. A imagem nunca é construída no boot (`--no-build`). Se o clone não estiver em `/opt/studyrooms`, ajuste `WorkingDirectory` e `ExecStart` na unidade.

### Operar

```
systemctl status studyrooms-bot           # estado e último código de saída
journalctl -u studyrooms-bot -f            # log do bot (o mesmo do docker compose logs)
sudo systemctl restart studyrooms-bot      # depois de corrigir o .env ou trocar a imagem
sudo systemctl stop studyrooms-bot         # para até o próximo boot
sudo systemctl disable --now studyrooms-bot  # para e não volta no boot
```

- `docker compose stop bot` também para o bot até o próximo boot. Para ele não voltar no boot, use `disable`.
- Depois de um erro de configuração (código 78, `status=78/CONFIG` no `systemctl status`), corrija o `.env` ou construa a imagem e rode `sudo systemctl restart studyrooms-bot`.
- Só uma instância do bot pode rodar sobre o volume da fila: a fila em disco não tem trava contra duas. Com a unidade ativa, não suba outro bot com `docker compose run`, com outro nome de projeto (`-p`) nem fora do Docker.
