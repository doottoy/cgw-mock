"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const common_routes_1 = require("./common-routes");
const router = (0, express_1.Router)();
(0, common_routes_1.attachCommonRoutes)(router, '/rain');
exports.default = router;
