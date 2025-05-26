/* External dependencies */
import { match } from 'path-to-regexp';

/* Internal dependencies */
import { redis } from '../redis';

/* Interface */
import { StubData, PatternStub } from '../interfaces/patter-stubs-types';

export const patternStubs: PatternStub[] = [];
const REDIS_HASH_KEY = 'patternStubs';

export async function loadPatternStubs(): Promise<void> {
    const entries = await redis.hgetall(REDIS_HASH_KEY);
    for (const field in entries) {
        const [method, ...parts] = field.split(':');
        const pattern = parts.join(':');
        const stubData: StubData = JSON.parse(entries[field]);
        const matcher = match<Record<string, string>>(pattern, { decode: decodeURIComponent });
        patternStubs.push({ pattern, method, matcher, data: stubData });
        console.log(`Loaded pattern stub ${method.toUpperCase()} ${pattern}`);
    }
}

export async function addPatternStub(
    pattern: string,
    stubData: StubData,
    method: string
): Promise<void> {
    const field = `${method}:${pattern}`;
    await redis.hset(REDIS_HASH_KEY, field, JSON.stringify(stubData));
    const matcher = match<Record<string, string>>(pattern, { decode: decodeURIComponent });
    const idx = patternStubs.findIndex(p => p.method === method && p.pattern === pattern);
    if (idx >= 0) {
        patternStubs[idx].matcher = matcher;
        patternStubs[idx].data = stubData;
    } else {
        patternStubs.push({ pattern, method, matcher, data: stubData });
    }
    console.log(`Registered pattern stub ${method.toUpperCase()} ${pattern}`);
}

export async function removePatternStub(
    pattern: string,
    method: string
): Promise<void> {
    const field = `${method}:${pattern}`;
    await redis.hdel(REDIS_HASH_KEY, field);
    const idx = patternStubs.findIndex(p => p.method === method && p.pattern === pattern);
    if (idx >= 0) patternStubs.splice(idx, 1);
    console.log(`Removed pattern stub ${method.toUpperCase()} ${pattern}`);
}
