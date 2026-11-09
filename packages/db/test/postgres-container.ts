import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

// Mesma imagem do serviço `db` do compose.
export const POSTGRES_IMAGE = "postgres:17-alpine";

// Containers de teste levam um rótulo próprio, para nunca serem confundidos com os do compose.
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE)
    .withLabels({ "studyrooms.role": "db-integration-test" })
    .start();
}
