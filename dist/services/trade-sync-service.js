"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeSyncService = void 0;
const tsyringe_1 = require("tsyringe");
const exchange_connection_repository_1 = require("../core/repositories/exchange-connection-repository");
const sync_status_repository_1 = require("../core/repositories/sync-status-repository");
const user_repository_1 = require("../core/repositories/user-repository");
const ExchangeConnectorFactory_1 = require("../external/factories/ExchangeConnectorFactory");
const universal_connector_cache_service_1 = require("../core/services/universal-connector-cache.service");
const encryption_service_1 = require("./encryption-service");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const time_utils_1 = require("../utils/time-utils");
const logger = (0, secure_enclave_logger_1.getLogger)('TradeSyncService');
let TradeSyncService = class TradeSyncService {
    exchangeConnectionRepo;
    syncStatusRepo;
    userRepo;
    connectorCache;
    constructor(exchangeConnectionRepo, syncStatusRepo, userRepo, connectorCache) {
        this.exchangeConnectionRepo = exchangeConnectionRepo;
        this.syncStatusRepo = syncStatusRepo;
        this.userRepo = userRepo;
        this.connectorCache = connectorCache;
    }
    async ensureUser(userUid) {
        try {
            await this.userRepo.createUser({ uid: userUid });
        }
        catch (error) {
            const prismaError = error;
            if (prismaError.code !== 'P2002') {
                throw error;
            }
        }
    }
    async fetchTradeCount(credentials, startDate) {
        const exchange = credentials.exchange.toLowerCase();
        if (!ExchangeConnectorFactory_1.ExchangeConnectorFactory.isSupported(exchange)) {
            throw new Error(`Exchange ${exchange} not supported`);
        }
        const connector = this.connectorCache.getOrCreate(exchange, credentials);
        const endDate = new Date();
        logger.info(`Fetching trades from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        const trades = await connector.getTrades(startDate, endDate);
        return trades.length;
    }
    async testConnectionUnified(credentials) {
        const exchange = credentials.exchange.toLowerCase();
        if (!ExchangeConnectorFactory_1.ExchangeConnectorFactory.isSupported(exchange)) {
            logger.error(`Exchange ${exchange} not supported`);
            return false;
        }
        const connector = this.connectorCache.getOrCreate(exchange, credentials);
        return await connector.testConnection();
    }
    async syncUserTrades(userUid) {
        try {
            await this.ensureUser(userUid);
            const tradeSyncResult = await this.syncTradesForStatistics(userUid);
            return {
                success: tradeSyncResult.success,
                message: `Sync completed: ${tradeSyncResult.synced} trades processed (memory only)`,
                synced: tradeSyncResult.synced,
            };
        }
        catch (error) {
            logger.error(`Sync failed for user ${userUid}`, error);
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            return { success: false, message: `Sync failed: ${errorMessage}`, synced: 0 };
        }
    }
    async syncExchangeTrades(userUid, connectionId) {
        const credentials = await this.exchangeConnectionRepo.getDecryptedCredentials(connectionId);
        if (!credentials) {
            throw new Error('Failed to get exchange credentials');
        }
        await this.syncStatusRepo.upsertSyncStatus({
            userUid,
            exchange: credentials.exchange,
            lastSyncTime: new Date(),
            status: 'syncing',
            totalTrades: 0,
            errorMessage: undefined,
        });
        try {
            const startOfDay = time_utils_1.TimeUtils.getStartOfDayUTC();
            logger.info(`Daily sync for ${credentials.exchange} from ${startOfDay.toISOString()}`);
            const tradeCount = await this.fetchTradeCount(credentials, startOfDay);
            await this.syncStatusRepo.upsertSyncStatus({
                userUid,
                exchange: credentials.exchange,
                lastSyncTime: new Date(),
                status: 'completed',
                totalTrades: tradeCount,
                errorMessage: undefined,
            });
            return tradeCount;
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            await this.syncStatusRepo.upsertSyncStatus({
                userUid,
                exchange: credentials.exchange,
                lastSyncTime: new Date(),
                status: 'error',
                totalTrades: 0,
                errorMessage,
            });
            throw error;
        }
    }
    async syncTradesForStatistics(userUid) {
        try {
            const uniqueConnections = (await this.exchangeConnectionRepo.getUniqueCredentialsForUser(userUid)) ?? [];
            if (uniqueConnections.length === 0) {
                return { success: false, synced: 0, message: 'No active exchange connections found' };
            }
            const totalConnections = (await this.exchangeConnectionRepo.getConnectionsByUser(userUid, true)) ?? [];
            const skippedDuplicates = totalConnections.length - uniqueConnections.length;
            const syncResults = await Promise.allSettled(uniqueConnections.map(connection => this.syncExchangeTrades(userUid, connection.id).catch(error => {
                logger.error(`Failed to sync ${connection.exchange} (${connection.label})`, error);
                return 0;
            })));
            const totalSynced = syncResults.reduce((sum, result) => result.status === 'fulfilled' ? sum + result.value : sum, 0);
            return {
                success: true,
                synced: totalSynced,
                message: `Processed ${totalSynced} trades from ${uniqueConnections.length} exchanges (${skippedDuplicates} duplicates skipped)`,
            };
        }
        catch (error) {
            logger.error(`Sync failed for user ${userUid}`, error);
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            return { success: false, synced: 0, message: `Sync failed: ${errorMessage}` };
        }
    }
    async syncAllUsers() {
        try {
            const pendingSyncs = await this.syncStatusRepo.getAllSyncStatuses();
            for (const syncStatus of pendingSyncs) {
                try {
                    await this.syncUserTrades(syncStatus.userUid);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                catch (error) {
                    logger.error(`Failed to sync user ${syncStatus.userUid}`, error);
                }
            }
        }
        catch (error) {
            logger.error('Failed to sync all users', error);
        }
    }
    async addExchangeConnection(userUid, exchange, label, apiKey, apiSecret, passphrase) {
        try {
            await this.ensureUser(userUid);
            const existingConnection = await this.exchangeConnectionRepo.findExistingConnection(userUid, exchange, label);
            if (existingConnection) {
                return {
                    success: false,
                    message: `Connection for ${exchange} with label "${label}" already exists`,
                };
            }
            const credentialsHash = encryption_service_1.EncryptionService.createCredentialsHash(apiKey, apiSecret, passphrase);
            const sameCredentialsConnections = await this.exchangeConnectionRepo.getConnectionsByCredentialsHash(userUid, credentialsHash);
            if (sameCredentialsConnections.length > 0) {
                const existingLabels = sameCredentialsConnections.map(conn => conn.label).join(', ');
                logger.warn(`Adding duplicate credentials for ${exchange}`, { existingConnections: existingLabels });
            }
            const testCredentials = { userUid, exchange, label, apiKey, apiSecret, passphrase };
            const isValid = await this.testConnectionUnified(testCredentials);
            if (!isValid) {
                const needsPassphrase = ['bitget', 'coinbase', 'okx', 'kucoin'].includes(exchange);
                return {
                    success: false,
                    message: `Invalid API credentials for ${exchange}${needsPassphrase ? ' - verify passphrase' : ''}`,
                };
            }
            const connection = await this.exchangeConnectionRepo.createConnection(testCredentials);
            await this.syncStatusRepo.upsertSyncStatus({
                userUid,
                exchange,
                lastSyncTime: undefined,
                status: 'pending',
                totalTrades: 0,
                errorMessage: undefined,
            });
            return {
                success: true,
                message: 'Exchange connection added - snapshots will be created automatically',
                connectionId: connection.id,
            };
        }
        catch (error) {
            logger.error('Failed to add exchange connection', error);
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            if (errorMessage.includes('UNIQUE constraint failed')) {
                return {
                    success: false,
                    message: `Connection for ${exchange} with label "${label}" already exists`,
                };
            }
            return { success: false, message: `Failed to add connection: ${errorMessage}` };
        }
    }
};
exports.TradeSyncService = TradeSyncService;
exports.TradeSyncService = TradeSyncService = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)(exchange_connection_repository_1.ExchangeConnectionRepository)),
    __param(1, (0, tsyringe_1.inject)(sync_status_repository_1.SyncStatusRepository)),
    __param(2, (0, tsyringe_1.inject)(user_repository_1.UserRepository)),
    __param(3, (0, tsyringe_1.inject)(universal_connector_cache_service_1.UniversalConnectorCacheService)),
    __metadata("design:paramtypes", [exchange_connection_repository_1.ExchangeConnectionRepository,
        sync_status_repository_1.SyncStatusRepository,
        user_repository_1.UserRepository,
        universal_connector_cache_service_1.UniversalConnectorCacheService])
], TradeSyncService);
//# sourceMappingURL=trade-sync-service.js.map