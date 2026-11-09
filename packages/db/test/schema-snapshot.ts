import type pg from "pg";

// Retrato do esquema público e do registro de migrations, para provar que nada mudou.
export async function schemaSnapshot(client: pg.Client): Promise<unknown> {
  const columns = await client.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name`,
  );
  const constraints = await client.query(
    `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as def
       from pg_constraint
      where connamespace = 'public'::regnamespace
      order by 1, 2`,
  );
  const indexes = await client.query(
    `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
  );
  const migrations = await client.query(
    `select hash, created_at from drizzle.__drizzle_migrations order by id`,
  );
  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    migrations: migrations.rows,
  };
}
