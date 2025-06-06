/* External dependencies */
import fs from 'fs';
import path from 'path';
import { Request } from 'express';

/* Internal dependencies */
import { redis } from '../redis';
import { getRedisStubKey } from './redis';
import { addPatternStub } from './pattern-stubs';

const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;

/**
 * Loads stubs from a JSON config and writes them to Redis
 */
export async function seedStubs(): Promise<void> {
    const filePath = path.resolve(__dirname, '..', '..', 'src', 'config', 'stubs.json');
    let stubs: Array<any> = [];
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        stubs = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to read stubs.json:', err);
        return;
    }

    for (const stub of stubs) {
        const method = stub.body.method && methods.includes(stub.body.method.toLowerCase()) ? stub.body.method.toLowerCase() : 'post';
        const fullPath = stub.path;

        if (fullPath.includes('/:')) {
            await addPatternStub(fullPath, { status: stub.body.status, response: stub.body.response }, method);
            continue;
        }

        const fakeReq = { path: fullPath, params: stub.params || {} } as any;
        const key = getRedisStubKey(fakeReq, method);
        try {
            await redis.set(key, JSON.stringify({ status: stub.body.status, response: stub.body.response }));
            console.log('Seeded stub', fullPath);
        } catch (err) {
            console.error(`Failed to seed stub ${fullPath}:`, err);
        }
    }
}
