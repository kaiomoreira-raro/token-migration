/**
 * Configuração do script de migração Redis → Postgres.
 * Variáveis de ambiente têm precedência.
 */

export interface MigrationConfig {
  /** Prefixo das chaves no Redis para SCAN (ex: "token:") */
  keyPrefix: string;
  /** Tamanho do cursor SCAN (sugestão ao Redis, não garantido) */
  scanChunkSize: number;
  /** Quantidade de tokens por lote para leitura e escrita */
  batchSize: number;
  /** Intervalo em ms entre lotes (controle de throughput) */
  batchDelayMs: number;
  /** Número máximo de tentativas por lote em caso de falha */
  maxRetries: number;
  /** Delay base em ms para retry (backoff exponencial) */
  retryDelayMs: number;
  /** Se true, não escreve no Postgres (validação) */
  dryRun: boolean;
  /** Pool max connections no Postgres (evitar estourar limite) */
  pgPoolMax: number;
}

const env = process.env;

function int(key: string, defaultValue: number): number {
  const v = env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function bool(key: string, defaultValue: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return defaultValue;
  return v === '1' || v.toLowerCase() === 'true' || v === 'yes';
}

export function loadMigrationConfig(): MigrationConfig {
  return {
    keyPrefix: env.REDIS_KEY_PREFIX ?? 'token:',
    scanChunkSize: int('MIGRATION_SCAN_CHUNK_SIZE', 100),
    batchSize: int('MIGRATION_BATCH_SIZE', 100),
    batchDelayMs: int('MIGRATION_BATCH_DELAY_MS', 50),
    maxRetries: int('MIGRATION_MAX_RETRIES', 3),
    retryDelayMs: int('MIGRATION_RETRY_DELAY_MS', 1000),
    dryRun: bool('MIGRATION_DRY_RUN', false),
    pgPoolMax: int('PG_POOL_MAX', 5),
  };
}
