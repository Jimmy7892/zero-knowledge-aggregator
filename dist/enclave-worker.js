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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnclaveWorker = void 0;
const tsyringe_1 = require("tsyringe");
const trade_sync_service_1 = require("./services/trade-sync-service");
const equity_snapshot_aggregator_1 = require("./services/equity-snapshot-aggregator");
const snapshot_data_repository_1 = require("./core/repositories/snapshot-data-repository");
const exchange_connection_repository_1 = require("./core/repositories/exchange-connection-repository");
const sync_status_repository_1 = require("./core/repositories/sync-status-repository");
const user_repository_1 = require("./core/repositories/user-repository");
const secure_enclave_logger_1 = require("./utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('EnclaveWorker');
let EnclaveWorker = class EnclaveWorker {
    tradeSyncService;
    equitySnapshotAggregator;
    snapshotDataRepo;
    exchangeConnectionRepo;
    syncStatusRepo;
    userRepo;
    constructor(tradeSyncService, equitySnapshotAggregator, snapshotDataRepo, exchangeConnectionRepo, syncStatusRepo, userRepo) {
        this.tradeSyncService = tradeSyncService;
        this.equitySnapshotAggregator = equitySnapshotAggregator;
        this.snapshotDataRepo = snapshotDataRepo;
        this.exchangeConnectionRepo = exchangeConnectionRepo;
        this.syncStatusRepo = syncStatusRepo;
        this.userRepo = userRepo;
    }
    async processSyncJob(request) {
        const startTime = Date.now();
        const { userUid, exchange } = request;
        try {
            logger.info('Processing sync job request', { userUid, exchange });
            const blockError = await this.checkManualSyncAllowed(userUid, exchange);
            if (blockError) {
                logger.warn('Manual sync blocked - automatic snapshots already initialized', { userUid, exchange });
                return blockError;
            }
            const syncResult = await this.tradeSyncService.syncUserTrades(userUid);
            if (!syncResult.success) {
                logger.error('Trade sync failed', { userUid, exchange, message: syncResult.message });
                return this.buildErrorResponse(userUid, exchange, syncResult.message);
            }
            const { snapshotsCount, latestSnapshot } = await this.updateSnapshotsForExchanges(userUid, exchange);
            return this.buildSuccessResponse({
                userUid,
                exchange,
                synced: syncResult.synced,
                snapshotsCount,
                latestSnapshot,
                duration: Date.now() - startTime
            });
        }
        catch (error) {
            return this.handleSyncError(error, userUid, exchange);
        }
    }
    async checkManualSyncAllowed(userUid, exchange) {
        const connectionsResult = await this.exchangeConnectionRepo.getConnectionsByUser(userUid, true);
        const exchanges = exchange
            ? [exchange]
            : (connectionsResult ?? []).map(conn => conn.exchange);
        for (const ex of exchanges) {
            const existingSnapshot = await this.snapshotDataRepo.getLatestSnapshotData(userUid, ex);
            if (existingSnapshot) {
                const lastSnapshotTime = new Date(existingSnapshot.timestamp).toISOString();
                logger.warn('Manual sync blocked - automatic snapshots already initialized', {
                    userUid,
                    exchange: ex,
                    latestSnapshot: lastSnapshotTime
                });
                return {
                    success: false,
                    userUid,
                    exchange: ex,
                    synced: 0,
                    snapshotsGenerated: 0,
                    error: `Manual sync disabled for ${ex}. Automatic daily snapshots are active (last snapshot: ${lastSnapshotTime}). All subsequent snapshots are created automatically at 00:00 UTC.`
                };
            }
        }
        return null;
    }
    async updateSnapshotsForExchanges(userUid, exchange) {
        let snapshotsCount = 0;
        let latestSnapshot = null;
        const exchanges = exchange
            ? [exchange]
            : ((await this.exchangeConnectionRepo.getConnectionsByUser(userUid, true)) ?? [])
                .map(conn => conn.exchange);
        for (const ex of exchanges) {
            try {
                if (ex.toLowerCase() === 'ibkr') {
                    const existingSnapshots = await this.snapshotDataRepo.getSnapshotData(userUid, undefined, undefined, ex);
                    const snapshotCount = existingSnapshots?.length || 0;
                    if (snapshotCount === 0) {
                        logger.info(`IBKR first sync: running historical backfill from Flex data`, {
                            userUid, exchange: ex
                        });
                        await this.equitySnapshotAggregator.backfillIbkrHistoricalSnapshots(userUid, ex);
                        const newSnapshots = await this.snapshotDataRepo.getSnapshotData(userUid, undefined, undefined, ex);
                        snapshotsCount += newSnapshots?.length || 0;
                    }
                }
                await this.equitySnapshotAggregator.updateCurrentSnapshot(userUid, ex);
                snapshotsCount += 1;
                const snapshot = await this.snapshotDataRepo.getLatestSnapshotData(userUid, ex);
                if (snapshot && (!latestSnapshot || new Date(snapshot.timestamp) > new Date(latestSnapshot.timestamp))) {
                    latestSnapshot = snapshot;
                }
                logger.info(`Snapshot updated for ${userUid}/${ex}`, { snapshotsCount });
            }
            catch (error) {
                const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
                logger.error(`Failed to update snapshot for ${userUid}/${ex}`, {
                    error: errorMessage
                });
            }
        }
        return { snapshotsCount, latestSnapshot };
    }
    buildSuccessResponse(params) {
        const { userUid, exchange, synced, snapshotsCount, latestSnapshot, duration } = params;
        logger.info('Enclave sync job completed', {
            userUid, synced, snapshotsGenerated: snapshotsCount, duration
        });
        return {
            success: true,
            userUid,
            exchange,
            synced: synced || 0,
            snapshotsGenerated: snapshotsCount,
            latestSnapshot: latestSnapshot ? {
                balance: latestSnapshot.realizedBalance,
                equity: latestSnapshot.totalEquity,
                timestamp: new Date(latestSnapshot.timestamp)
            } : undefined
        };
    }
    buildErrorResponse(userUid, exchange, error) {
        return {
            success: false,
            userUid,
            exchange,
            synced: 0,
            snapshotsGenerated: 0,
            error
        };
    }
    handleSyncError(error, userUid, exchange) {
        const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
        const errorStack = error instanceof Error ? error.stack || 'No stack trace available' : 'No stack trace available';
        const errorName = error instanceof Error ? error.name : 'Error';
        logger.error('Enclave sync job failed', {
            userUid,
            exchange,
            errorMessage,
            errorName,
            errorStack,
            errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
        return this.buildErrorResponse(userUid, exchange, errorMessage);
    }
    async getAggregatedMetrics(userUid, exchange) {
        const exchanges = exchange
            ? [exchange]
            : ((await this.exchangeConnectionRepo.getConnectionsByUser(userUid, true)) ?? [])
                .map(conn => conn.exchange);
        let totalBalance = 0;
        let totalEquity = 0;
        let totalRealizedPnl = 0;
        let totalUnrealizedPnl = 0;
        let totalFees = 0;
        let totalTrades = 0;
        let lastSync = null;
        for (const ex of exchanges) {
            const snapshot = await this.snapshotDataRepo.getLatestSnapshotData(userUid, ex);
            if (snapshot) {
                totalBalance += snapshot.realizedBalance;
                totalEquity += snapshot.totalEquity;
                totalRealizedPnl += 0;
                totalUnrealizedPnl += snapshot.unrealizedPnL;
                totalFees += 0;
                const snapshotDate = new Date(snapshot.timestamp);
                if (!lastSync || snapshotDate > lastSync) {
                    lastSync = snapshotDate;
                }
            }
            const syncStatus = await this.syncStatusRepo.getSyncStatus(userUid, ex);
            totalTrades += syncStatus?.totalTrades || 0;
        }
        return {
            totalBalance,
            totalEquity,
            totalRealizedPnl,
            totalUnrealizedPnl,
            totalFees,
            totalTrades,
            lastSync
        };
    }
    async getSnapshotTimeSeries(userUid, exchange, startDate, endDate) {
        try {
            logger.info('Getting snapshot time series', {
                userUid,
                exchange,
                startDate: startDate?.toISOString(),
                endDate: endDate?.toISOString()
            });
            const snapshots = await this.snapshotDataRepo.getSnapshotData(userUid, startDate, endDate, exchange) ?? [];
            return snapshots.map(snapshot => {
                let breakdown = undefined;
                if (snapshot.breakdown_by_market) {
                    try {
                        breakdown = typeof snapshot.breakdown_by_market === 'string'
                            ? JSON.parse(snapshot.breakdown_by_market)
                            : snapshot.breakdown_by_market;
                    }
                    catch {
                        breakdown = undefined;
                    }
                }
                return {
                    userUid: snapshot.userUid,
                    exchange: snapshot.exchange,
                    timestamp: new Date(snapshot.timestamp),
                    totalEquity: snapshot.totalEquity,
                    realizedBalance: snapshot.realizedBalance,
                    unrealizedPnL: snapshot.unrealizedPnL,
                    deposits: snapshot.deposits,
                    withdrawals: snapshot.withdrawals,
                    breakdown: breakdown
                };
            });
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to get snapshot time series', {
                userUid,
                exchange,
                error: errorMessage
            });
            throw error;
        }
    }
    async createUserConnection(request) {
        try {
            const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
            const credentialsString = `${request.exchange}:${request.apiKey}:${request.apiSecret}:${request.passphrase || ''}`;
            const hash = crypto.createHash('sha256').update(credentialsString).digest('hex');
            const timeLow = hash.substring(0, 8);
            const timeMid = hash.substring(8, 12);
            const timeHiAndVersion = '4' + hash.substring(13, 16);
            const clockSeqAndReserved = (parseInt(hash.substring(16, 18), 16) & 0x3F | 0x80).toString(16).padStart(2, '0') + hash.substring(18, 20);
            const node = hash.substring(20, 32);
            const userUid = `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeqAndReserved}-${node}`;
            logger.info('Creating user with deterministic UID from credentials');
            await this.userRepo.createUser({ uid: userUid });
            const existingConnection = await this.exchangeConnectionRepo.findExistingConnection(userUid, request.exchange, request.label);
            if (existingConnection) {
                logger.warn('User and exchange connection already exist - skipping creation', {
                    userUid,
                    exchange: request.exchange,
                    label: request.label
                });
                return {
                    success: true,
                    userUid,
                    error: 'User connection already exists (no action taken)'
                };
            }
            await this.exchangeConnectionRepo.createConnection({
                userUid,
                exchange: request.exchange,
                label: request.label,
                apiKey: request.apiKey,
                apiSecret: request.apiSecret,
                passphrase: request.passphrase,
                isActive: true
            });
            logger.info('User and exchange connection created successfully');
            return {
                success: true,
                userUid
            };
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error('Failed to create user connection', {
                error: errorMessage,
                stack: errorStack
            });
            return {
                success: false,
                error: errorMessage || 'Failed to create user connection'
            };
        }
    }
    async healthCheck() {
        try {
            await this.snapshotDataRepo.countSnapshots();
            return {
                status: 'healthy',
                enclave: true,
                version: '1.0.0',
                uptime: process.uptime()
            };
        }
        catch (error) {
            return {
                status: 'unhealthy',
                enclave: true,
                version: '1.0.0',
                uptime: process.uptime()
            };
        }
    }
};
exports.EnclaveWorker = EnclaveWorker;
exports.EnclaveWorker = EnclaveWorker = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)(trade_sync_service_1.TradeSyncService)),
    __param(1, (0, tsyringe_1.inject)(equity_snapshot_aggregator_1.EquitySnapshotAggregator)),
    __param(2, (0, tsyringe_1.inject)(snapshot_data_repository_1.SnapshotDataRepository)),
    __param(3, (0, tsyringe_1.inject)(exchange_connection_repository_1.ExchangeConnectionRepository)),
    __param(4, (0, tsyringe_1.inject)(sync_status_repository_1.SyncStatusRepository)),
    __param(5, (0, tsyringe_1.inject)(user_repository_1.UserRepository)),
    __metadata("design:paramtypes", [trade_sync_service_1.TradeSyncService,
        equity_snapshot_aggregator_1.EquitySnapshotAggregator,
        snapshot_data_repository_1.SnapshotDataRepository,
        exchange_connection_repository_1.ExchangeConnectionRepository,
        sync_status_repository_1.SyncStatusRepository,
        user_repository_1.UserRepository])
], EnclaveWorker);
exports.default = EnclaveWorker;
//# sourceMappingURL=enclave-worker.js.map