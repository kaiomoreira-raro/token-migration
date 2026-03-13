import { Pool } from 'pg';
import type { Token } from './types';

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'token_migration',
  max: Number(process.env.PG_POOL_MAX) || 5,
});

const TABLE = 'tokens';

/**
 * Cria a tabela de tokens se não existir.
 */
export async function ensureTokensTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      id VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
}

/**
 * Verifica se um token já existe no Postgres pelo id.
 */
export async function tokenExists(id: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM ${TABLE} WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Insere um token no Postgres. Não valida existência (use tokenExists antes).
 */
export async function insertToken(token: Token): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (id, value, user_id, created_at) VALUES ($1, $2, $3, $4)`,
    [token.id, token.value, token.userId, token.createdAt]
  );
}

/**
 * Insere o token somente se ainda não existir. Retorna true se inseriu, false se já existia.
 */
export async function insertTokenIfNotExists(token: Token): Promise<boolean> {
  const exists = await tokenExists(token.id);
  if (exists) return false;
  await insertToken(token);
  return true;
}

/**
 * Conta quantos IDs já existem na tabela (para dry-run: simular conflitos sem escrever).
 */
export async function countExistingIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await pool.query(
    `SELECT 1 FROM ${TABLE} WHERE id = ANY($1::text[])`,
    [ids]
  );
  return result.rowCount ?? 0;
}

export interface BulkUpsertResult {
  inserted: number;
  skipped: number;
}

/**
 * Inserção em lote com ON CONFLICT DO NOTHING (idempotente).
 * Retorna quantos foram inseridos e quantos já existiam.
 */
export async function bulkUpsertTokens(tokens: Token[]): Promise<BulkUpsertResult> {
  if (tokens.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const t of tokens) {
    placeholders.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`
    );
    values.push(t.id, t.value, t.userId, t.createdAt);
    paramIndex += 4;
  }

  const sql = `
    INSERT INTO ${TABLE} (id, value, user_id, created_at)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  const result = await pool.query(sql, values);
  const inserted = result.rowCount ?? 0;
  const skipped = tokens.length - inserted;

  return { inserted, skipped };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
