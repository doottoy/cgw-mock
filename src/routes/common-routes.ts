/* External dependencies */
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

/* Internal dependencies */
import { redis } from '../redis';
import { makeStubKey, makeHistoryKey } from '../utility/redisKeys';
import { generateHeaders, replaceRandomUUID } from '../utility/common';

const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;

async function saveNewEndpointToRedis(req: Request, res: Response) {
    const { status, response: resp, method } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const httpMethod = methods.includes(method) ? method : 'post';
    const key = makeStubKey(route, endpoint, httpMethod);
    const existed = await redis.exists(key);

    await redis.set(key, JSON.stringify({ status, response: resp }));
    return res.status(existed ? 200 : 201).json({ result: existed ? 'updated' : 'created', endpoint });
}

async function deleteEndpointFromRedis(req: Request, res: Response) {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const method = req.params.method;
    const key = makeStubKey(route, endpoint, method);
    const existed = await redis.exists(key);
    if (!existed) return res.sendStatus(404);

    await redis.del(key);
    return res.sendStatus(204);
}

async function getHistory(req: Request, res: Response) {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const method = req.params.method;
    const histKey = makeHistoryKey(route, endpoint, method);
    const items = await redis.lrange(histKey, 0, 4);
    return res.status(200).json(items.map(i => JSON.parse(i)));
}

async function getStubList(req: Request, res: Response) {
    const route = req.path.split('/')[1];
    const keys = await redis.keys(`stub:${route}:*`);
    const stubs = [] as Array<{ endpoint: string; status: number; response: any }>;
    for (const key of keys) {
        const endpoint = key.split(`stub:${route}:`)[1].split(':')[0];
        const raw = await redis.get(key);
        if (raw) {
            const { status, response } = JSON.parse(raw);
            stubs.push({ endpoint, status, response });
        }
    }
    return res.status(200).json(stubs);
}

async function defaultRequest(req: Request, res: Response) {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const method = req.method.toLowerCase() as string;

    const record = { timestamp: new Date().toISOString(), method, body: req.body };
    const histKey = makeHistoryKey(route, endpoint, method);
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    const stubKey = makeStubKey(route, endpoint, method);
    const stubRaw = await redis.get(stubKey);
    let statusCode = 200;
    let respBody: any = {};
    if (stubRaw) {
        const { status, response: resp } = JSON.parse(stubRaw);
        statusCode = status;
        respBody = resp;
        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || uuidv4();
        }
        respBody = replaceRandomUUID(respBody);
    }

    const txId = req.body?.data?.tx_id as string | undefined;
    if (txId) {
        const mapKey = `request:${route}:${endpoint}:${txId}`;
        await redis.set(mapKey, JSON.stringify({ request: record, response: { status: statusCode, body: respBody } }));
        await redis.expire(mapKey, 30 * 24 * 3600);
    }

    Object.entries(generateHeaders(respBody)).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(statusCode).json(respBody);
}

export function attachCommonRoutes(router: Router, basePath: string): void {
    const path = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    router.post(`${path}/set/*`, saveNewEndpointToRedis);
    router.delete(`${path}/delete/*/:method`, deleteEndpointFromRedis);
    router.get(`${path}/history/*/:method`, getHistory);
    router.get(`${path}/stub-list`, getStubList);
    router.all(`${path}/*`, defaultRequest);
}
