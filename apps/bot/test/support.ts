import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runMigrations } from "@studyrooms/db";

// Mesma imagem do serviço `db` do compose e dos testes de packages/db.
const POSTGRES_IMAGE = "postgres:17-alpine";

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withLabels({ "studyrooms.role": "bot-integration-test" })
    .start();
  await runMigrations(container.getConnectionUri());
  return container;
}

/**
 * Proxy TCP local para o Postgres do teste. `down()` derruba as conexões e recusa novas, como um
 * banco fora do ar; `up()` volta na mesma porta, então a URL do bot não muda.
 */
export class TcpProxy {
  port = 0;
  readonly #target: { host: string; port: number };
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;

  constructor(target: { host: string; port: number }) {
    this.#target = target;
  }

  async up(): Promise<void> {
    if (this.#server) return;
    const server = createServer((client) => {
      const upstream = connect(this.#target.port, this.#target.host);
      for (const socket of [client, upstream]) {
        this.#sockets.add(socket);
        socket.on("close", () => this.#sockets.delete(socket));
        socket.on("error", () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream).pipe(client);
    });
    server.listen(this.port, "127.0.0.1");
    await once(server, "listening");
    this.port = (server.address() as AddressInfo).port;
    this.#server = server;
  }

  async down(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = null;
    for (const socket of this.#sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }

  url(container: StartedPostgreSqlContainer): string {
    const user = encodeURIComponent(container.getUsername());
    const password = encodeURIComponent(container.getPassword());
    return `postgres://${user}:${password}@127.0.0.1:${this.port}/${container.getDatabase()}`;
  }
}

export function proxyFor(container: StartedPostgreSqlContainer): TcpProxy {
  return new TcpProxy({ host: container.getHost(), port: container.getPort() });
}

export type Row = {
  id: number;
  idempotency_key: string;
  event_type: string;
  discord_user_id: string | null;
  guild_id: string | null;
  from_channel_id: string | null;
  to_channel_id: string | null;
  occurred_utc: string;
};

export async function readRows(client: pg.Client): Promise<Row[]> {
  const { rows } = await client.query<Row>(
    `select id::int as id, idempotency_key, event_type, discord_user_id, guild_id, from_channel_id,
            to_channel_id, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_utc
       from raw_voice_events order by id`,
  );
  return rows;
}

export function tempDir(prefix: string): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function eventually(condition: () => Promise<boolean> | boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condição não atingida a tempo");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
