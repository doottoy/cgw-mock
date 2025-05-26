"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patternStubs = void 0;
exports.loadPatternStubs = loadPatternStubs;
exports.addPatternStub = addPatternStub;
exports.removePatternStub = removePatternStub;
/* External dependencies */
const path_to_regexp_1 = require("path-to-regexp");
/* Internal dependencies */
const redis_1 = require("../redis");
exports.patternStubs = [];
const REDIS_HASH_KEY = 'patternStubs';
async function loadPatternStubs() {
    const entries = await redis_1.redis.hgetall(REDIS_HASH_KEY);
    for (const field in entries) {
        const [method, ...parts] = field.split(':');
        const pattern = parts.join(':');
        const stubData = JSON.parse(entries[field]);
        const matcher = (0, path_to_regexp_1.match)(pattern, { decode: decodeURIComponent });
        exports.patternStubs.push({ pattern, method, matcher, data: stubData });
        console.log(`Loaded pattern stub ${method.toUpperCase()} ${pattern}`);
    }
}
async function addPatternStub(pattern, stubData, method) {
    const field = `${method}:${pattern}`;
    await redis_1.redis.hset(REDIS_HASH_KEY, field, JSON.stringify(stubData));
    const matcher = (0, path_to_regexp_1.match)(pattern, { decode: decodeURIComponent });
    const idx = exports.patternStubs.findIndex(p => p.method === method && p.pattern === pattern);
    if (idx >= 0) {
        exports.patternStubs[idx].matcher = matcher;
        exports.patternStubs[idx].data = stubData;
    }
    else {
        exports.patternStubs.push({ pattern, method, matcher, data: stubData });
    }
    console.log(`Registered pattern stub ${method.toUpperCase()} ${pattern}`);
}
async function removePatternStub(pattern, method) {
    const field = `${method}:${pattern}`;
    await redis_1.redis.hdel(REDIS_HASH_KEY, field);
    const idx = exports.patternStubs.findIndex(p => p.method === method && p.pattern === pattern);
    if (idx >= 0)
        exports.patternStubs.splice(idx, 1);
    console.log(`Removed pattern stub ${method.toUpperCase()} ${pattern}`);
}
