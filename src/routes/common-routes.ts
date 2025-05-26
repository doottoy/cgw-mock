import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

import { redis } from '../redis';
import { getRedisStubKey, getRedisHistoryKey } from '../utility/redis';
import { replaceRandomUUID, generateHeaders } from '../utility/common';
import { patternStubs, addPatternStub, removePatternStub } from '../utility/pattern-stubs';

const methods = ['get', 'post', 'put', 'delete', 'patch'];

// Helper to convert a path pattern like "/foo/:id/bar" into a Redis wildcard "*/bar"
function patternToRedisWildcard(pattern: string): string {
    return pattern.replace(/:\w+/g, '*');
}

/** Create or update a stub (static or pattern) */
async function saveNewEndpointToRedis(req: Request, res: Response): Promise<Response> {
    const { status, response: resp, method } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }

    const currentMethod = method && methods.includes(method.toLowerCase())
        ? method.toLowerCase()
        : 'post';

    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        // Pattern stub
        const field = `${currentMethod}:${stubPath}`;
        const existed = await redis.hexists('patternStubs', field);
        await addPatternStub(stubPath, { status, response: resp }, currentMethod);
        return res
            .status(existed ? 200 : 201)
            .json({ result: existed ? 'updated' : 'created', endpoint: endpointPattern });
    }

    // Static stub
    const key = getRedisStubKey(req, currentMethod);
    const existedStatic = await redis.exists(key);
    await redis.set(key, JSON.stringify({ status, response: resp }));
    return res
        .status(existedStatic ? 200 : 201)
        .json({ result: existedStatic ? 'updated' : 'created', endpoint: endpointPattern });
}

/** Delete a stub (static or pattern) */
async function deleteEndpointFromRedis(req: Request, res: Response): Promise<Response> {
    const methodParam = (req.query.method as string) || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase())
        ? methodParam.toLowerCase()
        : 'post';

    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        const field = `${currentMethod}:${stubPath}`;
        const existed = await redis.hexists('patternStubs', field);
        if (!existed) return res.sendStatus(404);
        await removePatternStub(stubPath, currentMethod);
        return res.sendStatus(204);
    }

    // Static delete
    const key = getRedisStubKey(req, currentMethod);
    const existedStatic = await redis.exists(key);
    if (!existedStatic) return res.sendStatus(404);
    await redis.del(key);
    return res.sendStatus(204);
}

/** Retrieve last 5 request histories, supporting patterns */
async function getHistory(req: Request, res: Response): Promise<Response> {
    const methodParam = (req.query.method as string) || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase())
        ? methodParam.toLowerCase()
        : 'post';

    const route = req.path.split('/')[1];
    const endpointPattern = req.params[0];
    let keys: string[];

    if (endpointPattern.includes('/:')) {
        // Pattern: collect all matching history lists
        const wildcard = patternToRedisWildcard(endpointPattern);
        keys = await redis.keys(`history:${route}:${wildcard}:${currentMethod}`);
    } else {
        // Static
        keys = [getRedisHistoryKey(req, currentMethod)];
    }

    const records: any[] = [];
    for (const k of keys) {
        const items = await redis.lrange(k, 0, 4);
        records.push(...items.map(i => JSON.parse(i)));
    }
    return res.status(200).json(records);
}

/** List all configured stubs, including pattern-based */
async function getStubList(req: Request, res: Response): Promise<Response> {
    const isGlobal = req.originalUrl === '/stub-list';
    const route = isGlobal ? '' : req.path.split('/')[1];

    // Static stubs
    const staticKeys = isGlobal
        ? await redis.keys('stub:*')
        : await redis.keys(`stub:${route}:*`);
    const stubs: any[] = [];

    for (const key of staticKeys) {
        const raw = await redis.get(key);
        if (!raw) continue;
        const { status, response } = JSON.parse(raw);
        if (isGlobal) {
            const [, r, endpoint] = key.split(':');
            stubs.push({ route: r, endpoint, status, response });
        } else {
            const endpoint = key.slice(`stub:${route}:`.length);
            stubs.push({ endpoint, status, response });
        }
    }

    // Pattern stubs
    const patternEntries = await redis.hgetall('patternStubs');
    for (const field in patternEntries) {
        const [method, pattern] = field.split(':');
        if (isGlobal || pattern.startsWith(`/${route}/`)) {
            const { status, response } = JSON.parse(patternEntries[field]);
            if (isGlobal) {
                const parts = pattern.split('/');
                const r = parts[1] || '';
                const endpoint = parts.slice(2).join('/');
                stubs.push({ route: r, endpoint, status, response });
            } else {
                const endpoint = pattern.slice(route.length + 2); // remove "/<route>/"
                stubs.push({ endpoint, status, response });
            }
        }
    }

    return res.status(200).json(stubs);
}

/** Retrieve request-response mapping by transaction ID */
async function getMappingByTxId(req: Request, res: Response): Promise<Response> {
    const parts = req.originalUrl.split('?')[0].split('/');
    const route = parts[1];
    const txId = parts.pop() as string;
    const endpoint = parts.slice(2).join('/');
    const mapKey = `request:${route}:${endpoint}:${txId}`;
    const raw = await redis.get(mapKey);
    if (!raw) return res.sendStatus(404);
    const { request, response } = JSON.parse(raw);
    return res.status(200).json({ request, response });
}

/** Retrieve stub state (static or pattern) for POST */
async function getStubState(req: Request, res: Response): Promise<Response> {
    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        // Pattern stub state
        const field = `post:${stubPath}`;
        const raw = await redis.hget('patternStubs', field);
        if (!raw) return res.sendStatus(404);
        const { status, response } = JSON.parse(raw);
        return res.status(200).json({ endpoint: endpointPattern, status, response });
    }

    // Static stub state
    const key = getRedisStubKey(req, 'post');
    const raw = await redis.get(key);
    if (!raw) return res.sendStatus(404);
    const { status, response } = JSON.parse(raw);
    return res.status(200).json({ endpoint: endpointPattern, status, response });
}

/** Default handler: record history → static stub → pattern stub → map by tx → 404 */
async function defaultRequest(req: Request, res: Response): Promise<Response> {
    const method = req.method.toLowerCase();
    const route = req.path.split('/')[1];

    // 1) record history
    const histKey = getRedisHistoryKey(req, method);
    const record = { timestamp: new Date().toISOString(), method, body: req.body };
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    // 2) static stub lookup
    const stubKey = getRedisStubKey(req, method);
    const rawStatic = await redis.get(stubKey);
    if (rawStatic) {
        const { status, response } = JSON.parse(rawStatic);
        let respBody = response;
        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || uuidv4();
        }
        respBody = replaceRandomUUID(respBody);

        // map by txId if present
        const txId = (req.body?.data as any)?.tx_id as string | undefined;
        if (txId) {
            const mapKey = `request:${route}:${req.params[0]}:${txId}`;
            await redis.set(
                mapKey,
                JSON.stringify({ request: record, response: { status, body: respBody } })
            );
            await redis.expire(mapKey, 30 * 24 * 3600);
        }

        const headers = generateHeaders(respBody);
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(status).json(respBody);
    }

    // 3) pattern stub lookup
    for (const { matcher, data, method: stubMethod } of patternStubs) {
        if (stubMethod !== method) continue;
        const m = matcher(req.path);
        if (m) {
            const params = m.params;
            let respBody = JSON.parse(JSON.stringify(data.response));
            respBody = JSON.parse(
                JSON.stringify(data.response).replace(/\{\{(\w+)\}\}/g, (_, name) => params[name] || '')
            );

            // map by txId if present
            const txId = (req.body?.data as any)?.tx_id as string | undefined;
            if (txId) {
                const mapKey = `request:${route}:${req.params[0]}:${txId}`;
                await redis.set(
                    mapKey,
                    JSON.stringify({ request: record, response: { status: data.status, body: respBody } })
                );
                await redis.expire(mapKey, 30 * 24 * 3600);
            }

            const headers = generateHeaders(respBody);
            Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
            return res.status(data.status).json(respBody);
        }
    }

    // 4) no stub matched
    return res.status(404).json({ error: `No stub for ${req.method} ${req.path}` });
}

/** Attach all common routes under basePath */
export function attachCommonRoutes(router: Router, basePath: string): void {
    router.post(`${basePath}/set/*`, saveNewEndpointToRedis);
    router.delete(`${basePath}/delete/*`, deleteEndpointFromRedis);
    router.get(`${basePath}/history/*`, getHistory);
    router.get(new RegExp(`^${basePath}/(.+)/([^/]+)$`), getMappingByTxId);
    router.get('/stub-list', getStubList);
    router.get(`${basePath}/stub-list`, getStubList);
    router.get(`${basePath}/*/state`, getStubState);
    router.all(`${basePath}/*`, defaultRequest);
}
