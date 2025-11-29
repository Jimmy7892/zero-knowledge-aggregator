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
exports.DatabaseMigrationService = void 0;
const tsyringe_1 = require("tsyringe");
const client_1 = require("@prisma/client");
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('DatabaseMigrationService');
let DatabaseMigrationService = class DatabaseMigrationService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async runMigrations() {
        try {
            await this.createMigrationsTable();
            await this.addCredentialsHashColumn();
            await this.fixColumnNaming();
            await this.addClosedAtColumn();
            await this.addTypeColumnToTrades();
            await this.addStatusColumnToTrades();
            await this.addMatchedQuantityColumnToTrades();
            await this.fixIdColumnsToAutoIncrement();
        }
        catch (error) {
            logger.error('Database migration failed:', error);
            throw error;
        }
    }
    async createMigrationsTable() {
        await this.prisma.$executeRaw `CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    }
    async isMigrationApplied(name) {
        const result = await this.prisma.$queryRaw `SELECT COUNT(*) as count FROM migrations WHERE name = ${name}`;
        return result[0].count > 0;
    }
    async markMigrationApplied(name) {
        await this.prisma.$executeRaw `INSERT INTO migrations (name) VALUES (${name})`;
    }
    async applyMigration(name, fn) {
        if (await this.isMigrationApplied(name)) {
            return;
        }
        try {
            await fn();
            await this.markMigrationApplied(name);
        }
        catch (error) {
            logger.error(`Migration ${name} failed:`, error);
            throw error;
        }
    }
    async addCredentialsHashColumn() {
        await this.applyMigration('add_credentials_hash_column', () => this.addColumn('exchange_connections', 'credentials_hash', 'TEXT'));
    }
    async addClosedAtColumn() {
        await this.applyMigration('add_closed_at_column', () => this.addColumn('positions', 'closed_at', 'TIMESTAMP DEFAULT NULL'));
    }
    async addTypeColumnToTrades() {
        await this.applyMigration('add_type_column_to_trades', async () => {
            await this.addColumn('trades', 'type', 'TEXT CHECK (type IN (\'buy\', \'sell\'))');
            await this.prisma.$executeRaw `UPDATE trades SET type = side WHERE type IS NULL`;
        });
    }
    async addStatusColumnToTrades() {
        await this.applyMigration('add_status_column_to_trades', async () => {
            await this.addColumn('trades', 'status', 'TEXT CHECK (status IN (\'pending\', \'matched\', \'partially_matched\')) DEFAULT \'pending\'');
            await this.prisma.$executeRaw `UPDATE trades SET status = 'matched' WHERE status IS NULL`;
        });
    }
    async addMatchedQuantityColumnToTrades() {
        await this.applyMigration('add_matched_quantity_column_to_trades', () => this.addColumn('trades', 'matched_quantity', 'DECIMAL(20,8) DEFAULT 0'));
    }
    async addColumn(tableName, columnName, columnType) {
        try {
            await this.prisma.$executeRawUnsafe(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (!errorMessage.includes('duplicate column name')) {
                logger.error(`Error adding column ${columnName} to ${tableName}`, err);
                throw err;
            }
        }
    }
    async columnExists(tableName, columnName) {
        const rows = await this.prisma.$queryRawUnsafe(`PRAGMA table_info(${tableName})`);
        return rows.some(row => row.name === columnName);
    }
    async getTableInfo(tableName) {
        return await this.prisma.$queryRawUnsafe(`PRAGMA table_info(${tableName})`);
    }
    async fixColumnNaming() {
        const migrationName = 'fix_column_naming_snake_case';
        try {
            if (await this.isMigrationApplied(migrationName)) {
                return;
            }
            const needsPositionsFix = await this.columnExists('positions', 'userUid');
            const needsReturnsfix = await this.columnExists('hourly_returns', 'userUid');
            const needsTradesFix = await this.columnExists('trades', 'userUid');
            if (needsPositionsFix) {
                await this.recreatePositionsTable();
            }
            if (needsReturnsfix) {
                await this.recreateHourlyReturnsTable();
            }
            if (needsTradesFix) {
                await this.recreateTradesTable();
            }
            await this.markMigrationApplied(migrationName);
        }
        catch (error) {
            logger.error(`Failed to apply migration ${migrationName}:`, error);
            throw error;
        }
    }
    async recreatePositionsTable() {
        await this.runSequentialQueries([
            'ALTER TABLE positions RENAME TO positions_old;',
            `CREATE TABLE positions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT CHECK (side IN ('long', 'short')) NOT NULL, size DECIMAL(20,8) NOT NULL, entry_price DECIMAL(20,8), mark_price DECIMAL(20,8), pnl DECIMAL(20,8) DEFAULT 0, realized_pnl DECIMAL(20,8), unrealized_pnl DECIMAL(20,8), percentage DECIMAL(10,4), net_profit DECIMAL(20,8), status TEXT CHECK (status IN ('open', 'closed')) DEFAULT 'open', timestamp TIMESTAMP NOT NULL, closed_at TIMESTAMP DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE);`,
            `INSERT INTO positions (user_uid, exchange, symbol, side, size, entry_price, mark_price, pnl, realized_pnl, unrealized_pnl, percentage, net_profit, status, timestamp, closed_at, created_at, updated_at) SELECT userUid, exchange, symbol, side, size, entryPrice, markPrice, pnl, realizedPnl, unrealizedPnl, percentage, netProfit, status, timestamp, NULL as closed_at, created_at, updated_at FROM positions_old;`,
            'CREATE INDEX IF NOT EXISTS idx_positions_user_timestamp ON positions(user_uid, timestamp);',
            'CREATE INDEX IF NOT EXISTS idx_positions_user_exchange ON positions(user_uid, exchange);',
            'CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);',
            'DROP TABLE positions_old;'
        ]);
    }
    async recreateHourlyReturnsTable() {
        await this.runSequentialQueries([
            'ALTER TABLE hourly_returns RENAME TO hourly_returns_old;',
            `CREATE TABLE hourly_returns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, hour TEXT NOT NULL, exchange TEXT NOT NULL, volume DECIMAL(20,8) DEFAULT 0, total_quantity DECIMAL(20,8) DEFAULT 0, trades INTEGER DEFAULT 0, return_pct DECIMAL(10,6) DEFAULT 0, return_usd DECIMAL(20,8) DEFAULT 0, total_fees DECIMAL(20,8) DEFAULT 0, realized_pnl DECIMAL(20,8) DEFAULT 0, unrealized_pnl DECIMAL(20,8) DEFAULT 0, matches INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE, UNIQUE(user_uid, hour, exchange));`,
            `INSERT INTO hourly_returns (user_uid, hour, exchange, volume, total_quantity, trades, return_pct, return_usd, total_fees, realized_pnl, unrealized_pnl, matches, created_at, updated_at) SELECT userUid, hour, exchange, volume, totalQuantity, trades, returnPct, returnUsd, totalFees, realizedPnL, unrealizedPnL, matches, created_at, updated_at FROM hourly_returns_old;`,
            'CREATE INDEX IF NOT EXISTS idx_hourly_returns_user_hour ON hourly_returns(user_uid, hour);',
            'DROP TABLE hourly_returns_old;'
        ]);
    }
    async recreateTradesTable() {
        await this.runSequentialQueries([
            'ALTER TABLE trades RENAME TO trades_old;',
            `CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT CHECK (side IN ('buy', 'sell')) NOT NULL, type TEXT CHECK (type IN ('buy', 'sell')) NOT NULL, quantity DECIMAL(20,8) NOT NULL, price DECIMAL(20,8) NOT NULL, fees DECIMAL(20,8) DEFAULT 0, fee_asset TEXT, timestamp TIMESTAMP NOT NULL, status TEXT CHECK (status IN ('pending', 'matched', 'partially_matched')) DEFAULT 'pending', matched_quantity DECIMAL(20,8) DEFAULT 0, exchange_trade_id TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE);`,
            `INSERT INTO trades (user_uid, exchange, symbol, side, type, quantity, price, fees, fee_asset, timestamp, status, matched_quantity, exchange_trade_id, created_at) SELECT userUid, exchange, symbol, side, side as type, quantity, price, fees, feeAsset, timestamp, 'matched' as status, 0 as matched_quantity, exchangeTradeId, createdAt FROM trades_old;`,
            'CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp ON trades(user_uid, timestamp);',
            'CREATE INDEX IF NOT EXISTS idx_trades_user_exchange ON trades(user_uid, exchange);',
            'DROP TABLE trades_old;'
        ]);
    }
    async runSequentialQueries(queries) {
        for (const query of queries) {
            try {
                await this.prisma.$executeRawUnsafe(query);
            }
            catch (err) {
                logger.error(`Error executing query: ${query}`);
                throw err;
            }
        }
    }
    async fixIdColumnsToAutoIncrement() {
        const migrationName = 'fix_id_columns_to_autoincrement';
        try {
            if (await this.isMigrationApplied(migrationName)) {
                return;
            }
            const tables = ['exchange_connections', 'sync_statuses', 'trades', 'positions', 'hourly_returns'];
            for (const tableName of tables) {
                const needsFix = await this.checkIdColumnType(tableName);
                if (needsFix) {
                    await this.recreateTableWithAutoIncrementId(tableName);
                }
            }
            await this.markMigrationApplied(migrationName);
        }
        catch (error) {
            logger.error(`Failed to apply migration ${migrationName}:`, error);
            throw error;
        }
    }
    async checkIdColumnType(tableName) {
        const columns = await this.prisma.$queryRawUnsafe(`PRAGMA table_info(${tableName})`);
        const idColumn = columns.find(col => col.name === 'id');
        return !idColumn || idColumn.type === 'TEXT';
    }
    async recreateTableWithAutoIncrementId(tableName) {
        const queries = [
            `ALTER TABLE ${tableName} RENAME TO ${tableName}_old;`,
            this.getAutoIncrementTableSQL(tableName),
            this.getDataCopySQL(tableName),
            ...this.getIndexesSQL(tableName),
            `DROP TABLE ${tableName}_old;`
        ];
        await this.runSequentialQueries(queries);
    }
    getAutoIncrementTableSQL(tableName) {
        const tables = {
            'exchange_connections': `CREATE TABLE exchange_connections (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, label TEXT, encrypted_api_key TEXT NOT NULL, encrypted_api_secret TEXT NOT NULL, encrypted_passphrase TEXT, credentials_hash TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE, UNIQUE(user_uid, exchange, label))`,
            'sync_statuses': `CREATE TABLE sync_statuses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, last_sync_time TIMESTAMP, status TEXT CHECK (status IN ('pending', 'running', 'completed', 'error')) DEFAULT 'pending', total_trades INTEGER DEFAULT 0, error_message TEXT, is_historical_complete BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE, UNIQUE(user_uid, exchange))`,
            'trades': `CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT CHECK (side IN ('buy', 'sell')) NOT NULL, type TEXT CHECK (type IN ('buy', 'sell')) NOT NULL, quantity DECIMAL(20,8) NOT NULL, price DECIMAL(20,8) NOT NULL, fees DECIMAL(20,8) DEFAULT 0, fee_asset TEXT, timestamp TIMESTAMP NOT NULL, status TEXT CHECK (status IN ('pending', 'matched', 'partially_matched')) DEFAULT 'pending', matched_quantity DECIMAL(20,8) DEFAULT 0, exchange_trade_id TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE)`,
            'positions': `CREATE TABLE positions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT CHECK (side IN ('long', 'short')) NOT NULL, size DECIMAL(20,8) NOT NULL, entry_price DECIMAL(20,8), mark_price DECIMAL(20,8), pnl DECIMAL(20,8) DEFAULT 0, realized_pnl DECIMAL(20,8), unrealized_pnl DECIMAL(20,8), percentage DECIMAL(10,4), net_profit DECIMAL(20,8), status TEXT CHECK (status IN ('open', 'closed')) DEFAULT 'open', timestamp TIMESTAMP NOT NULL, closed_at TIMESTAMP DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE)`,
            'hourly_returns': `CREATE TABLE hourly_returns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_uid TEXT NOT NULL, hour TEXT NOT NULL, exchange TEXT NOT NULL, volume DECIMAL(20,8) DEFAULT 0, total_quantity DECIMAL(20,8) DEFAULT 0, trades INTEGER DEFAULT 0, return_pct DECIMAL(10,6) DEFAULT 0, return_usd DECIMAL(20,8) DEFAULT 0, total_fees DECIMAL(20,8) DEFAULT 0, realized_pnl DECIMAL(20,8) DEFAULT 0, unrealized_pnl DECIMAL(20,8) DEFAULT 0, matches INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE, UNIQUE(user_uid, hour, exchange))`
        };
        if (!tables[tableName]) {
            throw new Error(`Unknown table: ${tableName}`);
        }
        return tables[tableName];
    }
    getDataCopySQL(tableName) {
        const copies = {
            'exchange_connections': `INSERT INTO exchange_connections (user_uid, exchange, label, encrypted_api_key, encrypted_api_secret, encrypted_passphrase, credentials_hash, is_active, created_at, updated_at) SELECT user_uid, exchange, label, encrypted_api_key, encrypted_api_secret, encrypted_passphrase, credentials_hash, is_active, created_at, updated_at FROM exchange_connections_old`,
            'sync_statuses': `INSERT INTO sync_statuses (user_uid, exchange, last_sync_time, status, total_trades, error_message, is_historical_complete, created_at, updated_at) SELECT user_uid, exchange, last_sync_time, status, total_trades, error_message, is_historical_complete, created_at, updated_at FROM sync_statuses_old`,
            'trades': `INSERT INTO trades (user_uid, exchange, symbol, side, type, quantity, price, fees, fee_asset, timestamp, status, matched_quantity, exchange_trade_id, created_at) SELECT user_uid, exchange, symbol, side, type, quantity, price, fees, fee_asset, timestamp, status, matched_quantity, exchange_trade_id, created_at FROM trades_old`,
            'positions': `INSERT INTO positions (user_uid, exchange, symbol, side, size, entry_price, mark_price, pnl, realized_pnl, unrealized_pnl, percentage, net_profit, status, timestamp, closed_at, created_at, updated_at) SELECT user_uid, exchange, symbol, side, size, entry_price, mark_price, pnl, realized_pnl, unrealized_pnl, percentage, net_profit, status, timestamp, closed_at, created_at, updated_at FROM positions_old`,
            'hourly_returns': `INSERT INTO hourly_returns (user_uid, hour, exchange, volume, total_quantity, trades, return_pct, return_usd, total_fees, realized_pnl, unrealized_pnl, matches, created_at, updated_at) SELECT user_uid, hour, exchange, volume, total_quantity, trades, return_pct, return_usd, total_fees, realized_pnl, unrealized_pnl, matches, created_at, updated_at FROM hourly_returns_old`
        };
        if (!copies[tableName]) {
            throw new Error(`Unknown table: ${tableName}`);
        }
        return copies[tableName];
    }
    getIndexesSQL(tableName) {
        const indexes = {
            'exchange_connections': [],
            'sync_statuses': ['CREATE INDEX IF NOT EXISTS idx_sync_statuses_user_exchange ON sync_statuses(user_uid, exchange);'],
            'trades': ['CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp ON trades(user_uid, timestamp);', 'CREATE INDEX IF NOT EXISTS idx_trades_user_exchange ON trades(user_uid, exchange);'],
            'positions': ['CREATE INDEX IF NOT EXISTS idx_positions_user_timestamp ON positions(user_uid, timestamp);', 'CREATE INDEX IF NOT EXISTS idx_positions_user_exchange ON positions(user_uid, exchange);', 'CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);'],
            'hourly_returns': ['CREATE INDEX IF NOT EXISTS idx_hourly_returns_user_hour ON hourly_returns(user_uid, hour);']
        };
        return indexes[tableName] || [];
    }
};
exports.DatabaseMigrationService = DatabaseMigrationService;
exports.DatabaseMigrationService = DatabaseMigrationService = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)('PrismaClient')),
    __metadata("design:paramtypes", [client_1.PrismaClient])
], DatabaseMigrationService);
//# sourceMappingURL=database-migration-service.js.map