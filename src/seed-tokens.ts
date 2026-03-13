import Redis from 'ioredis';
import { TOKEN_IDS_KEY, tokenKey } from './redis-keys';
import type { Token } from './types';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const tokens: Token[] = [
  { id: 'tok_1', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.x', userId: 'user_1', createdAt: new Date().toISOString() },
  { id: 'tok_2', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyIn0.y', userId: 'user_2', createdAt: new Date().toISOString() },
  { id: 'tok_3', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzIn0.z', userId: 'user_3', createdAt: new Date().toISOString() },
  { id: 'tok_4', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0In0.a', userId: 'user_4', createdAt: new Date().toISOString() },
  { id: 'tok_5', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1In0.b', userId: 'user_5', createdAt: new Date().toISOString() },
];

async function seed(): Promise<void> {
  try {
    for (const token of tokens) {
      await redis.set(tokenKey(token.id), JSON.stringify(token));
      await redis.sadd(TOKEN_IDS_KEY, token.id);
    }
    console.log(`Populados ${tokens.length} tokens no Redis.`);
  } finally {
    await redis.quit();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
