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
exports.SyncStatusRepository = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
let SyncStatusRepository = class SyncStatusRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upsertSyncStatus(status) {
        const syncStatus = await this.prisma.syncStatus.upsert({
            where: {
                userUid_exchange: {
                    userUid: status.userUid,
                    exchange: status.exchange,
                },
            },
            update: {
                lastSyncTime: status.lastSyncTime,
                status: status.status,
                totalTrades: status.totalTrades,
                errorMessage: status.errorMessage,
                updatedAt: new Date(),
            },
            create: {
                userUid: status.userUid,
                exchange: status.exchange,
                lastSyncTime: status.lastSyncTime,
                status: status.status,
                totalTrades: status.totalTrades,
                errorMessage: status.errorMessage,
            },
        });
        return this.mapPrismaSyncStatusToSyncStatus(syncStatus);
    }
    async getSyncStatus(userUid, exchange) {
        const syncStatus = await this.prisma.syncStatus.findUnique({
            where: {
                userUid_exchange: {
                    userUid,
                    exchange,
                },
            },
        });
        return syncStatus ? this.mapPrismaSyncStatusToSyncStatus(syncStatus) : null;
    }
    async getAllSyncStatuses() {
        const syncStatuses = await this.prisma.syncStatus.findMany({
            orderBy: { updatedAt: 'desc' },
        });
        return syncStatuses.map(this.mapPrismaSyncStatusToSyncStatus);
    }
    async getSyncStatusesByUser(userUid) {
        const syncStatuses = await this.prisma.syncStatus.findMany({
            where: { userUid },
            orderBy: { updatedAt: 'desc' },
        });
        return syncStatuses.map(this.mapPrismaSyncStatusToSyncStatus);
    }
    async getPendingSyncs() {
        const syncStatuses = await this.prisma.syncStatus.findMany({
            where: {
                OR: [
                    { status: client_1.SyncStatusEnum.pending },
                    { status: client_1.SyncStatusEnum.syncing },
                ],
            },
            orderBy: { updatedAt: 'asc' },
        });
        return syncStatuses.map(this.mapPrismaSyncStatusToSyncStatus);
    }
    async getErrorSyncs() {
        const syncStatuses = await this.prisma.syncStatus.findMany({
            where: { status: client_1.SyncStatusEnum.error },
            orderBy: { updatedAt: 'desc' },
        });
        return syncStatuses.map(this.mapPrismaSyncStatusToSyncStatus);
    }
    async deleteSyncStatus(userUid, exchange) {
        await this.prisma.syncStatus.delete({
            where: {
                userUid_exchange: {
                    userUid,
                    exchange,
                },
            },
        });
    }
    async resetSyncStatus(userUid, exchange) {
        const syncStatus = await this.prisma.syncStatus.update({
            where: {
                userUid_exchange: {
                    userUid,
                    exchange,
                },
            },
            data: {
                status: client_1.SyncStatusEnum.pending,
                lastSyncTime: null,
                errorMessage: null,
                updatedAt: new Date(),
            },
        });
        return this.mapPrismaSyncStatusToSyncStatus(syncStatus);
    }
    mapPrismaSyncStatusToSyncStatus(prismaSyncStatus) {
        return {
            id: prismaSyncStatus.id,
            userUid: prismaSyncStatus.userUid,
            exchange: prismaSyncStatus.exchange,
            lastSyncTime: prismaSyncStatus.lastSyncTime || undefined,
            status: prismaSyncStatus.status,
            totalTrades: prismaSyncStatus.totalTrades,
            errorMessage: prismaSyncStatus.errorMessage || undefined,
            createdAt: prismaSyncStatus.createdAt,
            updatedAt: prismaSyncStatus.updatedAt,
        };
    }
};
exports.SyncStatusRepository = SyncStatusRepository;
exports.SyncStatusRepository = SyncStatusRepository = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], SyncStatusRepository);
//# sourceMappingURL=sync-status-repository.js.map