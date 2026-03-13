/**
 * Formato dos tokens no Redis:
 * - SET "token:ids" → conjunto de IDs (para listar todos)
 * - GET "token:{id}" → JSON: { id, value, userId, createdAt }
 */

export const TOKEN_IDS_KEY = 'token:ids';
export const TOKEN_KEY_PREFIX = 'token:';

export function tokenKey(id: string): string {
  return `${TOKEN_KEY_PREFIX}${id}`;
}
