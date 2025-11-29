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
exports.DailySyncSchedulerService = void 0;
const tsyringe_1 = require("tsyringe");
const cron = __importStar(require("node-cron"));
const user_repository_1 = require("../core/repositories/user-repository");
const exchange_connection_repository_1 = require("../core/repositories/exchange-connection-repository");
const equity_snapshot_aggregator_1 = require("./equity-snapshot-aggregator");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('DailySyncScheduler');
let DailySyncSchedulerService = class DailySyncSchedulerService {
    userRepo;
    exchangeConnectionRepo;
    snapshotAggregator;
    cronJob = null;
    isRunning = false;
    constructor(userRepo, exchangeConnectionRepo, snapshotAggregator) {
        this.userRepo = userRepo;
        this.exchangeConnectionRepo = exchangeConnectionRepo;
        this.snapshotAggregator = snapshotAggregator;
    }
    start() {
        if (this.cronJob) {
            logger.warn('Daily sync scheduler already running');
            return;
        }
        this.cronJob = cron.schedule('0 0 * * *', async () => {
            await this.executeDailySync();
        }, {
            timezone: 'UTC',
        });
        logger.info('Daily sync scheduler STARTED (executes at 00:00 UTC)');
        logger.info('Next sync at: ' + this.getNextSyncTime().toISOString());
    }
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Daily sync scheduler STOPPED');
        }
    }
    async executeDailySync() {
        if (this.isRunning) {
            logger.warn('Daily sync already in progress, skipping...');
            return;
        }
        this.isRunning = true;
        const startTime = Date.now();
        logger.info('Daily sync started', {
            timestamp: new Date().toISOString(),
            mode: 'enclave_attested'
        });
        try {
            const users = await this.userRepo.getAllUsers();
            logger.info(`Found ${users.length} total users in database`);
            let totalSynced = 0;
            let totalFailed = 0;
            for (const user of users) {
                try {
                    const connections = await this.exchangeConnectionRepo.getConnectionsByUser(user.uid, true);
                    if (connections.length === 0) {
                        logger.info(`User ${user.uid}: No active exchange connections, skipping`);
                        continue;
                    }
                    logger.info(`User ${user.uid}: Found ${connections.length} active exchange(s)`);
                    for (const connection of connections) {
                        try {
                            await this.snapshotAggregator.updateCurrentSnapshot(user.uid, connection.exchange);
                            logger.info(`User ${user.uid}/${connection.exchange}: Snapshot created successfully`);
                            totalSynced++;
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                        catch (error) {
                            logger.error(`User ${user.uid}/${connection.exchange}: Snapshot creation failed`, error);
                            totalFailed++;
                        }
                    }
                }
                catch (error) {
                    logger.error(`User ${user.uid}: Failed to process user`, error);
                    totalFailed++;
                }
            }
            const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info('Daily sync completed', {
                snapshots_created: totalSynced,
                failed: totalFailed,
                duration_sec: durationSec,
                completed_at: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error('DAILY SYNC FAILED', error);
        }
        finally {
            this.isRunning = false;
        }
    }
    async triggerManualSync() {
        logger.warn('MANUAL SYNC TRIGGERED (bypassing scheduler)');
        await this.executeDailySync();
    }
    getNextSyncTime() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        return tomorrow;
    }
    getStatus() {
        return {
            isRunning: this.cronJob !== null,
            syncInProgress: this.isRunning,
            nextSyncTime: this.getNextSyncTime(),
        };
    }
};
exports.DailySyncSchedulerService = DailySyncSchedulerService;
exports.DailySyncSchedulerService = DailySyncSchedulerService = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)(user_repository_1.UserRepository)),
    __param(1, (0, tsyringe_1.inject)(exchange_connection_repository_1.ExchangeConnectionRepository)),
    __param(2, (0, tsyringe_1.inject)(equity_snapshot_aggregator_1.EquitySnapshotAggregator)),
    __metadata("design:paramtypes", [user_repository_1.UserRepository,
        exchange_connection_repository_1.ExchangeConnectionRepository,
        equity_snapshot_aggregator_1.EquitySnapshotAggregator])
], DailySyncSchedulerService);
//# sourceMappingURL=daily-sync-scheduler.service.js.map