"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTest = exports.isProduction = exports.isDevelopment = exports.databaseConfig = exports.serverConfig = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
dotenv_1.default.config();
const logger = (0, secure_enclave_logger_1.getLogger)('Config');
const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    logger.error('FATAL: Missing required environment variables', undefined, {
        missing_vars: missingVars,
        required_vars: requiredEnvVars
    });
    logger.error('Please configure all required environment variables before starting the service');
    process.exit(1);
}
const parseCorsOrigin = (origin) => {
    if (!origin) {
        return 'http://localhost:3000';
    }
    const origins = origin.split(',').map(o => o.trim());
    return origins.length === 1 ? origins[0] : origins;
};
exports.serverConfig = {
    port: parseInt(process.env.PORT || '3005', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
    jwtSecret: process.env.JWT_SECRET,
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS || '30', 10),
};
exports.databaseConfig = {
    url: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '50', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
};
exports.isDevelopment = exports.serverConfig.nodeEnv === 'development';
exports.isProduction = exports.serverConfig.nodeEnv === 'production';
exports.isTest = exports.serverConfig.nodeEnv === 'test';
//# sourceMappingURL=index.js.map