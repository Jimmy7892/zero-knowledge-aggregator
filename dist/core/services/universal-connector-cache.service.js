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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniversalConnectorCacheService = void 0;
const tsyringe_1 = require("tsyringe");
const ExchangeConnectorFactory_1 = require("../../external/factories/ExchangeConnectorFactory");
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
const crypto_1 = __importDefault(require("crypto"));
const logger = (0, secure_enclave_logger_1.getLogger)('UniversalConnectorCache');
let UniversalConnectorCacheService = class UniversalConnectorCacheService {
    cache = new Map();
    stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        currentSize: 0,
        totalMemoryMB: 0,
    };
    DEFAULT_TTL_MS = 60 * 60 * 1000;
    MAX_CACHE_SIZE = 500;
    CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
    ESTIMATED_CONNECTOR_SIZE_KB = 500;
    cleanupTimer = null;
    constructor() {
        this.startCleanupTimer();
        logger.info('Universal Connector Cache initialized', {
            ttl: `${this.DEFAULT_TTL_MS / 1000 / 60}min`,
            maxSize: this.MAX_CACHE_SIZE,
            cleanupInterval: `${this.CLEANUP_INTERVAL_MS / 1000 / 60}min`,
        });
    }
    getOrCreate(exchange, credentials, ttlMs) {
        const cacheKey = this.generateCacheKey(exchange, credentials);
        const now = Date.now();
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > now) {
            this.stats.hits++;
            cached.lastAccessed = now;
            cached.accessCount++;
            logger.debug('Connector cache HIT', {
                exchange,
                exchangeType: cached.exchangeType,
                userUid: credentials.userUid,
                age: Math.round((now - cached.createdAt) / 1000) + 's',
                accessCount: cached.accessCount,
            });
            return cached.connector;
        }
        this.stats.misses++;
        logger.debug('Connector cache MISS', {
            exchange,
            userUid: credentials.userUid,
            reason: cached ? 'expired' : 'not-found',
        });
        const connector = ExchangeConnectorFactory_1.ExchangeConnectorFactory.create(credentials);
        const exchangeType = ExchangeConnectorFactory_1.ExchangeConnectorFactory.isCryptoExchange(exchange)
            ? 'ccxt'
            : 'custom-broker';
        const ttl = ttlMs || this.DEFAULT_TTL_MS;
        this.cache.set(cacheKey, {
            connector,
            expires: now + ttl,
            createdAt: now,
            lastAccessed: now,
            accessCount: 1,
            exchangeType,
        });
        if (this.cache.size > this.MAX_CACHE_SIZE) {
            this.evictLRU();
        }
        this.stats.currentSize = this.cache.size;
        this.stats.totalMemoryMB =
            (this.cache.size * this.ESTIMATED_CONNECTOR_SIZE_KB) / 1024;
        logger.info('Connector created and cached', {
            exchange,
            exchangeType,
            userUid: credentials.userUid,
            cacheSize: this.cache.size,
            ttl: `${ttl / 1000 / 60}min`,
        });
        return connector;
    }
    generateCacheKey(exchange, credentials) {
        const credHash = crypto_1.default
            .createHash('sha256')
            .update(JSON.stringify({
            apiKey: credentials.apiKey,
            apiSecret: credentials.apiSecret,
            passphrase: credentials.passphrase,
        }))
            .digest('hex')
            .substring(0, 16);
        return `${exchange}:${credentials.userUid}:${credHash}`;
    }
    evictLRU() {
        let oldestKey = null;
        let oldestAccess = Infinity;
        for (const [key, value] of this.cache.entries()) {
            if (value.lastAccessed < oldestAccess) {
                oldestAccess = value.lastAccessed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.stats.evictions++;
            logger.debug('LRU eviction', {
                key: oldestKey.substring(0, 30) + '...',
                age: Math.round((Date.now() - oldestAccess) / 1000) + 's',
            });
        }
    }
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.CLEANUP_INTERVAL_MS);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }
    cleanupExpired() {
        const now = Date.now();
        let removedCount = 0;
        for (const [key, value] of this.cache.entries()) {
            if (value.expires <= now) {
                this.cache.delete(key);
                removedCount++;
            }
        }
        if (removedCount > 0) {
            this.stats.currentSize = this.cache.size;
            this.stats.totalMemoryMB =
                (this.cache.size * this.ESTIMATED_CONNECTOR_SIZE_KB) / 1024;
            logger.info('Cache cleanup completed', {
                removed: removedCount,
                remaining: this.cache.size,
            });
        }
    }
    getStats() {
        return {
            ...this.stats,
            currentSize: this.cache.size,
            totalMemoryMB: (this.cache.size * this.ESTIMATED_CONNECTOR_SIZE_KB) / 1024,
        };
    }
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.currentSize = 0;
        this.stats.totalMemoryMB = 0;
        logger.info('Cache cleared', { removedCount: size });
    }
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.clear();
        logger.info('Universal Connector Cache shutdown');
    }
};
exports.UniversalConnectorCacheService = UniversalConnectorCacheService;
exports.UniversalConnectorCacheService = UniversalConnectorCacheService = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [])
], UniversalConnectorCacheService);
//# sourceMappingURL=universal-connector-cache.service.js.map