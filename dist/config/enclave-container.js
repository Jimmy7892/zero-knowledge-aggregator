"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupEnclaveContainer = setupEnclaveContainer;
exports.getEnclaveContainer = getEnclaveContainer;
exports.clearEnclaveContainer = clearEnclaveContainer;
exports.verifyEnclaveIsolation = verifyEnclaveIsolation;
require("reflect-metadata");
const tsyringe_1 = require("tsyringe");
const encryption_service_1 = require("../services/encryption-service");
const trade_sync_service_1 = require("../services/trade-sync-service");
const equity_snapshot_aggregator_1 = require("../services/equity-snapshot-aggregator");
const sync_rate_limiter_service_1 = require("../services/sync-rate-limiter.service");
const daily_sync_scheduler_service_1 = require("../services/daily-sync-scheduler.service");
const sev_snp_attestation_service_1 = require("../services/sev-snp-attestation.service");
const ibkr_flex_service_1 = require("../external/ibkr-flex-service");
const alpaca_api_service_1 = require("../external/alpaca-api-service");
const snapshot_data_repository_1 = require("../core/repositories/snapshot-data-repository");
const exchange_connection_repository_1 = require("../core/repositories/exchange-connection-repository");
const sync_status_repository_1 = require("../core/repositories/sync-status-repository");
const user_repository_1 = require("../core/repositories/user-repository");
const enclave_worker_1 = require("../enclave-worker");
const prisma_1 = require("./prisma");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('EnclaveContainer');
function setupEnclaveContainer() {
    tsyringe_1.container.register('PrismaClient', {
        useFactory: () => {
            return (0, prisma_1.getPrismaClient)();
        }
    });
    tsyringe_1.container.registerSingleton(snapshot_data_repository_1.SnapshotDataRepository);
    tsyringe_1.container.registerSingleton(exchange_connection_repository_1.ExchangeConnectionRepository);
    tsyringe_1.container.registerSingleton(sync_status_repository_1.SyncStatusRepository);
    tsyringe_1.container.registerSingleton(user_repository_1.UserRepository);
    tsyringe_1.container.registerSingleton(ibkr_flex_service_1.IbkrFlexService);
    tsyringe_1.container.registerSingleton(alpaca_api_service_1.AlpacaApiService);
    tsyringe_1.container.registerSingleton(encryption_service_1.EncryptionService);
    tsyringe_1.container.registerSingleton(equity_snapshot_aggregator_1.EquitySnapshotAggregator);
    tsyringe_1.container.registerSingleton(trade_sync_service_1.TradeSyncService);
    tsyringe_1.container.registerSingleton(sync_rate_limiter_service_1.SyncRateLimiterService);
    tsyringe_1.container.registerSingleton(daily_sync_scheduler_service_1.DailySyncSchedulerService);
    tsyringe_1.container.registerSingleton(sev_snp_attestation_service_1.SevSnpAttestationService);
    tsyringe_1.container.registerSingleton(enclave_worker_1.EnclaveWorker);
    logger.info('Dependency injection container configured', {
        access_level: 'SENSITIVE',
        capabilities: ['snapshots', 'credentials', 'encryption'],
        security: 'trades_memory_only'
    });
}
function getEnclaveContainer() {
    return tsyringe_1.container;
}
function clearEnclaveContainer() {
    tsyringe_1.container.clearInstances();
}
async function verifyEnclaveIsolation() {
    const attestationService = tsyringe_1.container.resolve(sev_snp_attestation_service_1.SevSnpAttestationService);
    logger.info('Performing AMD SEV-SNP attestation');
    const attestationResult = await attestationService.getAttestationReport();
    if (attestationResult.verified) {
        logger.info('AMD SEV-SNP attestation SUCCESSFUL', {
            hardware_isolation: 'VERIFIED',
            tcb_measurement: attestationResult.measurement,
            platform_version: attestationResult.platformVersion,
            sev_snp_enabled: attestationResult.sevSnpEnabled
        });
    }
    else {
        logger.error('AMD SEV-SNP attestation FAILED', undefined, {
            error_message: attestationResult.errorMessage,
            sev_snp_enabled: attestationResult.sevSnpEnabled
        });
        if (process.env.ENCLAVE_MODE === 'true') {
            logger.error('ENCLAVE_MODE=true but attestation failed - security compromise or misconfiguration');
            if (process.env.NODE_ENV === 'production') {
                throw new Error('CRITICAL: Enclave attestation failed in production mode');
            }
        }
        else {
            logger.warn('Running in DEVELOPMENT mode (no attestation required)', {
                recommendation: 'For production, deploy to AMD SEV-SNP capable hardware'
            });
        }
    }
    return {
        verified: attestationResult.verified,
        sevSnpEnabled: attestationResult.sevSnpEnabled,
        measurement: attestationResult.measurement,
        errorMessage: attestationResult.errorMessage
    };
}
exports.default = setupEnclaveContainer;
//# sourceMappingURL=enclave-container.js.map