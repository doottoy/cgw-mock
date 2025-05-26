"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedStubs = seedStubs;
/* External dependencies */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/* Internal dependencies */
const redis_1 = require("../redis");
const redis_2 = require("./redis");
const pattern_stubs_1 = require("./pattern-stubs");
const methods = ['get', 'post', 'put', 'delete', 'patch'];
/**
 * Loads stubs from a JSON config and writes them to Redis
 */
async function seedStubs() {
    const filePath = path_1.default.resolve(__dirname, '..', '..', 'src', 'config', 'stubs.json');
    let stubs = [];
    try {
        const raw = fs_1.default.readFileSync(filePath, 'utf-8');
        stubs = JSON.parse(raw);
    }
    catch (err) {
        console.error('Failed to read stubs.json:', err);
        return;
    }
    for (const stub of stubs) {
        const method = stub.body.method && methods.includes(stub.body.method.toLowerCase()) ? stub.body.method.toLowerCase() : 'post';
        const fullPath = stub.path;
        if (fullPath.includes('/:')) {
            await (0, pattern_stubs_1.addPatternStub)(fullPath, { status: stub.body.status, response: stub.body.response }, method);
            continue;
        }
        const fakeReq = { path: fullPath, params: stub.params || {} };
        const key = (0, redis_2.getRedisStubKey)(fakeReq, method);
        try {
            await redis_1.redis.set(key, JSON.stringify({ status: stub.body.status, response: stub.body.response }));
            console.log('Seeded stub', fullPath);
        }
        catch (err) {
            console.error(`Failed to seed stub ${fullPath}:`, err);
        }
    }
}
