import Redis from 'ioredis';
import { bulkUpsertTokens, closePool, countExistingIds, ensureTokensTable } from './db';
import { loadMigrationConfig } from './migration-config';
import { logStructured, sleep, withRetry } from './migration-logger';
import { TOKEN_IDS_KEY } from './redis-keys';
import { scanTokensBatches } from './redis-scanner';

export interface MigrationMetrics {
  totalRead: number;
  totalMigrated: number;
  totalSkipped: number;
  totalFailed: number;
  totalBatches: number;
  failedBatches: number;
  failedTokenIds: string[];
}

/**
 * Script de migração Redis → Postgres.
 *
 * - Usa SCAN + cursor (sem KEYS), com filtro por prefixo.
 * - Processa em lotes de tamanho configurável.
 * - Throughput controlado por delay entre lotes.
 * - Bulk upsert idempotente (ON CONFLICT DO NOTHING).
 * - Retry por lote com backoff exponencial.
 * - Logs estruturados e métricas de progresso.
 */
export async function runMigration(): Promise<MigrationMetrics> {
  const config = loadMigrationConfig();

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  });

  const metrics: MigrationMetrics = {
    totalRead: 0,
    totalMigrated: 0,
    totalSkipped: 0,
    totalFailed: 0,
    totalBatches: 0,
    failedBatches: 0,
    failedTokenIds: [],
  };

  logStructured({
    level: 'info',
    event: 'migration_start',
    message: 'Iniciando migração Redis → Postgres',
    dryRun: config.dryRun,
    keyPrefix: config.keyPrefix,
    batchSize: config.batchSize,
    batchDelayMs: config.batchDelayMs,
  });

  await ensureTokensTable();

  if (config.dryRun) {
    logStructured({
      level: 'info',
      event: 'dry_run',
      message: 'Modo dry-run: nenhuma escrita no Postgres; leitura Redis + checagem de conflitos no PG',
    });
  }

  let batchIndex = 0;

  try {
    for await (const tokens of scanTokensBatches(redis, {
      keyPrefix: config.keyPrefix,
      count: config.batchSize,
      excludeKeys: [TOKEN_IDS_KEY],
    })) {
      batchIndex++;
      metrics.totalBatches++;
      metrics.totalRead += tokens.length;

      if (config.dryRun) {
        const existingCount = await countExistingIds(tokens.map((t) => t.id));
        const wouldInsert = tokens.length - existingCount;
        const wouldSkip = existingCount;
        metrics.totalMigrated += wouldInsert;
        metrics.totalSkipped += wouldSkip;
        logStructured({
          level: 'info',
          event: 'batch_dry_run',
          batch: batchIndex,
          read: tokens.length,
          inserted: wouldInsert,
          skipped: wouldSkip,
          totalRead: metrics.totalRead,
          totalMigrated: metrics.totalMigrated,
          totalSkipped: metrics.totalSkipped,
          message: `[DRY-RUN] Lote ${batchIndex}: ${wouldInsert} seriam inseridos, ${wouldSkip} já existem (conflito)`,
        });
        await sleep(config.batchDelayMs);
        continue;
      }

      try {
        const result = await withRetry(
          () => bulkUpsertTokens(tokens),
          config.maxRetries,
          config.retryDelayMs
        );

        metrics.totalMigrated += result.inserted;
        metrics.totalSkipped += result.skipped;

        logStructured({
          level: 'info',
          event: 'batch_complete',
          batch: batchIndex,
          read: tokens.length,
          inserted: result.inserted,
          skipped: result.skipped,
          totalRead: metrics.totalRead,
          totalMigrated: metrics.totalMigrated,
          totalSkipped: metrics.totalSkipped,
          message: `Lote ${batchIndex}: ${result.inserted} inseridos, ${result.skipped} já existentes`,
        });
      } catch (err) {
        metrics.failedBatches++;
        metrics.totalFailed += tokens.length;
        const ids = tokens.map((t) => t.id);
        metrics.failedTokenIds.push(...ids);

        logStructured({
          level: 'error',
          event: 'batch_failed',
          batch: batchIndex,
          read: tokens.length,
          totalFailed: metrics.totalFailed,
          error: err instanceof Error ? err.message : String(err),
          failedTokenIds: ids,
          message: `Falha no lote ${batchIndex} após ${config.maxRetries} tentativas`,
        });
      }

      await sleep(config.batchDelayMs);
    }
  } finally {
    await redis.quit();
    await closePool();
  }

  logStructured({
    level: 'info',
    event: 'migration_end',
    message: 'Migração concluída',
    totalRead: metrics.totalRead,
    totalMigrated: metrics.totalMigrated,
    totalSkipped: metrics.totalSkipped,
    totalFailed: metrics.totalFailed,
    totalBatches: metrics.totalBatches,
    failedBatches: metrics.failedBatches,
  });

  return metrics;
}

async function main(): Promise<void> {
  try {
    const metrics = await runMigration();

    console.error('\n--- Resumo ---');
    console.error(`Lidos (Redis):     ${metrics.totalRead}`);
    console.error(`Inseridos (PG):    ${metrics.totalMigrated}`);
    console.error(`Já existentes:     ${metrics.totalSkipped}`);
    console.error(`Falhas (lotes):    ${metrics.totalFailed}`);
    console.error(`Lotes processados: ${metrics.totalBatches}`);
    if (metrics.failedTokenIds.length > 0) {
      console.error(`IDs com falha:     ${metrics.failedTokenIds.slice(0, 20).join(', ')}${metrics.failedTokenIds.length > 20 ? '...' : ''}`);
    }
  } catch (err) {
    logStructured({
      level: 'error',
      event: 'migration_error',
      message: 'Erro fatal na migração',
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(err);
    process.exit(1);
  }
}

main();
