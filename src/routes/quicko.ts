import { Router } from 'express';

import { attachCommonRoutes } from './common-routes'

const router = Router();
attachCommonRoutes(router, '/quicko')

export default router
