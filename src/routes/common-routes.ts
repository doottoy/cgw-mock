/* src/routes/common-routes.ts */
import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { redis } from '../redis'
import { generateHeaders, replaceRandomUUID } from '../utility/common'

const HISTORY_TTL = 30 * 24 * 3600

async function saveNewEndpointToRedis(req: Request, res: Response) {
    const { status, response: resp } = req.body
    if (typeof status !== 'number' || typeof resp !== 'object')
        return res.status(400).json({ error: 'status and response required' })
    const endpoint = req.params[0]
    const key = `stub:${endpoint}`
    const existed = await redis.exists(key)
    await redis.set(key, JSON.stringify({ status, response: resp }))
    return res.status(existed ? 200 : 201).json({ result: existed ? 'updated' : 'created', endpoint })
}

async function deleteEndpointFromRedis(req: Request, res: Response) {
    const endpoint = req.params[0]
    const key = `stub:${endpoint}`
    const existed = await redis.exists(key)
    if (!existed) return res.sendStatus(404)
    await redis.del(key)
    return res.sendStatus(204)
}

async function getHistory(req: Request, res: Response) {
    const endpoint = req.params[0]
    const items = await redis.lrange(`history:${endpoint}`, 0, 4)
    return res.status(200).json(items.map(i => JSON.parse(i)))
}

async function getStubList(_req: Request, res: Response) {
    const keys = await redis.keys('stub:*')
    const stubs: Array<{ endpoint: string; status: number; response: any }> = []
    for (const key of keys) {
        const endpoint = key.slice('stub:'.length)
        const raw = await redis.get(key)
        const { status, response } = JSON.parse(raw!)
        stubs.push({ endpoint, status, response })
    }
    return res.status(200).json(stubs)
}

async function defaultRequest(req: Request, res: Response) {
    const endpoint = req.params[0]
    const record = { timestamp: new Date().toISOString(), method: req.method, body: req.body }
    await redis.lpush(`history:${endpoint}`, JSON.stringify(record))
    await redis.ltrim(`history:${endpoint}`, 0, 4)
    await redis.expire(`history:${endpoint}`, HISTORY_TTL)

    const rawStub = await redis.get(`stub:${endpoint}`)
    let statusCode = 200
    let respBody: any = {}
    if (rawStub) {
        const { status, response } = JSON.parse(rawStub)
        statusCode = status
        respBody = response
        if (respBody.request_id === 'randomUUID') respBody.request_id = req.body.request_id || uuidv4()
        respBody = replaceRandomUUID(respBody)
    }

    const txId = req.body.data?.tx_id as string | undefined
    const reqId = txId || respBody.request_id || (req.body?.body && (req.body.body as any).id)
    if (reqId) {
        const mapKey = `request:${endpoint}:${reqId}`
        await redis.set(mapKey, JSON.stringify({ request: record, response: { status: statusCode, body: respBody } }))
        await redis.expire(mapKey, HISTORY_TTL)
    }

    const headers = generateHeaders(respBody)
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v))
    return res.status(statusCode).json(respBody)
}

async function getMapping(req: Request, res: Response) {
    const endpoint = req.params[0]
    const requestId = req.params.requestId
    const raw = await redis.get(`request:${endpoint}:${requestId}`)
    if (!raw) return res.sendStatus(404)
    const { request, response } = JSON.parse(raw)
    return res.status(200).json({ request, response })
}

export function attachCommonRoutes(router: Router, basePath: string) {
    const path = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
    router.post(`${path}/set/*`, saveNewEndpointToRedis)
    router.delete(`${path}/delete/*`, deleteEndpointFromRedis)
    router.get(`${path}/history/*`, getHistory)
    router.get(`${path}/stub-list`, getStubList)
    router.post(`${path}/*`, defaultRequest)
    router.get(`${path}/*/:requestId`, getMapping)
}
