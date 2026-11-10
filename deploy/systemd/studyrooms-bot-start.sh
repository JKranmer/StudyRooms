#!/bin/sh
# Início do bot pela unidade systemd (studyrooms-bot.service), rodado na pasta do clone.
# Erro de configuração no nível do compose (sem `.env`, compose inválido, imagem não construída)
# sai com 78, como os erros de configuração do próprio bot: o systemd não reinicia, e a unidade
# fica `failed` com a causa no log. Nenhum valor do `.env` é impresso.
set -u

IMAGE="studyrooms-bot:local" # o mesmo `image:` do serviço bot em compose.yaml

if [ ! -f "${BOT_ENV_FILE:-.env}" ]; then
  echo "[systemd] erro: arquivo de ambiente não encontrado na pasta $(pwd). Crie o .env (veja .env.example)." >&2
  exit 78
fi
# Cada checagem tem prazo: com o dockerd travado (vivo, sem responder), o script não pode ficar
# parado com a unidade `active` e sem bot. Prazo vencido (124 do `timeout`) é passageiro: sai com 1.
CHECK_TIMEOUT="${STUDYROOMS_CHECK_TIMEOUT:-30}"
case "$CHECK_TIMEOUT" in
  '' | *[!0-9]* | 0)
    echo "[systemd] erro: STUDYROOMS_CHECK_TIMEOUT inválido; use um número inteiro de segundos maior que 0." >&2
    exit 78
    ;;
esac

timeout "$CHECK_TIMEOUT" docker compose --project-name studyrooms config --quiet >/dev/null 2>&1
status=$?
if [ "$status" -eq 124 ]; then
  echo "[systemd] aviso: o docker compose não respondeu em ${CHECK_TIMEOUT} s; nova tentativa pelo systemd." >&2
  exit 1
elif [ "$status" -ne 0 ]; then
  echo "[systemd] erro: compose.yaml ou .env inválido. Rode 'docker compose config --quiet' na pasta $(pwd) para ver o motivo." >&2
  exit 78
fi

# Docker fora do ar é passageiro: sai com 1, e o systemd tenta de novo.
if ! timeout "$CHECK_TIMEOUT" docker info >/dev/null 2>&1; then
  echo "[systemd] aviso: o Docker não respondeu; nova tentativa pelo systemd." >&2
  exit 1
fi

# Só "imagem inexistente" é erro de configuração; qualquer outra falha (soluço do daemon, prazo
# vencido) é passageira.
if ! inspect_output=$(timeout "$CHECK_TIMEOUT" docker image inspect "$IMAGE" 2>&1 >/dev/null); then
  case "$inspect_output" in
    *"No such image"* | *"No such object"*)
      echo "[systemd] erro: imagem $IMAGE não encontrada. Rode 'docker compose build bot' na pasta $(pwd)." >&2
      exit 78
      ;;
    *)
      echo "[systemd] aviso: não foi possível conferir a imagem $IMAGE; nova tentativa pelo systemd." >&2
      exit 1
      ;;
  esac
fi

# Em primeiro plano, preso ao container do bot: sai com o código de saída dele.
exec docker compose --project-name studyrooms up --no-build --no-log-prefix --abort-on-container-exit --exit-code-from bot bot
