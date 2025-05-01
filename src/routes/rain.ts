/* External dependencies */
import axios from 'axios';
import { Router, Request, Response } from 'express';

/* Internal dependencies */
import { redis } from '../redis';

const router = Router();

router.post('/rain', async (req: Request, res: Response) => {
    const { request_id, callback_url, ...rest } = req.body;
    if (!request_id || !callback_url) {
        return res.status(400).json({ error: 'request_id and callback_url are required' });
    }

    const key = `req:${request_id}`;
    const exists = await redis.exists(key);
    if (exists) {
        return res.status(409).json({ error: 'request_id already exists' });
    }

    await redis.set(
        key,
        JSON.stringify({ callback_url, payload: rest }),
        'EX',
        7 * 24 * 3600
    );

    res.status(200).json({ result: 'ok' });

    axios.post(callback_url, { request_id, data: rest }).catch(console.error);
});

export default router;
