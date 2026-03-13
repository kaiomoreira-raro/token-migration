/**
 * Logs estruturados para o script de migração.
 * Formato: JSON por linha, para parsing e agregação.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  message?: string;
  batch?: number;
  cursor?: string;
  read?: number;
  inserted?: number;
  skipped?: number;
  failed?: number;
  totalRead?: number;
  totalMigrated?: number;
  totalSkipped?: number;
  totalFailed?: number;
  error?: string;
  [key: string]: unknown;
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify({ ...entry, ts: entry.ts || new Date().toISOString() });
}

export function logStructured(entry: Omit<LogEntry, 'ts'>): void {
  const full = { ...entry, ts: new Date().toISOString() } as LogEntry;
  const line = formatEntry(full);
  if (entry.level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry com backoff exponencial.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
