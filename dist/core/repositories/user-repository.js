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
exports.UserRepository = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
let UserRepository = class UserRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createUser(userData) {
        const createdUser = await this.prisma.user.upsert({
            where: {
                uid: userData.uid,
            },
            update: {},
            create: {
                uid: userData.uid,
            },
        });
        return this.mapPrismaUserToUser(createdUser);
    }
    async getUserByUid(uid) {
        const user = await this.prisma.user.findUnique({
            where: { uid },
        });
        return user ? this.mapPrismaUserToUser(user) : null;
    }
    async getUserById(id) {
        const user = await this.prisma.user.findUnique({
            where: { id },
        });
        return user ? this.mapPrismaUserToUser(user) : null;
    }
    async updateUser(uid, updateData) {
        const updatedUser = await this.prisma.user.update({
            where: { uid },
            data: updateData,
        });
        return this.mapPrismaUserToUser(updatedUser);
    }
    async deleteUser(uid) {
        await this.prisma.user.delete({
            where: { uid },
        });
    }
    async userExists(uid) {
        const count = await this.prisma.user.count({
            where: { uid },
        });
        return count > 0;
    }
    async getAllUsers() {
        const users = await this.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return users.map(this.mapPrismaUserToUser);
    }
    async countUsers() {
        return this.prisma.user.count();
    }
    async getUserStats(uid) {
        const user = await this.prisma.user.findUnique({
            where: { uid },
            include: {
                _count: {
                    select: {
                        snapshots: true,
                        exchangeConnections: true,
                    },
                },
                syncStatuses: true,
            },
        });
        if (!user) {
            throw new Error(`User with UID ${uid} not found`);
        }
        const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        const totalTrades = user.syncStatuses.reduce((sum, s) => sum + s.totalTrades, 0);
        return {
            totalTrades,
            totalPositions: user._count.snapshots,
            exchangeConnections: user._count.exchangeConnections,
            accountAge,
        };
    }
    mapPrismaUserToUser(prismaUser) {
        return {
            id: prismaUser.id,
            uid: prismaUser.uid,
            syncIntervalMinutes: prismaUser.syncIntervalMinutes,
            createdAt: prismaUser.createdAt,
            updatedAt: prismaUser.updatedAt,
        };
    }
};
exports.UserRepository = UserRepository;
exports.UserRepository = UserRepository = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], UserRepository);
//# sourceMappingURL=user-repository.js.map