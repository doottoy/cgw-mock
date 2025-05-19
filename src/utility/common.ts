/* External dependencies */
import util from 'util';
import cryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

export function loggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const requestId = uuidv4();
    const startTimestamp = new Date(startTime).toISOString();
    const { method, originalUrl } = req;

    console.groupCollapsed(`⚡  [${requestId}][${startTimestamp}] ${method} ${originalUrl}`);
    console.log(` [${requestId}] Request Headers:`, util.inspect(JSON.stringify(req.headers), { depth: null }));
    console.log(` [${requestId}] Request Body:   `, util.inspect(JSON.stringify(req.body), { depth: null }));
    console.groupEnd();

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        const endTimestamp = new Date(endTime).toISOString();
        const responseBody = body;
        const size = Buffer.byteLength(JSON.stringify(responseBody), 'utf8');

        console.groupCollapsed(`📤 [${requestId}][${endTimestamp}] ${method} ${originalUrl} (${duration}ms ⏱️)`);
        console.log(` [${requestId}] Response Size:    ${size} bytes`);
        console.log(` [${requestId}] Response Headers:`, util.inspect(JSON.stringify(res.getHeaders()), { depth: null }));
        console.log(` [${requestId}] Response Body:   `, util.inspect(JSON.stringify(responseBody), { depth: null }));
        console.groupEnd();

        return originalJson(body);
    };

    next();
}

export function generateHeaders(body: any): Record<string, string> {
    const date = Date.now().toString();
    const msg = (body !== undefined ? JSON.stringify(body) : '') + date;
    const signatureApiKey = process.env.SIGNATURE_API_KEY || 'secretKey';
    const hmac = cryptoJS.HmacSHA512(msg, signatureApiKey).toString();
    return {
        'x-date': date,
        'x-signature': hmac,
    };
}

export function replaceRandomUUID(obj: any): any {
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

