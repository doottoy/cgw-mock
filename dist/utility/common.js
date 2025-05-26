"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggingMiddleware = loggingMiddleware;
exports.generateHeaders = generateHeaders;
exports.replaceRandomUUID = replaceRandomUUID;
/* External dependencies */
const util_1 = __importDefault(require("util"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const uuid_1 = require("uuid");
function loggingMiddleware(req, res, next) {
    const startTime = Date.now();
    const requestId = (0, uuid_1.v4)();
    const startTimestamp = new Date(startTime).toISOString();
    const { method, originalUrl } = req;
    console.groupCollapsed(`⚡ [${requestId}][${startTimestamp}] ${method} ${originalUrl}`);
    console.log(` [${requestId}] Request Headers:`, util_1.default.inspect(JSON.stringify(req.headers), { depth: null }));
    console.log(` [${requestId}] Request Body:   `, util_1.default.inspect(JSON.stringify(req.body), { depth: null }));
    console.groupEnd();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        const endTimestamp = new Date(endTime).toISOString();
        const responseBody = body;
        const size = Buffer.byteLength(JSON.stringify(responseBody), 'utf8');
        console.groupCollapsed(`📤 [${requestId}][${endTimestamp}] ${method} ${originalUrl} (${duration}ms ⏱️)`);
        console.log(` [${requestId}] Response Size:    ${size} bytes`);
        console.log(` [${requestId}] Response Headers:`, util_1.default.inspect(JSON.stringify(res.getHeaders()), { depth: null }));
        console.log(` [${requestId}] Response Body:   `, util_1.default.inspect(JSON.stringify(responseBody), { depth: null }));
        console.groupEnd();
        return originalJson(body);
    };
    next();
}
function generateHeaders(body) {
    const date = Date.now().toString();
    const msg = (body !== undefined ? JSON.stringify(body) : '') + date;
    const signatureApiKey = process.env.SIGNATURE_API_KEY || 'secretKey';
    const hmac = crypto_js_1.default.HmacSHA512(msg, signatureApiKey).toString();
    return {
        'x-date': date,
        'x-signature': hmac,
    };
}
function replaceRandomUUID(obj) {
    const newUUID = (0, uuid_1.v4)();
    function recurse(value) {
        if (typeof value === 'string' && value === 'randomUUID') {
            return newUUID;
        }
        else if (Array.isArray(value)) {
            return value.map(recurse);
        }
        else if (value !== null && typeof value === 'object') {
            const result = {};
            for (const [key, val] of Object.entries(value)) {
                result[key] = recurse(val);
            }
            return result;
        }
        return value;
    }
    return recurse(obj);
}
