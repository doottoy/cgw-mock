import { Router } from 'express';
import { attachCommonRoutes } from './common-routes';

const router = Router();
attachCommonRoutes(router, '/exchanger');

export default router;
