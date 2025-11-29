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
exports.SnapshotDataRepository = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('SnapshotDataRepository');
let SnapshotDataRepository = class SnapshotDataRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upsertSnapshotData(snapshot) {
        const snapshotData = await this.prisma.snapshotData.upsert({
            where: {
                userUid_timestamp_exchange: {
                    userUid: snapshot.userUid,
                    timestamp: new Date(snapshot.timestamp),
                    exchange: snapshot.exchange,
                },
            },
            update: {
                totalEquity: snapshot.totalEquity,
                realizedBalance: snapshot.realizedBalance,
                unrealizedPnL: snapshot.unrealizedPnL,
                deposits: snapshot.deposits,
                withdrawals: snapshot.withdrawals,
                breakdown_by_market: (snapshot.breakdown_by_market || undefined),
                updatedAt: new Date(),
            },
            create: {
                userUid: snapshot.userUid,
                timestamp: new Date(snapshot.timestamp),
                exchange: snapshot.exchange,
                totalEquity: snapshot.totalEquity,
                realizedBalance: snapshot.realizedBalance,
                unrealizedPnL: snapshot.unrealizedPnL,
                deposits: snapshot.deposits || 0,
                withdrawals: snapshot.withdrawals || 0,
                breakdown_by_market: (snapshot.breakdown_by_market || undefined),
            },
        });
        return this.mapPrismaSnapshotDataToSnapshotData(snapshotData);
    }
    async getSnapshotData(userUid, startDate, endDate, exchange) {
        const where = { userUid };
        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) {
                where.timestamp.gte = startDate;
            }
            if (endDate) {
                where.timestamp.lte = endDate;
            }
        }
        if (exchange) {
            where.exchange = exchange;
        }
        logger.debug('Querying snapshot data', {
            userUid,
            exchange,
            startDate: startDate?.toISOString(),
            endDate: endDate?.toISOString()
        });
        const snapshotData = await this.prisma.snapshotData.findMany({
            where,
            orderBy: { timestamp: 'desc' },
        });
        logger.debug('Snapshot data query completed', {
            count: snapshotData.length,
            exchanges: snapshotData.length > 0 ? Array.from(new Set(snapshotData.map(s => s.exchange))) : []
        });
        return snapshotData.map(this.mapPrismaSnapshotDataToSnapshotData);
    }
    async getSnapshotDataInRange(userUid, startTime, endTime, exchange) {
        const where = {
            userUid,
            timestamp: {
                gte: new Date(startTime),
                lte: new Date(endTime),
            },
        };
        if (exchange) {
            where.exchange = exchange;
        }
        const snapshotData = await this.prisma.snapshotData.findMany({
            where,
            orderBy: { timestamp: 'asc' },
        });
        return snapshotData.map(this.mapPrismaSnapshotDataToSnapshotData);
    }
    async getLatestSnapshotData(userUid, exchange) {
        const where = { userUid };
        if (exchange) {
            where.exchange = exchange;
        }
        const snapshotData = await this.prisma.snapshotData.findFirst({
            where,
            orderBy: { timestamp: 'desc' },
        });
        return snapshotData ? this.mapPrismaSnapshotDataToSnapshotData(snapshotData) : null;
    }
    async deleteSnapshotData(userUid, timestamp, exchange) {
        await this.prisma.snapshotData.delete({
            where: {
                userUid_timestamp_exchange: {
                    userUid,
                    timestamp: new Date(timestamp),
                    exchange,
                },
            },
        });
    }
    async deleteOldData(beforeDate) {
        const result = await this.prisma.snapshotData.deleteMany({
            where: {
                createdAt: { lt: beforeDate },
            },
        });
        return result.count;
    }
    async deleteAllForUser(userUid, exchange) {
        const where = { userUid };
        if (exchange) {
            where.exchange = exchange;
        }
        const result = await this.prisma.snapshotData.deleteMany({
            where,
        });
        return result.count;
    }
    async countSnapshots() {
        return await this.prisma.snapshotData.count();
    }
    async countSnapshotDataByUser(userUid, exchange) {
        const where = { userUid };
        if (exchange) {
            where.exchange = exchange;
        }
        return this.prisma.snapshotData.count({ where });
    }
    mapPrismaSnapshotDataToSnapshotData(prismaSnapshotData) {
        return {
            id: prismaSnapshotData.id,
            userUid: prismaSnapshotData.userUid,
            timestamp: prismaSnapshotData.timestamp.toISOString(),
            exchange: prismaSnapshotData.exchange,
            totalEquity: prismaSnapshotData.totalEquity,
            realizedBalance: prismaSnapshotData.realizedBalance,
            unrealizedPnL: prismaSnapshotData.unrealizedPnL,
            deposits: prismaSnapshotData.deposits,
            withdrawals: prismaSnapshotData.withdrawals,
            breakdown_by_market: prismaSnapshotData.breakdown_by_market,
            createdAt: prismaSnapshotData.createdAt,
            updatedAt: prismaSnapshotData.updatedAt,
        };
    }
};
exports.SnapshotDataRepository = SnapshotDataRepository;
exports.SnapshotDataRepository = SnapshotDataRepository = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], SnapshotDataRepository);
//# sourceMappingURL=snapshot-data-repository.js.map