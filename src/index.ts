/* External dependencies */
import dotenv from 'dotenv';
import express from 'express';

/* Internal dependencies */
import { redis } from './redis';
import { seedStubs } from './utility/seed';
import { loggingMiddleware } from './utility/common';
import { loadPatternStubs } from './utility/pattern-stubs';

/* Route */
import rainRoute from './routes/rain';
import quickoRoute from './routes/quicko';
import exchangeRoute from './routes/exchanger';

dotenv.config();

const app = express();
app.use(express.json());
app.use(loggingMiddleware);
app.use(exchangeRoute, rainRoute, quickoRoute);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    try {
        await redis.ping();
        console.log('Redis connected');
        await seedStubs();
        await loadPatternStubs();
    } catch (err) {
        console.error('Redis connection error:', err);
        process.exit(1);
    }
});
