import { createClient } from 'redis';

// Create a redis client
const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.error('Redis Client Error', err));

let isConnected = false;

export const getRedisClient = async () => {
    if (!isConnected) {
        await client.connect();
        isConnected = true;
    }
    return client;
};

export const cacheData = async (key: string, ttlSeconds: number, fetcher: () => Promise<any>) => {
    let data;
    try {
        const redis = await getRedisClient();
        const cached = await redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (e) {
        console.error('Redis cache get error for key', key, e);
    }

    // Always call fetcher outside of the try-catch for Redis so if it fails, it throws properly, avoiding thundering herd
    data = await fetcher();

    try {
        if (data) {
            const redis = await getRedisClient();
            await redis.setEx(key, ttlSeconds, JSON.stringify(data));
        }
    } catch (e) {
        console.error('Redis cache set error for key', key, e);
    }

    return data;
};

export const clearCachePrefix = async (prefix: string) => {
    try {
        const redis = await getRedisClient();
        let cursor = 0;
        do {
            const reply = await redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
            cursor = reply.cursor;
            if (reply.keys.length > 0) {
                await redis.del(reply.keys);
            }
        } while (cursor !== 0);
    } catch (e) {
        console.error('Redis clear cache error for prefix', prefix, e);
    }
}
