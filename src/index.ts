/* External dependencies */
import { readFile } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import express, { Request } from 'express';

/* Internal dependencies */
import { redis } from './redis';
import { loggingMiddleware, getRedisStubKey } from './utility/common';
import rainRoute from './routes/rain';
import quickoRoute from './routes/quicko';
import exchangeRoute from './routes/exchanger';

dotenv.config();

const app = express();
app.use(express.json());
app.use(loggingMiddleware);
app.use(exchangeRoute, rainRoute, quickoRoute);

const methods = ['get', 'post', 'put', 'delete', 'patch'];

async function seedStubs(configFilePath?: string): Promise<void> {
    const filePath = configFilePath || path.resolve(__dirname, '../config/stubs.json');
    let stubs: any[] = [];

    try {
        const raw = await readFile(filePath, 'utf-8');
        stubs = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to read stubs.json:', err);
        return;
    }

    for (const stub of stubs) {
        const method = stub.body.method && methods.includes(stub.body.method.toLowerCase())
            ? stub.body.method.toLowerCase()
            : 'post';

        const fakeReq = { path: stub.path, params: stub.params || {} } as Request;
        const key = getRedisStubKey(fakeReq, method);

        try {
            await redis.set(key, JSON.stringify({
                status: stub.body.status,
                response: stub.body.response,
            }));
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
