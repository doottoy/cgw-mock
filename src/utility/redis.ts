/* External dependencies */
import { Request } from 'express';

export function getRedisStubKey(
    req: { path: string; params: Record<string, any> },
    method: string
): string {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    return `stub:${route}:${endpoint}:${method}`;
}

export function getRedisHistoryKey(req: Request, method: string) {
    const route = req.path.split('/')[1]
    const endpoint = req.params[0];
    const key = `history:${route}:${endpoint}:${method}`;
    return key;
}
