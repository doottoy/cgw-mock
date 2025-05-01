import dotenv from 'dotenv';
import express from 'express';

import { redis } from './redis';
import exchangeRoute from './routes/exchange';

dotenv.config();

const app = express();
app.use(express.json());

app.use(exchangeRoute);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    try {
        await redis.ping();
        console.log('Redis connected');
    } catch (err) {
        console.error('Redis connection error:', err);
        process.exit(1);
    }
});
