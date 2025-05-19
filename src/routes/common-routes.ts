/* External dependencies */
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

/* Internal dependencies */
import { redis } from '../redis';
import { replaceRandomUUID, generateHeaders, getRedisHistoryKey, getRedisStubKey } from '../utility/common';

const methods = ['get', 'post', 'put', 'delete', 'patch'];

/**
 * Create or update a stub in Redis
 */
async function saveNewEndpointToRedis(
    req: Request,
    res: Response
): Promise<Response> {
    let currentMethod = 'post';
    const { status, response: resp, method } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }
    if (method && methods.includes(method.toLowerCase())) {
        currentMethod = method.toLowerCase();
    }
    const key = getRedisStubKey(req, currentMethod);
    const existed = await redis.exists(key);
    await redis.set(key, JSON.stringify({ status, response: resp }));
    return res.status(existed ? 200 : 201).json({ result: existed ? 'updated' : 'created', endpoint: req.params[0] });
}

/**
 * Delete a stub from Redis
 */
async function deleteEndpointFromRedis(
    req: Request,
    res: Response
): Promise<Response> {
    const methodParam = req.params.method;
    const currentMethod = methodParam && methods.includes(methodParam.toLowerCase()) ? methodParam.toLowerCase() : 'post';
    const key = getRedisStubKey(req, currentMethod);
    const existed = await redis.exists(key);
    if (!existed) {
        return res.sendStatus(404);
    }
    await redis.del(key);
    return res.sendStatus(204);
}

/**
 * Retrieve last 5 requests for a stub endpoint
 */
async function getHistory(
    req: Request,
    res: Response
): Promise<Response> {
    const methodParam = req.params.method;
    const currentMethod =
        methodParam && methods.includes(methodParam.toLowerCase())
            ? methodParam.toLowerCase()
            : 'post';
    const histKey = getRedisHistoryKey(req, currentMethod);
    const items = await redis.lrange(histKey, 0, 4);
    const records = items.map((item) => JSON.parse(item));
    return res.status(200).json(records);
}

/**
 * List all configured stubs (global or per service)
 */
async function getStubList(
    req: Request,
    res: Response
): Promise<Response> {
    const isGlobal = req.originalUrl === '/stub-list';
    let keys: string[];
    if (isGlobal) {
        keys = await redis.keys('stub:*');
    } else {
        const route = req.path.split('/')[1];
        keys = await redis.keys(`stub:${route}:*`);
    }
    const stubs: Array<any> = [];
    for (const key of keys) {
        const raw = await redis.get(key);
        if (!raw) continue;
        const { status, response } = JSON.parse(raw);
        if (isGlobal) {
            const [, route, endpoint] = key.split(':');
            stubs.push({ route, endpoint, status, response });
        } else {
            const route = req.path.split('/')[1];
            const endpoint = key.slice(`stub:${route}:`.length);
            stubs.push({ endpoint, status, response });
        }
    }
    return res.status(200).json(stubs);
}

/**
 * Retrieve request-response mapping by txId
 */
async function getMappingByTxId(
    req: Request,
    res: Response
): Promise<Response> {
    const parts = req.originalUrl.split('?')[0].split('/');
    const route = parts[1];
    const txId = parts.pop() as string;
    const endpoint = parts.slice(2).join('/');
    const mapKey = `request:${route}:${endpoint}:${txId}`;
    const raw = await redis.get(mapKey);
    if (!raw) {
        return res.sendStatus(404);
    }
    const { request, response } = JSON.parse(raw);
    return res.status(200).json({ request, response });
}

/**
 * Retrieve stub state for default method (POST)
 */
async function getStubState(
    req: Request,
    res: Response
): Promise<Response> {
    const key = getRedisStubKey(req, 'post');
    const raw = await redis.get(key);
    if (!raw) {
        return res.sendStatus(404);
    }
    const { status, response } = JSON.parse(raw);
    return res.status(200).json({ endpoint: req.params[0], status, response });
}

/**
 * Default handler for all other requests
 */
async function defaultRequest(
    req: Request,
    res: Response
): Promise<Response> {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const method = req.method.toLowerCase();

    const histKey = getRedisHistoryKey(req, method);
    const record = { timestamp: new Date().toISOString(), method, body: req.body };
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    const stubKey = getRedisStubKey(req, method);
    const raw = await redis.get(stubKey);
    let statusCode = 200;
    let respBody: any = {};
    if (raw) {
        const parsed = JSON.parse(raw);
        statusCode = parsed.status;
        respBody = parsed.response;
        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || uuidv4();
        }
        respBody = replaceRandomUUID(respBody);
    }

    const txId = (req.body?.data as any)?.tx_id as string | undefined;
    if (txId) {
        const mapKey = `request:${route}:${endpoint}:${txId}`;
        await redis.set(
            mapKey,
            JSON.stringify({ request: record, response: { status: statusCode, body: respBody } })
        );
        await redis.expire(mapKey, 30 * 24 * 3600);
    }

    const headers = generateHeaders(respBody);
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    return res.status(statusCode).json(respBody);
}

/**
 * Attach all common routes to a router under a base path
 */
export function attachCommonRoutes(router: Router, basePath: string): void {
    router.get('/stub-list', getStubList);
    router.post(`${basePath}/set/*`, saveNewEndpointToRedis);
    router.delete(`${basePath}/delete/*/:method?`, deleteEndpointFromRedis);
    router.get(`${basePath}/history/*/:method?`, getHistory);
    router.get(`${basePath}/stub-list`, getStubList);
    router.get(`${basePath}/*/state`, getStubState);
    router.get(new RegExp(`^${basePath}/(.+)/([^/]+)$`), getMappingByTxId);
    router.all(`${basePath}/*`, defaultRequest);
}
