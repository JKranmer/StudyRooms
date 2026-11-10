import { DEFAULT_QUEUE_DIR } from "./config.ts";
import { discardQuarantine, forgetInQueue, requeueRejected, summarizeQuarantine } from "./quarantine.ts";

// Ferramentas da quarentena da fila em disco (docs/runbooks/neon.md). Nunca imprimem IDs.
//   node src/quarantine-cli.ts resumo                 pode rodar com o bot ligado
//   node src/quarantine-cli.ts reenfileirar           bot parado
//   node src/quarantine-cli.ts esquecer <id>          bot parado
//   node src/quarantine-cli.ts descartar --confirm    bot parado
// Pasta: BOT_QUEUE_DIR (no container, /var/lib/studyrooms-bot) ou .data/bot-queue na raiz.

const EXIT_CONFIG = 78;
const dir = process.env.BOT_QUEUE_DIR?.trim() || DEFAULT_QUEUE_DIR;
const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "resumo": {
      const s = summarizeQuarantine(dir);
      console.log(`Linhas na quarentena: ${s.total}.`);
      for (const [reason, n] of Object.entries(s.byReason)) console.log(`  motivo ${reason}: ${n}`);
      for (const [code, n] of Object.entries(s.byCode)) console.log(`  código ${code}: ${n}`);
      if (s.invalid > 0) console.log(`  linhas que nem são JSON: ${s.invalid}`);
      if (s.first) console.log(`Período (UTC): de ${s.first} a ${s.last}.`);
      break;
    }
    case "reenfileirar":
      console.log(`Eventos devolvidos à fila: ${requeueRejected(dir)}. Ligue o bot para gravá-los.`);
      break;
    case "esquecer": {
      const id = rest[0] ?? "";
      const { pending, quarantine } = forgetInQueue(dir, id);
      console.log(`Linhas apagadas: ${pending} da fila, ${quarantine} da quarentena.`);
      break;
    }
    case "descartar":
      if (!rest.includes("--confirm")) {
        console.log(`A quarentena tem ${summarizeQuarantine(dir).total} linha(s). Para apagá-la, rode de novo com --confirm.`);
        break;
      }
      console.log(`Quarentena apagada: ${discardQuarantine(dir)} linha(s).`);
      break;
    default:
      console.error("uso: quarantine-cli.ts resumo | reenfileirar | esquecer <id> | descartar --confirm");
      process.exitCode = EXIT_CONFIG;
  }
} catch (error) {
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error && !code ? error.message : `código ${String(code ?? "desconhecido")}`;
  console.error(`erro: ${message}`);
  process.exitCode = 1;
}
