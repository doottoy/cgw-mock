"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisStubKey = getRedisStubKey;
exports.getRedisHistoryKey = getRedisHistoryKey;
function getRedisStubKey(req, method) {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    return `stub:${route}:${endpoint}:${method}`;
}
function getRedisHistoryKey(req, method) {
    const route = req.path.split('/')[1];
    const endpoint = req.params[0];
    const key = `history:${route}:${endpoint}:${method}`;
    return key;
}
