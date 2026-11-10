import { existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findErrorCode } from "./errors.ts";
import { runMigrations } from "./migrate.ts";
import { checkNeonUrl } from "./neon-url.ts";
import { RoleSetupError } from "./role-errors.ts";
import {
  BACKUP_ROLE,
  BOT_ROLE,
  checkAccess,
  countUserEvents,
  forgetUser,
  pingDatabase,
  roleUrl,
  setupRoles,
  type RoleSetupResult,
} from "./roles.ts";

// Comandos do Neon (F1-48), rodados na máquina local: `pnpm --filter @studyrooms/db neon <comando>`.
// Leem as URLs do `.env` da raiz e nunca as imprimem. Passo a passo em docs/runbooks/neon.md.
//
//   ping               testa a conexão do dono (NEON_ADMIN_URL), sem imprimir a URL
//   migrate            aplica as migrations (NEON_ADMIN_URL)
//   roles [--rotate]   cria os papéis do bot e do backup (NEON_ADMIN_URL); grava as conexões
//                      novas em .env.neon.local, sem imprimi-las
//   check              confere SSL e permissões dos papéis (NEON_BOT_URL, NEON_BACKUP_URL)
//   count <id>         conta os eventos de uma pessoa (NEON_ADMIN_URL)
//   forget <id> --confirm   apaga os eventos de uma pessoa, a pedido (NEON_ADMIN_URL)

const EXIT_CONFIG = 78;
const CREDENTIALS_FILE = fileURLToPath(new URL("../../../.env.neon.local", import.meta.url));

function requireUrl(name: string): string {
  const value = process.env[name];
  const { errors, warnings } = checkNeonUrl(name, value);
  for (const warning of warnings) console.warn(`aviso: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`erro: ${error}`);
    process.exit(EXIT_CONFIG);
  }
  return value!.trim();
}

function requireId(id: string | undefined): string {
  if (!id || !/^[0-9]{17,20}$/.test(id)) {
    console.error("erro: informe o ID do Discord da pessoa (só os dígitos, de 17 a 20).");
    process.exit(EXIT_CONFIG);
  }
  return id;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case "ping": {
      const info = await pingDatabase(requireUrl("NEON_ADMIN_URL"));
      console.log(
        `Conectado: usuário ${info.user}, banco ${info.database}, Postgres ${info.serverMajor}, SSL ${info.ssl ? "sim" : "NÃO"}.`,
      );
      if (!info.ssl) process.exitCode = 1;
      return;
    }
    case "migrate": {
      const url = requireUrl("NEON_ADMIN_URL");
      await runMigrations(url);
      console.log("Migrations em dia no Neon.");
      return;
    }
    case "roles": {
      const url = requireUrl("NEON_ADMIN_URL");
      const rotate = rest.includes("--rotate");
      if (existsSync(CREDENTIALS_FILE)) {
        console.error(
          "erro: .env.neon.local já existe. Copie as conexões dele para o .env (veja o runbook), apague o arquivo e rode de novo.",
        );
        process.exit(EXIT_CONFIG);
      }
      let wrote = false;
      let result: RoleSetupResult;
      try {
        result = await setupRoles(url, {
          rotate,
          // O Neon recusa verificador SCRAM pronto (XX000): a senha vai em texto (veja roles.ts).
          passwordFormat: "plaintext",
          // Grava o arquivo antes do commit: se não der para gravar, nenhuma senha nova é confirmada.
          beforeCommit: (pending) => {
            const lines: string[] = [];
            if (pending.passwords.bot) lines.push(`NEON_BOT_URL=${roleUrl(url, BOT_ROLE, pending.passwords.bot)}`);
            if (pending.passwords.backup) {
              lines.push(`NEON_BACKUP_URL=${roleUrl(url, BACKUP_ROLE, pending.passwords.backup)}`);
            }
            if (lines.length === 0) return;
            writeFileSync(
              CREDENTIALS_FILE,
              `# Gerado por \`neon roles\`. Segredo: copie para o .env (veja docs/runbooks/neon.md) e apague este arquivo.\n${lines.join("\n")}\n`,
              { mode: 0o600, flag: "wx" },
            );
            wrote = true;
          },
        });
      } catch (error) {
        // Sem commit, as senhas do arquivo não valem: apaga, para a próxima tentativa poder rodar.
        if (wrote) rmSync(CREDENTIALS_FILE, { force: true });
        if (!(error instanceof RoleSetupError)) throw error;
        console.error(`erro: ${error.message}.`);
        console.error(
          error.stage.startsWith("confirmar")
            ? "O commit falhou: as senhas novas podem não valer. Rode de novo com --rotate; veja Problemas comuns no runbook."
            : "Nada foi aplicado (a transação foi desfeita). Pode rodar de novo; veja Problemas comuns no runbook.",
        );
        process.exit(1);
      }
      const label = { created: "criado", rotated: "senha trocada", kept: "já existia; senha mantida" };
      console.log(`Papel do bot (${BOT_ROLE}): ${label[result.bot]}.`);
      console.log(`Papel do backup (${BACKUP_ROLE}): ${label[result.backup]}.`);
      console.log("Permissões aplicadas.");
      if (wrote) console.log("Conexões novas gravadas em .env.neon.local, na raiz (não impressas). Siga o runbook.");
      else console.log("Nenhuma senha nova. Para trocar as senhas, rode com --rotate.");
      for (const [key, name] of [["bot", "NEON_BOT_URL"], ["backup", "NEON_BACKUP_URL"]] as const) {
        if (result[key] === "kept" && !process.env[name]?.trim()) {
          console.warn(`aviso: o papel do ${key} já existia, mas ${name} não está no .env. Sem ela, rode com --rotate.`);
        }
      }
      return;
    }
    case "check": {
      const bot = requireUrl("NEON_BOT_URL");
      const backup = requireUrl("NEON_BACKUP_URL");
      const checks = await checkAccess({ bot, backup }, { requireSsl: true });
      for (const check of checks) {
        console.log(`${check.ok ? "ok     " : "FALHOU "} ${check.name}${check.code ? ` (código ${check.code})` : ""}`);
      }
      const failed = checks.filter((check) => !check.ok).length;
      console.log(failed === 0 ? "Tudo certo." : `${failed} verificação(ões) falharam. Veja o runbook.`);
      if (failed > 0) process.exitCode = 1;
      return;
    }
    case "count": {
      const id = requireId(rest[0]);
      const url = requireUrl("NEON_ADMIN_URL");
      console.log(`Eventos dessa pessoa no Neon: ${await countUserEvents(url, id)}.`);
      return;
    }
    case "forget": {
      const id = requireId(rest[0]);
      const url = requireUrl("NEON_ADMIN_URL");
      if (!rest.includes("--confirm")) {
        console.log(`Eventos dessa pessoa no Neon: ${await countUserEvents(url, id)}. Nada foi apagado.`);
        console.log("Para apagar, rode de novo com --confirm (é definitivo).");
        return;
      }
      const { deleted } = await forgetUser(url, id);
      console.log(`Eventos apagados: ${deleted}.`);
      return;
    }
    default:
      console.error("uso: neon ping | migrate | roles [--rotate] | check | count <id> | forget <id> --confirm");
      process.exit(EXIT_CONFIG);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  // Só o código (SQLSTATE como 28P01, ou de rede como ENOTFOUND): a mensagem pode trazer valores
  // e detalhes da conexão.
  console.error(`erro: falha no comando (código ${findErrorCode(error) ?? "desconhecido"}).`);
  process.exit(1);
}
