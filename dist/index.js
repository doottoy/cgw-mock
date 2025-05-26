"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* External dependencies */
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
/* Internal dependencies */
const redis_1 = require("./redis");
const seed_1 = require("./utility/seed");
const common_1 = require("./utility/common");
const pattern_stubs_1 = require("./utility/pattern-stubs");
/* Route */
const rain_1 = __importDefault(require("./routes/rain"));
const quicko_1 = __importDefault(require("./routes/quicko"));
const exchanger_1 = __importDefault(require("./routes/exchanger"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(common_1.loggingMiddleware);
app.use(exchanger_1.default, rain_1.default, quicko_1.default);
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    try {
        await redis_1.redis.ping();
        console.log('Redis connected');
        await (0, seed_1.seedStubs)();
        await (0, pattern_stubs_1.loadPatternStubs)();
    }
    catch (err) {
        console.error('Redis connection error:', err);
        process.exit(1);
    }
});
