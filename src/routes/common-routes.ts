/* External dependencies */
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

/* Internal dependencies */
import { redis } from '../redis';
import { patternToRedisWildcard } from '../utility/pattern-stubs';
import { getRedisStubKey, getRedisHistoryKey } from '../utility/redis';
import { replaceRandomUUID, generateHeaders } from '../utility/common';
import { patternStubs, addPatternStub, removePatternStub } from '../utility/pattern-stubs';

const methods = ['get', 'post', 'put', 'delete', 'patch'];

/**
 * Create or update a stub in Redis
 * @param req Express Request object. Expects req.body.status (number), req.body.response (object), and optional req.body.method
 * @param res Express Response object
 * @returns A Response with JSON { result: 'created'|'updated', endpoint: string }
 */
async function saveNewEndpointToRedis(req: Request, res: Response): Promise<Response> {
    const { status, response: resp, method } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }

    const currentMethod = method && methods.includes(method.toLowerCase()) ? method.toLowerCase() : 'post';
    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        const field = `${currentMethod}:${stubPath}`;
        const existed = await redis.hexists('patternStubs', field);
        await addPatternStub(stubPath, { status, response: resp }, currentMethod);
        return res.status(existed ? 200 : 201).json({ result: existed ? 'updated' : 'created', endpoint: endpointPattern });
    }

    const key = getRedisStubKey(req, currentMethod);
    const existedStatic = await redis.exists(key);
    await redis.set(key, JSON.stringify({ status, response: resp }));
    return res.status(existedStatic ? 200 : 201).json({ result: existedStatic ? 'updated' : 'created', endpoint: endpointPattern });
}

/**
 * Delete a stub from Redis
 * @param req Express Request. Uses req.params.method to determine HTTP method, defaults to 'post'
 * @param res Express Response
 * @returns 204 No Content if deleted, or 404 Not Found if no stub existed
 */
async function deleteEndpointFromRedis(req: Request, res: Response): Promise<Response> {
    const methodParam = (req.query.method as string) || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase()) ? methodParam.toLowerCase() : 'post';

    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        const field = `${currentMethod}:${stubPath}`;
        const existed = await redis.hexists('patternStubs', field);
        if (!existed) return res.sendStatus(404);
        await removePatternStub(stubPath, currentMethod);
        return res.sendStatus(204);
    }

    const key = getRedisStubKey(req, currentMethod);
    const existedStatic = await redis.exists(key);
    if (!existedStatic) return res.sendStatus(404);
    await redis.del(key);
    return res.sendStatus(204);
}

/**
 * Retrieve the last 5 requests for a stub endpoint
 * @param req Express Request. Uses req.params.method to select history list key
 * @param res Express Response
 * @returns JSON array of request records
 */
async function getHistory(req: Request, res: Response): Promise<Response> {
    const methodParam = (req.query.method as string) || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase()) ? methodParam.toLowerCase() : 'post';

    const route = req.path.split('/')[1];
    const endpointPattern = req.params[0];
    let keys: string[];

    if (endpointPattern.includes('/:')) {
        const wildcard = patternToRedisWildcard(endpointPattern);
        keys = await redis.keys(`history:${route}:${wildcard}:${currentMethod}`);
    } else {
        keys = [getRedisHistoryKey(req, currentMethod)];
    }

    const records: any[] = [];
    for (const k of keys) {
        const items = await redis.lrange(k, 0, 4);
        records.push(...items.map(i => JSON.parse(i)));
    }
    return res.status(200).json(records);
}

/**
 * List all configured stubs (global or per service)
 * @param req Express Request. If URL is '/stub-list', returns all; otherwise filters by service
 * @param res Express Response
 * @returns JSON array of stub definitions
 */
async function getStubList(req: Request, res: Response): Promise<Response> {
    const isGlobal = req.originalUrl === '/stub-list';
    const route = isGlobal ? '' : req.path.split('/')[1];

    const staticKeys = isGlobal ? await redis.keys('stub:*') : await redis.keys(`stub:${route}:*`);
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

    const patternEntries = await redis.hgetall('patternStubs');
    for (const field in patternEntries) {
        const [pattern] = field.split(':');
        if (isGlobal || pattern.startsWith(`/${route}/`)) {
            const { status, response } = JSON.parse(patternEntries[field]);

            const endpoint = pattern.replace(new RegExp(`^/${route}/`), '');

            if (isGlobal) {
                const [ , r, ...rest ] = pattern.split('/');
                stubs.push({ route: r, endpoint: rest.join('/'), status, response });
            } else {
                stubs.push({ endpoint, status, response });
            }
        }
    }

    return res.status(200).json(stubs);
}

/**
 * Retrieve request-response mapping by transaction ID
 * @param req Express Request. Parses service, endpoint, and txId from URL
 * @param res Express Response
 * @returns JSON { request, response } or 404 if not found
 */
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

/**
 * Retrieve the stub configuration state for the default (POST) method
 * @param req Express Request. Uses req.params[0] for endpoint
 * @param res Express Response
 * @returns JSON { endpoint, status, response } or 404 if stub not found
 */
async function getStubState(req: Request, res: Response): Promise<Response> {
    const endpointPattern = req.params[0];
    const stubPath = `${req.baseUrl}/${endpointPattern}`;

    if (stubPath.includes('/:')) {
        const field = `post:${stubPath}`;
        const raw = await redis.hget('patternStubs', field);
        if (!raw) return res.sendStatus(404);
        const { status, response } = JSON.parse(raw);
        return res.status(200).json({ endpoint: endpointPattern, status, response });
    }

    const key = getRedisStubKey(req, 'post');
    const raw = await redis.get(key);
    if (!raw) return res.sendStatus(404);
    const { status, response } = JSON.parse(raw);
    return res.status(200).json({ endpoint: endpointPattern, status, response });
}

/**
 * Default handler for all other requests: records history, applies stub, maps txId, signs, and responds
 * @param req Express Request with arbitrary path under basePath
 * @param res Express Response
 * @returns Stubbed or default JSON response
 */
async function defaultRequest(req: Request, res: Response): Promise<Response> {
    const method = req.method.toLowerCase();
    const route = req.path.split('/')[1];

    const histKey = getRedisHistoryKey(req, method);
    const record = { timestamp: new Date().toISOString(), method, body: req.body };
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    const stubKey = getRedisStubKey(req, method);
    const rawStatic = await redis.get(stubKey);
    if (rawStatic) {
        const { status, response } = JSON.parse(rawStatic);
        let respBody = response;
        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || uuidv4();
        }
        respBody = replaceRandomUUID(respBody);

        const txId = (req.body?.data as any)?.tx_id as string | undefined;
        if (txId) {
            const mapKey = `request:${route}:${req.params[0]}:${txId}`;
            await redis.set(mapKey, JSON.stringify({ request: record, response: { status, body: respBody } }));
            await redis.expire(mapKey, 30 * 24 * 3600);
        }

        const headers = generateHeaders(respBody);
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(status).json(respBody);
    }

    for (const { matcher, data, method: stubMethod } of patternStubs) {
        if (stubMethod !== method) continue;
        const match = matcher(req.path);
        if (match) {
            const params = match.params;
            let respBody = JSON.parse(JSON.stringify(data.response));
            respBody = JSON.parse(JSON.stringify(data.response).replace(/\{\{(\w+)\}\}/g, (_, name) => params[name] || ''));

            const txId = (req.body?.data as any)?.tx_id as string | undefined;
            if (txId) {
                const mapKey = `request:${route}:${req.params[0]}:${txId}`;
                await redis.set(mapKey, JSON.stringify({ request: record, response: { status: data.status, body: respBody } }));
                await redis.expire(mapKey, 30 * 24 * 3600);
            }

            const headers = generateHeaders(respBody);
            Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
            return res.status(data.status).json(respBody);
        }
    }

    return res.status(404).json({ error: `No stub for ${req.method} ${req.path}` });
}

/**
 * Attach all common routes to a router under a given base path
 * @param router Express Router to attach routes to
 * @param basePath Base URL path for the service
 */
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
