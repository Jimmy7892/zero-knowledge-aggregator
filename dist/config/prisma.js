"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.testPrismaConnection = exports.closePrismaClient = exports.getPrismaClient = exports.createPrismaClient = void 0;
const client_1 = require("@prisma/client");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const index_1 = require("./index");
const dbLogger = (0, secure_enclave_logger_1.getLogger)('Database');
let prisma = null;
exports.prisma = prisma;
const createPrismaClient = () => {
    if (prisma) {
        return prisma;
    }
    const databaseUrl = index_1.databaseConfig.url;
    const idleTimeout = index_1.databaseConfig.idleTimeoutMillis || 30000;
    const pooledUrl = `${databaseUrl}${databaseUrl?.includes('?') ? '&' : '?'}connection_limit=${index_1.databaseConfig.maxConnections}&pool_timeout=${Math.floor(idleTimeout / 1000)}`;
    dbLogger.info('Initializing Prisma with connection pooling', {
        maxConnections: index_1.databaseConfig.maxConnections,
        poolTimeout: `${index_1.databaseConfig.idleTimeoutMillis}ms`,
    });
    exports.prisma = prisma = new client_1.PrismaClient({
        datasources: {
            db: {
                url: pooledUrl,
            },
        },
        log: [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'info' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
        ],
    });
    prisma.$on('query', (e) => {
        dbLogger.debug('Query executed', {
            query: e.query,
            params: e.params,
            duration: e.duration,
        });
    });
    prisma.$on('info', (e) => {
        dbLogger.info(e.message);
    });
    prisma.$on('warn', (e) => {
        dbLogger.warn(e.message);
    });
    prisma.$on('error', (e) => {
        dbLogger.error('Database error', undefined, { message: e.message, target: e.target });
    });
    return prisma;
};
exports.createPrismaClient = createPrismaClient;
const getPrismaClient = () => {
    if (!prisma) {
        dbLogger.info('Auto-initializing Prisma client...');
        return (0, exports.createPrismaClient)();
    }
    return prisma;
};
exports.getPrismaClient = getPrismaClient;
const closePrismaClient = async () => {
    if (prisma) {
        await prisma.$disconnect();
        exports.prisma = prisma = null;
    }
};
exports.closePrismaClient = closePrismaClient;
const testPrismaConnection = async () => {
    try {
        dbLogger.info('Testing connection to PostgreSQL DB with Prisma...');
        const client = (0, exports.getPrismaClient)();
        await client.$queryRaw `SELECT NOW() as now`;
        dbLogger.info('Database connected successfully with Prisma');
        return true;
    }
    catch (error) {
        const err = error;
        dbLogger.error('Database connection failed', err, {
            errorName: err.name,
            errorMessage: err.message,
        });
        return false;
    }
};
exports.testPrismaConnection = testPrismaConnection;
//# sourceMappingURL=prisma.js.map