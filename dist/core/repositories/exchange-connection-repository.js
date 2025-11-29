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
exports.ExchangeConnectionRepository = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
const encryption_service_1 = require("../../services/encryption-service");
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('ExchangeConnectionRepository');
let ExchangeConnectionRepository = class ExchangeConnectionRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createConnection(credentials) {
        const encryptedApiKey = encryption_service_1.EncryptionService.encrypt(credentials.apiKey);
        const encryptedApiSecret = encryption_service_1.EncryptionService.encrypt(credentials.apiSecret);
        const encryptedPassphrase = credentials.passphrase
            ? encryption_service_1.EncryptionService.encrypt(credentials.passphrase)
            : null;
        const credentialsHash = encryption_service_1.EncryptionService.createCredentialsHash(credentials.apiKey, credentials.apiSecret, credentials.passphrase);
        try {
            const connection = await this.prisma.exchangeConnection.create({
                data: {
                    userUid: credentials.userUid,
                    exchange: credentials.exchange,
                    label: credentials.label,
                    encryptedApiKey,
                    encryptedApiSecret,
                    encryptedPassphrase,
                    credentialsHash,
                    isActive: credentials.isActive ?? true,
                },
            });
            return this.mapPrismaConnectionToConnection(connection);
        }
        catch (error) {
            const prismaError = error;
            if (prismaError.code === 'P2002') {
                throw new Error(`Exchange ${credentials.exchange} is already connected`);
            }
            throw error;
        }
    }
    async getConnectionById(id) {
        const connection = await this.prisma.exchangeConnection.findUnique({
            where: { id },
        });
        return connection ? this.mapPrismaConnectionToConnection(connection) : null;
    }
    async getConnectionsByUser(userUid, activeOnly = false) {
        const where = { userUid };
        if (activeOnly) {
            where.isActive = true;
        }
        const connections = await this.prisma.exchangeConnection.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        return connections.map(this.mapPrismaConnectionToConnection);
    }
    async getDecryptedCredentials(connectionId) {
        const connection = await this.prisma.exchangeConnection.findUnique({
            where: { id: connectionId, isActive: true },
        });
        if (!connection) {
            return null;
        }
        try {
            const apiKey = encryption_service_1.EncryptionService.decrypt(connection.encryptedApiKey);
            const apiSecret = encryption_service_1.EncryptionService.decrypt(connection.encryptedApiSecret);
            const passphrase = connection.encryptedPassphrase
                ? encryption_service_1.EncryptionService.decrypt(connection.encryptedPassphrase)
                : undefined;
            return {
                userUid: connection.userUid,
                exchange: connection.exchange,
                label: connection.label,
                apiKey,
                apiSecret,
                passphrase,
                isActive: connection.isActive,
            };
        }
        catch (error) {
            logger.error('Failed to decrypt credentials:', error);
            return null;
        }
    }
    async updateConnection(id, updates) {
        const updateData = {};
        if (updates.label) {
            updateData.label = updates.label;
        }
        if (updates.isActive !== undefined) {
            updateData.isActive = updates.isActive;
        }
        if (updates.apiKey) {
            updateData.encryptedApiKey = encryption_service_1.EncryptionService.encrypt(updates.apiKey);
        }
        if (updates.apiSecret) {
            updateData.encryptedApiSecret = encryption_service_1.EncryptionService.encrypt(updates.apiSecret);
        }
        if (updates.passphrase) {
            updateData.encryptedPassphrase = encryption_service_1.EncryptionService.encrypt(updates.passphrase);
        }
        if (updates.apiKey || updates.apiSecret || updates.passphrase !== undefined) {
            const connection = await this.prisma.exchangeConnection.findUnique({
                where: { id },
            });
            if (connection) {
                const apiKey = updates.apiKey || encryption_service_1.EncryptionService.decrypt(connection.encryptedApiKey);
                const apiSecret = updates.apiSecret || encryption_service_1.EncryptionService.decrypt(connection.encryptedApiSecret);
                const passphrase = updates.passphrase !== undefined
                    ? updates.passphrase
                    : (connection.encryptedPassphrase ? encryption_service_1.EncryptionService.decrypt(connection.encryptedPassphrase) : undefined);
                updateData.credentialsHash = encryption_service_1.EncryptionService.createCredentialsHash(apiKey, apiSecret, passphrase);
            }
        }
        const updatedConnection = await this.prisma.exchangeConnection.update({
            where: { id },
            data: updateData,
        });
        return this.mapPrismaConnectionToConnection(updatedConnection);
    }
    async deleteConnection(id) {
        await this.prisma.exchangeConnection.delete({
            where: { id },
        });
    }
    async getActiveUserUids() {
        const result = await this.prisma.exchangeConnection.findMany({
            where: { isActive: true },
            select: { userUid: true },
            distinct: ['userUid'],
        });
        return result.map(item => item.userUid);
    }
    async getActiveConnectionsWithIntervals() {
        const connections = await this.prisma.exchangeConnection.findMany({
            where: { isActive: true },
            select: {
                userUid: true,
                exchange: true,
                syncIntervalMinutes: true,
            },
        });
        return connections.map(conn => ({
            userUid: conn.userUid,
            exchange: conn.exchange,
            syncIntervalMinutes: conn.syncIntervalMinutes,
        }));
    }
    async findExistingConnection(userUid, exchange, label) {
        const connection = await this.prisma.exchangeConnection.findFirst({
            where: {
                userUid,
                exchange,
                label,
                isActive: true,
            },
        });
        return connection ? this.mapPrismaConnectionToConnection(connection) : null;
    }
    async getUniqueCredentialsForUser(userUid) {
        const connections = await this.prisma.exchangeConnection.findMany({
            where: {
                userUid,
                isActive: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        const uniqueConnections = [];
        const seenHashes = new Set();
        for (const connection of connections) {
            if (connection.credentialsHash && !seenHashes.has(connection.credentialsHash)) {
                seenHashes.add(connection.credentialsHash);
                uniqueConnections.push(connection);
            }
        }
        return uniqueConnections.map(this.mapPrismaConnectionToConnection);
    }
    async getConnectionsByCredentialsHash(userUid, credentialsHash) {
        const connections = await this.prisma.exchangeConnection.findMany({
            where: {
                userUid,
                credentialsHash,
            },
            orderBy: { createdAt: 'desc' },
        });
        return connections.map(this.mapPrismaConnectionToConnection);
    }
    async countConnectionsByUser(userUid) {
        return this.prisma.exchangeConnection.count({
            where: { userUid, isActive: true },
        });
    }
    async countAllActiveConnections() {
        return this.prisma.exchangeConnection.count({
            where: { isActive: true },
        });
    }
    mapPrismaConnectionToConnection(prismaConnection) {
        return {
            id: prismaConnection.id,
            userUid: prismaConnection.userUid,
            exchange: prismaConnection.exchange,
            label: prismaConnection.label,
            encryptedApiKey: prismaConnection.encryptedApiKey,
            encryptedApiSecret: prismaConnection.encryptedApiSecret,
            encryptedPassphrase: prismaConnection.encryptedPassphrase || undefined,
            credentialsHash: prismaConnection.credentialsHash || undefined,
            isActive: prismaConnection.isActive,
            createdAt: prismaConnection.createdAt,
            updatedAt: prismaConnection.updatedAt,
        };
    }
};
exports.ExchangeConnectionRepository = ExchangeConnectionRepository;
exports.ExchangeConnectionRepository = ExchangeConnectionRepository = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], ExchangeConnectionRepository);
//# sourceMappingURL=exchange-connection-repository.js.map