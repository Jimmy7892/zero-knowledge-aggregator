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
exports.SyncRateLimiterService = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('SyncRateLimiter');
let SyncRateLimiterService = class SyncRateLimiterService {
    prisma;
    RATE_LIMIT_HOURS = 23;
    LOG_RETENTION_DAYS = 7;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async checkRateLimit(userUid, exchange) {
        try {
            const lastSync = await this.prisma.syncRateLimitLog.findUnique({
                where: {
                    userUid_exchange: {
                        userUid,
                        exchange,
                    },
                },
            });
            if (!lastSync) {
                logger.info(`Rate limit check PASSED for ${userUid}/${exchange} (first sync)`);
                return { allowed: true };
            }
            const now = new Date();
            const timeSinceLastSync = now.getTime() - lastSync.lastSyncTime.getTime();
            const hoursSinceLastSync = timeSinceLastSync / (1000 * 60 * 60);
            if (hoursSinceLastSync >= this.RATE_LIMIT_HOURS) {
                logger.info(`Rate limit check PASSED for ${userUid}/${exchange} (${hoursSinceLastSync.toFixed(1)}h since last sync)`);
                return { allowed: true };
            }
            const nextAllowedTime = new Date(lastSync.lastSyncTime.getTime() + (this.RATE_LIMIT_HOURS * 60 * 60 * 1000));
            const hoursRemaining = (this.RATE_LIMIT_HOURS - hoursSinceLastSync).toFixed(1);
            const reason = `Rate limit exceeded. Last sync was ${hoursSinceLastSync.toFixed(1)}h ago. Please wait ${hoursRemaining}h before next sync. Next allowed time: ${nextAllowedTime.toISOString()}`;
            logger.warn(`Rate limit check FAILED for ${userUid}/${exchange}: ${reason}`);
            return {
                allowed: false,
                reason,
                nextAllowedTime,
            };
        }
        catch (error) {
            logger.error(`Rate limit check error for ${userUid}/${exchange}`, error);
            return { allowed: true };
        }
    }
    async recordSync(userUid, exchange) {
        try {
            await this.prisma.syncRateLimitLog.upsert({
                where: {
                    userUid_exchange: {
                        userUid,
                        exchange,
                    },
                },
                update: {
                    lastSyncTime: new Date(),
                    syncCount: { increment: 1 },
                },
                create: {
                    userUid,
                    exchange,
                    lastSyncTime: new Date(),
                    syncCount: 1,
                },
            });
            logger.info(`Recorded sync for ${userUid}/${exchange}`);
        }
        catch (error) {
            logger.error(`Failed to record sync for ${userUid}/${exchange}`, error);
        }
    }
    async cleanupOldLogs() {
        try {
            const cutoffDate = new Date(Date.now() - (this.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000));
            const result = await this.prisma.syncRateLimitLog.deleteMany({
                where: {
                    lastSyncTime: {
                        lt: cutoffDate,
                    },
                },
            });
            if (result.count > 0) {
                logger.info(`Cleaned up ${result.count} old rate limit logs (older than ${this.LOG_RETENTION_DAYS} days)`);
            }
            return result.count;
        }
        catch (error) {
            logger.error('Failed to clean up old rate limit logs', error);
            return 0;
        }
    }
    async getUserRateLimitStats(userUid) {
        try {
            const logs = await this.prisma.syncRateLimitLog.findMany({
                where: { userUid },
                orderBy: { lastSyncTime: 'desc' },
            });
            return logs.map(log => ({
                exchange: log.exchange,
                lastSyncTime: log.lastSyncTime,
                syncCount: log.syncCount,
            }));
        }
        catch (error) {
            logger.error(`Failed to get rate limit stats for ${userUid}`, error);
            return [];
        }
    }
    async overrideRateLimit(userUid, exchange) {
        try {
            await this.prisma.syncRateLimitLog.delete({
                where: {
                    userUid_exchange: {
                        userUid,
                        exchange,
                    },
                },
            });
            logger.warn(`Rate limit OVERRIDDEN for ${userUid}/${exchange} (manual admin action)`);
        }
        catch (error) {
            logger.error(`Failed to override rate limit for ${userUid}/${exchange}`, error);
        }
    }
};
exports.SyncRateLimiterService = SyncRateLimiterService;
exports.SyncRateLimiterService = SyncRateLimiterService = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], SyncRateLimiterService);
//# sourceMappingURL=sync-rate-limiter.service.js.map