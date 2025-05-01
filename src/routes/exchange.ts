import { Router, Request, Response } from 'express';

import { redis } from '../redis';

const router = Router();

router.post('/exchange/*/set', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const { status, response: resp } = req.body;
    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res.status(400).json({ error: 'status (number), response (object) required' });
    }

    const key = `stub:${endpoint}`;
    const existed = await redis.exists(key);

    await redis.set(
        key,
        JSON.stringify({ status, response: resp }),
        'EX',
        30 * 24 * 3600
    );

    const result = existed ? 'updated' : 'created';
    return res.status(existed ? 200 : 201).json({ result, endpoint });
});

router.get('/exchange/*/history', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const histKey = `history:${endpoint}`;
    const items = await redis.lrange(histKey, 0, 4);
    const records = items.map(item => JSON.parse(item));
    return res.status(200).json(records);
});

router.post('/exchange/*', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const key = `stub:${endpoint}`;
    const histKey = `history:${endpoint}`;

    const record = { timestamp: new Date().toISOString(), method: req.method, body: req.body };
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    const stubData = await redis.get(key);
    let statusCode = 200;
    let respBody: any = {};

    if (stubData) {
        const { status, response: resp } = JSON.parse(stubData);
        statusCode = status;
        respBody = resp;
    }

    res.status(statusCode).json(respBody);
});

export default router;
