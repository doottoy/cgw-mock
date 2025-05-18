/* External dependencies */
import { v4 as uuidv4 } from 'uuid'
import { Router, Request, Response } from 'express'

/* Internal dependencies */
import { redis } from '../redis'
import { makeStubKey } from '../utility/redisKeys'
import { generateHeaders, replaceRandomUUID } from '../utility/common'

const HISTORY_TTL = 30 * 24 * 3600

async function saveNewEndpointToRedis(req: Request, res: Response) {
    const { status, response: resp, method } = req.body
    if (typeof status !== 'number' || typeof resp !== 'object')
        return res.status(400).json({ error: 'status and response required' })
    const route = req.path.split('/')[1]
    const endpoint = req.params[0]
    const httpMethod = typeof method === 'string' && ['get','post','put','delete','patch'].includes(method.toLowerCase())
        ? method.toLowerCase() : 'post'
    const key = makeStubKey(route, endpoint, httpMethod)
    const existed = await redis.exists(key)
    await redis.set(key, JSON.stringify({ status, response: resp }))
    return res.status(existed ? 200 : 201).json({ result: existed ? 'updated' : 'created', endpoint })
}

async function deleteEndpointFromRedis(req: Request, res: Response) {
    const route = req.path.split('/')[1]
    const endpoint = req.params[0]
    const keys = await redis.keys(`stub:${route}:${endpoint}:*`)
    if (keys.length === 0) return res.sendStatus(404)
    await Promise.all(keys.map(k => redis.del(k)))
    return res.sendStatus(204)
}

async function getHistory(req: Request, res: Response) {
    const route = req.path.split('/')[1]
    const endpoint = req.params[0]
    const items = await redis.lrange(`history:${route}:${endpoint}`, 0, 4)
    return res.status(200).json(items.map(i => JSON.parse(i)))
}

async function getStubList(req: Request, res: Response) {
    const route = req.path.split('/')[1]
    const keys = await redis.keys(`stub:${route}:*`)
    const stubs = []
    for (const key of keys) {
        const endpoint = key.split(`stub:${route}:`)[1].split(':')[0]
        const raw = await redis.get(key)
        const { status, response } = JSON.parse(raw!)
        stubs.push({ endpoint, status, response })
    }
    return res.status(200).json(stubs)
}

async function getMapping(req: Request, res: Response) {
    const route = req.path.split('/')[1]
    const endpoint = req.params[0]
    const requestId = req.params.requestId
    const raw = await redis.get(`request:${route}:${endpoint}:${requestId}`)
    if (!raw) return res.sendStatus(404)
    const { request, response } = JSON.parse(raw)
    return res.status(200).json({ request, response })
}

async function defaultRequest(req: Request, res: Response) {
    const route = req.path.split('/')[1]
    const endpoint = req.params[0]
    const method = req.method.toLowerCase()
    const record = { timestamp: new Date().toISOString(), method, body: req.body }
    await redis.lpush(`history:${route}:${endpoint}`, JSON.stringify(record))
    await redis.ltrim(`history:${route}:${endpoint}`, 0, 4)
    await redis.expire(`history:${route}:${endpoint}`, HISTORY_TTL)
    const stubKey = makeStubKey(route, endpoint, method)
    const stubRaw = await redis.get(stubKey)
    let statusCode = 200, respBody: any = {}
    if (stubRaw) {
        const { status, response: resp } = JSON.parse(stubRaw)
        statusCode = status
        respBody = resp
        if (respBody.request_id === 'randomUUID') respBody.request_id = req.body.request_id || uuidv4()
        respBody = replaceRandomUUID(respBody)
    }
    const reqId = respBody.request_id || (req.body?.body && (req.body.body as any).id)
    if (reqId) {
        const mapKey = `request:${route}:${endpoint}:${reqId}`
        await redis.set(mapKey, JSON.stringify({ request: record, response: { status: statusCode, body: respBody } }))
        await redis.expire(mapKey, HISTORY_TTL)
    }
    Object.entries(generateHeaders(respBody)).forEach(([k, v]) => res.setHeader(k, v))
    return res.status(statusCode).json(respBody)
}

export function attachCommonRoutes(router: Router, basePath: string) {
    const path = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
    router.post(`${path}/set/*`, saveNewEndpointToRedis)
    router.delete(`${path}/delete/*`, deleteEndpointFromRedis)
    router.get(`${path}/history/*`, getHistory)
    router.get(`${path}/stub-list`, getStubList)
    router.get(`${path}/*/:requestId`, getMapping)
    router.all(`${path}/*`, defaultRequest)
}
