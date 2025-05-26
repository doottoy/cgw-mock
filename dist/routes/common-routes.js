"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachCommonRoutes = attachCommonRoutes;
const uuid_1 = require("uuid");
const redis_1 = require("../redis");
const redis_2 = require("../utility/redis");
const common_1 = require("../utility/common");
const pattern_stubs_1 = require("../utility/pattern-stubs");
const methods = ['get', 'post', 'put', 'delete', 'patch'];
function toWildcard(pattern) {
    return pattern.replace(/:\w+/g, '*');
}
async function saveNewEndpointToRedis(req, res) {
    const { status, response: resp, method } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }
    const currentMethod = (method && methods.includes(method.toLowerCase()))
        ? method.toLowerCase()
        : 'post';
    const endpointPattern = req.params[0];
    const fullPath = `${req.baseUrl}/${endpointPattern}`;
    if (fullPath.includes('/:')) {
        const key = `${currentMethod}:${fullPath}`;
        const existed = await redis_1.redis.hexists('patternStubs', key);
        await (0, pattern_stubs_1.addPatternStub)(fullPath, { status, response: resp }, currentMethod);
        return res.status(existed ? 200 : 201)
            .json({ result: existed ? 'updated' : 'created', endpoint: endpointPattern });
    }
    const redisKey = (0, redis_2.getRedisStubKey)(req, currentMethod);
    const existedStatic = await redis_1.redis.exists(redisKey);
    await redis_1.redis.set(redisKey, JSON.stringify({ status, response: resp }));
    return res.status(existedStatic ? 200 : 201)
        .json({ result: existedStatic ? 'updated' : 'created', endpoint: endpointPattern });
}
async function deleteEndpointFromRedis(req, res) {
    const methodParam = req.query.method || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase())
        ? methodParam.toLowerCase()
        : 'post';
    const endpointPattern = req.params[0];
    const fullPath = `${req.baseUrl}/${endpointPattern}`;
    if (fullPath.includes('/:')) {
        const key = `${currentMethod}:${fullPath}`;
        const existed = await redis_1.redis.hexists('patternStubs', key);
        if (!existed)
            return res.sendStatus(404);
        await (0, pattern_stubs_1.removePatternStub)(fullPath, currentMethod);
        return res.sendStatus(204);
    }
    const redisKey = (0, redis_2.getRedisStubKey)(req, currentMethod);
    const existedStatic = await redis_1.redis.exists(redisKey);
    if (!existedStatic)
        return res.sendStatus(404);
    await redis_1.redis.del(redisKey);
    return res.sendStatus(204);
}
async function getHistory(req, res) {
    const methodParam = req.query.method || 'post';
    const currentMethod = methods.includes(methodParam.toLowerCase())
        ? methodParam.toLowerCase()
        : 'post';
    const route = req.baseUrl.slice(1);
    const endpointPattern = req.params[0];
    let keys;
    if (endpointPattern.includes('/:')) {
        const wildcard = toWildcard(endpointPattern);
        keys = await redis_1.redis.keys(`history:${route}:${wildcard}:${currentMethod}`);
    }
    else {
        keys = [(0, redis_2.getRedisHistoryKey)(req, currentMethod)];
    }
    const records = [];
    for (const k of keys) {
        const items = await redis_1.redis.lrange(k, 0, 4);
        records.push(...items.map(i => JSON.parse(i)));
    }
    return res.status(200).json(records);
}
async function getStubList(req, res) {
    const isGlobal = req.originalUrl === '/stub-list';
    const route = isGlobal ? '' : req.baseUrl.slice(1);
    const stubs = [];
    const staticKeys = isGlobal
        ? await redis_1.redis.keys('stub:*')
        : await redis_1.redis.keys(`stub:${route}:*`);
    for (const key of staticKeys) {
        const raw = await redis_1.redis.get(key);
        if (!raw)
            continue;
        const { status, response } = JSON.parse(raw);
        if (isGlobal) {
            const [, r, endpoint] = key.split(':');
            stubs.push({ route: r, endpoint, status, response });
        }
        else {
            const endpoint = key.slice(`stub:${route}:`.length);
            stubs.push({ endpoint, status, response });
        }
    }
    const entries = await redis_1.redis.hgetall('patternStubs');
    for (const field in entries) {
        const [method, pattern] = field.split(':');
        if (isGlobal || pattern.startsWith(`/${route}/`)) {
            const { status, response } = JSON.parse(entries[field]);
            if (isGlobal) {
                const parts = pattern.split('/');
                const r = parts[1] || '';
                const endpoint = parts.slice(2).join('/');
                stubs.push({ route: r, endpoint, status, response, method });
            }
            else {
                const endpoint = pattern.slice(route.length + 2);
                stubs.push({ endpoint, status, response, method });
            }
        }
    }
    return res.status(200).json(stubs);
}
async function getMappingByTxId(req, res) {
    const parts = req.originalUrl.split('?')[0].split('/');
    const route = parts[1];
    const txId = parts.pop();
    const endpoint = parts.slice(2).join('/');
    const mapKey = `request:${route}:${endpoint}:${txId}`;
    const raw = await redis_1.redis.get(mapKey);
    if (!raw)
        return res.sendStatus(404);
    const { request, response } = JSON.parse(raw);
    return res.status(200).json({ request, response });
}
async function getStubState(req, res) {
    const endpointPattern = req.params[0];
    const fullPath = `${req.baseUrl}/${endpointPattern}`;
    if (fullPath.includes('/:')) {
        const field = `post:${fullPath}`;
        const raw = await redis_1.redis.hget('patternStubs', field);
        if (!raw)
            return res.sendStatus(404);
        const { status, response } = JSON.parse(raw);
        return res.status(200).json({ endpoint: endpointPattern, status, response });
    }
    const key = (0, redis_2.getRedisStubKey)(req, 'post');
    const raw = await redis_1.redis.get(key);
    if (!raw)
        return res.sendStatus(404);
    const { status, response } = JSON.parse(raw);
    return res.status(200).json({ endpoint: endpointPattern, status, response });
}
async function defaultRequest(req, res) {
    const method = req.method.toLowerCase();
    const route = req.baseUrl.slice(1);
    const endpointParam = req.params[0];
    const histKey = (0, redis_2.getRedisHistoryKey)(req, method);
    const record = { timestamp: new Date().toISOString(), method, body: req.body };
    await redis_1.redis.lpush(histKey, JSON.stringify(record));
    await redis_1.redis.ltrim(histKey, 0, 4);
    await redis_1.redis.expire(histKey, 30 * 24 * 3600);
    const stubKey = (0, redis_2.getRedisStubKey)(req, method);
    const rawStatic = await redis_1.redis.get(stubKey);
    if (rawStatic) {
        const { status, response } = JSON.parse(rawStatic);
        let respBody = response;
        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || (0, uuid_1.v4)();
        }
        respBody = (0, common_1.replaceRandomUUID)(respBody);
        const txId = req.body?.data?.tx_id;
        if (txId) {
            const mapKey = `request:${route}:${endpointParam}:${txId}`;
            await redis_1.redis.set(mapKey, JSON.stringify({ request: record, response: { status, body: respBody } }));
            await redis_1.redis.expire(mapKey, 30 * 24 * 3600);
        }
        const headers = (0, common_1.generateHeaders)(respBody);
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(status).json(respBody);
    }
    for (const { matcher, data, method: stubMethod } of pattern_stubs_1.patternStubs) {
        if (stubMethod !== method)
            continue;
        const m = matcher(req.path);
        for (const { matcher, data, method: stubMethod } of pattern_stubs_1.patternStubs) {
            if (stubMethod !== method)
                continue;
            const m = matcher(req.path);
            if (m) {
                const template = JSON.stringify(data.response);
                const replaced = template.replace(/\{\{(\w+)\}\}/g, (_match, name) => m.params[name] ?? '');
                const respBody = JSON.parse(replaced);
                const txId = req.body?.data?.tx_id;
                if (txId) {
                    const mapKey = `request:${route}:${endpointParam}:${txId}`;
                    await redis_1.redis.set(mapKey, JSON.stringify({ request: record, response: { status: data.status, body: respBody } }));
                    await redis_1.redis.expire(mapKey, 30 * 24 * 3600);
                }
                const headers = (0, common_1.generateHeaders)(respBody);
                Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
                return res.status(data.status).json(respBody);
            }
        }
    }
    return res.status(404).json({ error: `No stub for ${req.method} ${req.path}` });
}
function attachCommonRoutes(router, basePath) {
    router.post(`${basePath}/set/*`, saveNewEndpointToRedis);
    router.delete(`${basePath}/delete/*`, deleteEndpointFromRedis);
    router.get(`${basePath}/history/*`, getHistory);
    router.get(new RegExp(`^${basePath}/(.+)/([^/]+)$`), getMappingByTxId);
    router.get('/stub-list', getStubList);
    router.get(`${basePath}/stub-list`, getStubList);
    router.get(`${basePath}/*/state`, getStubState);
    router.all(`${basePath}/*`, defaultRequest);
}
