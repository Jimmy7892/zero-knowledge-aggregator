"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const enclave_container_1 = require("./config/enclave-container");
const enclave_server_1 = require("./enclave-server");
const prisma_1 = require("./config/prisma");
const secure_enclave_logger_1 = require("./utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('Main');
const memory_protection_service_1 = require("./services/memory-protection.service");
const startEnclave = async () => {
    try {
        logger.info('🔒 Starting Enclave Worker (Trusted Zone - SEV-SNP)', {
            version: '3.0.0-enclave',
            environment: process.env.NODE_ENV,
            tcb: '4,572 LOC',
            isolation: 'AMD SEV-SNP',
        });
        await memory_protection_service_1.MemoryProtectionService.initialize();
        const memStatus = memory_protection_service_1.MemoryProtectionService.getStatus();
        logger.info('[ENCLAVE] Memory protection status:', memStatus);
        const recommendations = memory_protection_service_1.MemoryProtectionService.getProductionRecommendations();
        if (recommendations.length > 0 && process.env.NODE_ENV === 'production') {
            logger.warn('[ENCLAVE] ⚠ PRODUCTION SECURITY RECOMMENDATIONS:');
            recommendations.forEach(rec => logger.warn(`  - ${rec}`));
        }
        logger.info('[ENCLAVE] Initializing DI container...');
        (0, enclave_container_1.setupEnclaveContainer)();
        logger.info('[ENCLAVE] DI container initialized');
        logger.info('[ENCLAVE] Performing hardware attestation...');
        const attestationResult = await (0, enclave_container_1.verifyEnclaveIsolation)();
        if (!attestationResult.verified) {
            logger.warn('[ENCLAVE] WARNING: Attestation not verified');
            logger.warn(`[ENCLAVE] ${attestationResult.errorMessage}`);
            if (process.env.NODE_ENV === 'production') {
                logger.error('[ENCLAVE] ABORTING: Cannot run in production without attestation');
                process.exit(1);
            }
        }
        logger.info('[ENCLAVE] Connecting to database with full permissions...');
        const prisma = (0, prisma_1.getPrismaClient)();
        try {
            await prisma.$queryRaw `SELECT 1`;
            logger.info('[ENCLAVE] Database connection established');
            const snapshotCount = await prisma.snapshotData.count();
            logger.info('[ENCLAVE] Verified database access', {
                snapshotCount,
                accessLevel: 'AGGREGATED_ONLY',
            });
        }
        catch (error) {
            logger.error('[ENCLAVE] Database connection failed', error);
            process.exit(1);
        }
        logger.info('[ENCLAVE] Security status:', {
            tradesStorage: '❌ DISABLED (memory only - alpha protection)',
            snapshotsAccess: '✅ ALLOWED (aggregated data)',
            credentialsAccess: '✅ ALLOWED (decrypted in-memory)',
            outputRestriction: 'Aggregated snapshots only',
        });
        logger.info('[ENCLAVE] Starting gRPC server...');
        const enclaveServer = await (0, enclave_server_1.startEnclaveServer)();
        logger.info('[ENCLAVE] Starting HTTP log server for SSE streaming...');
        const { startHttpLogServer } = await Promise.resolve().then(() => __importStar(require('./http-log-server')));
        const { registerSSEBroadcast } = await Promise.resolve().then(() => __importStar(require('./utils/secure-enclave-logger')));
        const httpLogServer = await startHttpLogServer();
        registerSSEBroadcast((log) => httpLogServer.broadcastLog(log));
        logger.info('[ENCLAVE] HTTP log server started with SSE streaming');
        const { container: diContainer } = await Promise.resolve().then(() => __importStar(require('tsyringe')));
        if (process.env.METRICS_ENABLED === 'true') {
            logger.info('[ENCLAVE] Starting Prometheus metrics server...');
            const { metricsService } = await Promise.resolve().then(() => __importStar(require('./services/metrics.service')));
            const metricsPort = parseInt(process.env.METRICS_PORT || '9090', 10);
            metricsService.startMetricsServer(metricsPort);
            logger.info('[ENCLAVE] Prometheus metrics available', {
                endpoint: `http://localhost:${metricsPort}/metrics`,
                port: metricsPort
            });
            const { ExchangeConnectionRepository } = await Promise.resolve().then(() => __importStar(require('./core/repositories/exchange-connection-repository')));
            const connectionRepo = diContainer.resolve(ExchangeConnectionRepository);
            metricsService.registerCollector(async () => {
                const count = await connectionRepo.countAllActiveConnections();
                metricsService.setGauge('exchange_connections_total', count);
            });
            logger.info('[ENCLAVE] Business metrics collectors registered');
        }
        else {
            logger.info('[ENCLAVE] Metrics server disabled (METRICS_ENABLED=false)');
        }
        logger.info('[ENCLAVE] Starting daily sync scheduler...');
        const { DailySyncSchedulerService } = await Promise.resolve().then(() => __importStar(require('./services/daily-sync-scheduler.service')));
        const scheduler = diContainer.resolve(DailySyncSchedulerService);
        scheduler.start();
        const schedulerStatus = scheduler.getStatus();
        logger.info('[ENCLAVE] Daily sync scheduler started', {
            nextSync: schedulerStatus.nextSyncTime.toISOString(),
            timezone: 'UTC',
            schedule: '00:00 UTC daily',
            auditProof: 'Rate-limited (23h cooldown)'
        });
        logger.info('[ENCLAVE] Enclave Worker ready to process sync jobs', {
            protocol: 'gRPC',
            port: process.env.ENCLAVE_PORT || 50051,
            tls: 'MANDATORY (mutual TLS)',
            attestation: attestationResult.verified ? 'VERIFIED' : 'DEV MODE',
            measurement: attestationResult.measurement || 'N/A',
            autoSync: 'ENABLED (00:00 UTC daily)'
        });
        const gracefulShutdown = async (signal) => {
            logger.info(`[ENCLAVE] Received ${signal}, shutting down...`);
            const shutdownTimeout = setTimeout(() => {
                logger.error('[ENCLAVE] Shutdown timeout, forcing exit...');
                process.exit(1);
            }, 30000);
            try {
                scheduler.stop();
                await httpLogServer.stop();
                if (process.env.METRICS_ENABLED === 'true') {
                    const { metricsService } = await Promise.resolve().then(() => __importStar(require('./services/metrics.service')));
                    metricsService.stopMetricsServer();
                }
                await enclaveServer.stop();
                await prisma.$disconnect();
                clearTimeout(shutdownTimeout);
                logger.info('[ENCLAVE] Graceful shutdown completed');
                process.exit(0);
            }
            catch (error) {
                logger.error('[ENCLAVE] Error during cleanup', error);
                clearTimeout(shutdownTimeout);
                process.exit(1);
            }
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('unhandledRejection', (reason) => {
            logger.error('[ENCLAVE] Unhandled Rejection:', reason);
            process.exit(1);
        });
        process.on('uncaughtException', (error) => {
            logger.error('[ENCLAVE] Uncaught Exception:', error);
            process.exit(1);
        });
    }
    catch (error) {
        logger.error('[ENCLAVE] Failed to start', error);
        process.exit(1);
    }
};
startEnclave();
//# sourceMappingURL=index.js.map