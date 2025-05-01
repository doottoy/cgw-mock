import cryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

import { redis } from '../redis';

const router = Router();

function generateHeaders(body: any): Record<string, string> {
    const date = Date.now().toString();
    const msg = (body !== undefined ? JSON.stringify(body) : '') + date;
    const signatureApiKey = process.env.SIGNATURE_API_KEY || '';
    const hmac = cryptoJS.HmacSHA512(msg, signatureApiKey).toString();
    return {
        'x-date': date,
        'x-signature': hmac,
    };
}

function replaceRandomUUID(obj: any): any {
    const newUUID = uuidv4();

    function recurse(value: any): any {
        if (typeof value === 'string' && value === 'randomUUID') {
            return newUUID;
        } else if (Array.isArray(value)) {
            return value.map(recurse);
        } else if (value !== null && typeof value === 'object') {
            const result: any = {};
            for (const [key, val] of Object.entries(value)) {
                result[key] = recurse(val);
            }
            return result;
        }
        return value;
    }

    return recurse(obj);
}

router.post('/exchange/*/set', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const { status, response: resp } = req.body;

    if (typeof status !== 'number' || typeof resp !== 'object') {
        return res
            .status(400)
            .json({ error: 'status (number), response (object) required' });
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

    const record = {
        timestamp: new Date().toISOString(),
        method: req.method,
        body: req.body,
    };
    await redis.lpush(histKey, JSON.stringify(record));
    await redis.ltrim(histKey, 0, 4);
    await redis.expire(histKey, 30 * 24 * 3600);

    const stubDataRaw = await redis.get(key);
    let statusCode = 200;
    let respBody: any = {};

    if (stubDataRaw) {
        const { status, response: resp } = JSON.parse(stubDataRaw);
        statusCode = status;
        respBody = replaceRandomUUID(resp);
    }

    const headers = generateHeaders(respBody);
    Object.entries(headers).forEach(([name, value]) =>
        res.setHeader(name, value)
    );

    return res.status(statusCode).json(respBody);
});

export default router;
