// F1-48 (QA): `neon roles` no CLI, sem banco e sem tocar no .env.neon.local de verdade: o fs e o
// setupRoles são simulados. Confere quando o arquivo é gravado, apagado ou preservado, e que
// nenhuma senha chega ao terminal.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn((_path: unknown) => false),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}));
const rolesMock = vi.hoisted(() => ({ setupRoles: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, ...fsMock, default: { ...real, ...fsMock } };
});
vi.mock("../src/roles.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/roles.ts")>();
  return { ...real, setupRoles: rolesMock.setupRoles };
});

// Recarregado a cada execução do CLI (vi.resetModules), para o instanceof do CLI reconhecer o erro.
let RoleSetupError: typeof import("../src/role-errors.ts").RoleSetupError;

const ADMIN_PASSWORD = "npg_AbCdEfGh1234";
const ADMIN_URL = `postgres://neondb_owner:${ADMIN_PASSWORD}@ep-x-123.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const BOT_PW = "B".repeat(20) + "o1_-".repeat(6);
const BACKUP_PW = "K".repeat(20) + "k2-_".repeat(6);

class Exit extends Error {
  readonly code: number | undefined;
  constructor(code: number | undefined) {
    super(`exit ${code}`);
    this.code = code;
  }
}

let out: string[];
let exits: Array<number | undefined>;

async function runCli(...args: string[]): Promise<void> {
  vi.resetModules();
  ({ RoleSetupError } = await import("../src/role-errors.ts"));
  process.argv = ["node", "neon-cli.ts", ...args];
  await import("../src/neon-cli.ts").catch((error: unknown) => {
    if (!(error instanceof Exit)) throw error;
  });
}

type Opts = { rotate?: boolean; passwordFormat?: string; beforeCommit?: (r: unknown) => unknown };
const pending = { bot: "created", backup: "created", passwords: { bot: BOT_PW, backup: BACKUP_PW } };

/** Imita o setupRoles: chama o beforeCommit (como o real, embrulhando a falha) e depois `after`. */
function fakeSetup(after: () => void) {
  rolesMock.setupRoles.mockImplementation(async (_url: string, opts: Opts) => {
    try {
      await opts.beforeCommit?.(pending);
    } catch (error) {
      throw new RoleSetupError("gravar as conexões novas", error, [BOT_PW, BACKUP_PW]);
    }
    after();
    return pending;
  });
}

beforeEach(() => {
  out = [];
  exits = [];
  process.env.NEON_ADMIN_URL = ADMIN_URL;
  fsMock.existsSync.mockReset().mockReturnValue(false);
  fsMock.writeFileSync.mockReset();
  fsMock.rmSync.mockReset();
  rolesMock.setupRoles.mockReset();
  const capture = (...a: unknown[]) => void out.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
    throw new Exit(code);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEON_ADMIN_URL;
  process.exitCode = undefined;
});

function expectNoSecretInOutput() {
  const text = out.join("\n");
  for (const secret of [BOT_PW, BACKUP_PW, ADMIN_PASSWORD, "ep-x-123", "neon.tech"]) expect(text).not.toContain(secret);
}

describe("neon roles (CLI)", () => {
  test("sucesso: grava o arquivo com 0600 e wx, antes do commit, e não imprime senha", async () => {
    fakeSetup(() => {
      expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    });
    await runCli("roles");
    expect(exits).toEqual([]);
    const [path, content, options] = fsMock.writeFileSync.mock.calls[0]!;
    expect(String(path)).toMatch(/\.env\.neon\.local$/);
    expect(options).toEqual({ mode: 0o600, flag: "wx" });
    expect(String(content)).toContain(`NEON_BOT_URL=postgres://studyrooms_bot:${BOT_PW}@`);
    expect(String(content)).toContain(`NEON_BACKUP_URL=postgres://studyrooms_backup:${BACKUP_PW}@`);
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    const call = rolesMock.setupRoles.mock.calls[0]![1] as Opts;
    expect(call.passwordFormat).toBe("plaintext");
    expect(call.rotate).toBe(false);
    expectNoSecretInOutput();
  });

  test("--rotate chega ao setupRoles", async () => {
    fakeSetup(() => {});
    await runCli("roles", "--rotate");
    expect((rolesMock.setupRoles.mock.calls[0]![1] as Opts).rotate).toBe(true);
  });

  test("falha numa etapa depois de gravar: apaga o arquivo, sai com 1 e não imprime senha", async () => {
    fakeSetup(() => {
      throw new RoleSetupError("aplicar as permissões do bot", Object.assign(new Error(`x ${BOT_PW}`), { code: "XX000" }), [BOT_PW]);
    });
    await runCli("roles");
    expect(exits[0]).toBe(1);
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("erro: falhou ao aplicar as permissões do bot (código XX000)");
    expect(out.join("\n")).toContain("Nada foi aplicado");
    expectNoSecretInOutput();
  });

  test("falha no commit: orienta --rotate (o arquivo da tentativa é apagado)", async () => {
    fakeSetup(() => {
      throw new RoleSetupError("confirmar a transação (commit)", Object.assign(new Error("Connection terminated"), { code: "ECONNRESET" }));
    });
    await runCli("roles");
    expect(exits[0]).toBe(1);
    expect(out.join("\n")).toContain("--rotate");
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expectNoSecretInOutput();
  });

  test("arquivo criado por outro processo entre a checagem e a gravação: não apaga o arquivo alheio", async () => {
    fsMock.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error("EEXIST: file already exists, open 'A:\\x\\.env.neon.local'"), { code: "EEXIST" });
    });
    fakeSetup(() => {});
    await runCli("roles");
    expect(exits[0]).toBe(1);
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("falhou ao gravar as conexões novas (código EEXIST)");
    expectNoSecretInOutput();
  });

  test(".env.neon.local já existe: recusa antes de tocar no banco", async () => {
    fsMock.existsSync.mockReturnValue(true);
    await runCli("roles");
    expect(exits[0]).toBe(78);
    expect(rolesMock.setupRoles).not.toHaveBeenCalled();
  });

  test("nenhuma senha nova: não grava arquivo", async () => {
    rolesMock.setupRoles.mockImplementation(async (_u: string, opts: Opts) => {
      const kept = { bot: "kept", backup: "kept", passwords: {} };
      await opts.beforeCommit?.(kept);
      return kept;
    });
    await runCli("roles");
    expect(exits).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Nenhuma senha nova");
  });

  test("erro inesperado (não RoleSetupError) depois de gravar: apaga o arquivo e mostra só o código", async () => {
    rolesMock.setupRoles.mockImplementation(async (_u: string, opts: Opts) => {
      await opts.beforeCommit?.(pending);
      throw Object.assign(new Error(`boom ${BOT_PW} ${ADMIN_URL}`), { code: "EPIPE" });
    });
    await runCli("roles");
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("falha no comando (código EPIPE)");
    expectNoSecretInOutput();
  });
});
