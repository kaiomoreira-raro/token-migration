import Redis from 'ioredis';
import type { Token } from './types';

export interface ScanOptions {
  /** Prefixo para MATCH (ex: "token:") */
  keyPrefix: string;
  /** COUNT sugerido por iteração SCAN */
  count: number;
  /** Chaves a ignorar (ex.: set de IDs que não é payload de token) */
  excludeKeys?: string[];
}

/**
 * Itera sobre chaves no Redis usando SCAN + cursor (não bloqueante, sem KEYS).
 * Retorna os tokens (valores JSON) em lotes, com filtro por prefixo.
 */
export async function* scanTokensBatches(
  redis: Redis,
  options: ScanOptions
): AsyncGenerator<Token[], void, undefined> {
  const { keyPrefix, count, excludeKeys = [] } = options;
  const match = keyPrefix.endsWith('*') ? keyPrefix : `${keyPrefix}*`;
  const excludeSet = new Set(excludeKeys);
  let cursor = '0';

  do {
    const [nextCursor, rawKeys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', count);

    cursor = nextCursor;

    const keys = rawKeys.filter((k) => !excludeSet.has(k));
    if (keys.length === 0) continue;

    const values = await redis.mget(...keys);
    const tokens: Token[] = [];

    for (let i = 0; i < values.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      try {
        const token = JSON.parse(raw) as Token;
        if (token.id != null && token.value != null) {
          tokens.push(token);
        }
      } catch {
        // valor inválido, ignorado
      }
    }

    if (tokens.length > 0) {
      yield tokens;
    }
  } while (cursor !== '0');
}
