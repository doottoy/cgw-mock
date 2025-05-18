/* External dependencies */
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';

/* Internal dependencies */
import { redis } from './redis';
import rainRoute from './routes/rain';
import quickoRoute from './routes/quicko';
import exchangeRoute from './routes/exchanger';
import { makeStubKey } from './utility/redisKeys';
import { loggingMiddleware } from './utility/common';

dotenv.config();

const app = express();
app.use(express.json());
app.use(loggingMiddleware);
app.use(exchangeRoute, rainRoute, quickoRoute);

async function seedStubs() {
    const configPath = path.resolve(__dirname, '../src/config/stubs.json');
    let stubs: Array<{
        path: string;
        body: { status: number; response: any; method?: string };
        params?: Record<'0', string>;
    }> = [];
    try {
        const raw = await fs.readFile(configPath, 'utf-8');
        stubs = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to read stubs.json:', err);
        return;
    }

    for (const stub of stubs) {
        const [, route, ...parts] = stub.path.split('/');
        const endpoint = stub.params?.['0'] ?? parts.join('/');
        const method = stub.body.method?.toLowerCase() || 'post';
        const key = makeStubKey(route, endpoint, method);
        try {
            await redis.set(key, JSON.stringify({ status: stub.body.status, response: stub.body.response }));
            console.log('Seeded stub', stub.path);
        } catch (err) {
            console.error(`Failed to seed stub ${stub.path}:`, err);
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    try {
        await redis.ping();
        console.log('Redis connected');
        await seedStubs();
    } catch (err) {
        console.error('Redis connection error:', err);
        process.exit(1);
    }
});
