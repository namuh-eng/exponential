import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

function createRedisClient(): Redis {
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
  }

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  return client;
}

/** Primary Redis client for caching and pub/sub commands */
export const redis = createRedisClient();

/** Dedicated subscriber client (Redis requires separate connections for pub/sub) */
export const redisSub = createRedisClient();

const subscriptionHandlers = new Map<
  string,
  Set<(message: Record<string, unknown>) => void>
>();
let subscriberListenerRegistered = false;

function ensureSubscriberListener(): void {
  if (subscriberListenerRegistered) {
    return;
  }

  redisSub.on("message", (channel, rawMessage) => {
    const handlers = subscriptionHandlers.get(channel);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const message = JSON.parse(rawMessage) as Record<string, unknown>;
    for (const handler of handlers) {
      handler(message);
    }
  });

  subscriberListenerRegistered = true;
}

// ─── Cache helpers ───────────────────────────────────────────────────

const DEFAULT_TTL = 300; // 5 minutes

export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  if (value === null) return null;
  return JSON.parse(value) as T;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds = DEFAULT_TTL,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await redis.del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    cursor = nextCursor;
  } while (cursor !== "0");
}

// ─── Pub/Sub helpers ─────────────────────────────────────────────────

export async function publish(
  channel: string,
  message: Record<string, unknown>,
): Promise<void> {
  await redis.publish(channel, JSON.stringify(message));
}

export async function subscribe(
  channel: string,
  handler: (message: Record<string, unknown>) => void,
): Promise<void> {
  ensureSubscriberListener();

  const handlers = subscriptionHandlers.get(channel);
  if (handlers) {
    handlers.add(handler);
    return;
  }

  subscriptionHandlers.set(channel, new Set([handler]));
  await redisSub.subscribe(channel);
}

export async function unsubscribe(channel: string): Promise<void> {
  subscriptionHandlers.delete(channel);
  await redisSub.unsubscribe(channel);
}
