/* External dependencies */
import cryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

/* Internal dependencies */
import { redis } from '../redis';

const router = Router();

/**
 * Generates HMAC-SHA512 headers based on the response body and a timestamp
 * @param body - The response payload to sign
 * @returns An object containing 'x-date' and 'x-signature' headers
 */
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

/**
 * Recursively replaces 'randomUUID' placeholders in an object or array with a real UUID
 * @param obj - The object or array to process
 * @returns A new object/array with placeholders replaced
 */
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

/**
 * Create or update a stub for a given exchange endpoint
 * @route POST /exchange/:endpoint/set
 * @param status - HTTP status code to return for the stub
 * @param response - JSON body to return for the stub
 * @returns 201 Created if new stub, or 200 OK if updated
 */
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

/**
 * Handle main exchange request: record history, apply stub logic, replace placeholders, and sign response
 * @route POST /exchange/:endpoint
 * @param req.body - Incoming request payload, optionally containing request_id
 * @returns Stubbed response with headers 'x-date' and 'x-signature'
 */
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
        respBody = resp;

        if (respBody.request_id === 'randomUUID') {
            respBody.request_id = req.body.request_id || uuidv4();
        }
        respBody = replaceRandomUUID(respBody);
    }

    const headers = generateHeaders(respBody);
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    return res.status(statusCode).json(respBody);
});

/**
 * Retrieve the last 5 requests received for a stub endpoint
 * @route GET /exchange/:endpoint/history
 * @returns Array of request records
 */
router.get('/exchange/*/history', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const histKey = `history:${endpoint}`;
    const items = await redis.lrange(histKey, 0, 4);
    const records = items.map(item => JSON.parse(item));
    return res.status(200).json(records);
});

/**
 * Retrieve a list of all configured stubs
 * @route GET /exchange/stub-list
 * @returns Array of { endpoint, status, response }
 */
router.get('/exchange/stub-list', async (_req: Request, res: Response) => {
    const keys = await redis.keys('stub:*');
    const stubs: Array<{ endpoint: string; status: number; response: any }> = [];
    for (const key of keys) {
        const endpoint = key.slice('stub:'.length);
        const raw = await redis.get(key);
        if (raw) {
            const { status, response } = JSON.parse(raw);
            stubs.push({ endpoint, status, response });
        }
    }
    return res.status(200).json(stubs);
});

/**
 * Retrieve the stub configuration for a specific endpoint
 * @route GET /exchange/:endpoint/state
 * @returns 200 and stub or 404 if not found
 */
router.get('/exchange/*/state', async (req: Request, res: Response) => {
    const endpoint = req.params[0];
    const key = `stub:${endpoint}`;
    const raw = await redis.get(key);
    if (!raw) {
        return res.sendStatus(404);
    }
    const { status, response } = JSON.parse(raw);
    return res.status(200).json({ endpoint, status, response });
});

export default router;
