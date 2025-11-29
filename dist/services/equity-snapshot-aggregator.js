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
exports.EquitySnapshotAggregator = void 0;
const tsyringe_1 = require("tsyringe");
const snapshot_data_repository_1 = require("../core/repositories/snapshot-data-repository");
const exchange_connection_repository_1 = require("../core/repositories/exchange-connection-repository");
const user_repository_1 = require("../core/repositories/user-repository");
const universal_connector_cache_service_1 = require("../core/services/universal-connector-cache.service");
const snapshot_breakdown_1 = require("../types/snapshot-breakdown");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const time_utils_1 = require("../utils/time-utils");
const logger = (0, secure_enclave_logger_1.getLogger)('EquitySnapshotAggregator');
const hasMarketTypes = (connector) => typeof connector.detectMarketTypes === 'function';
const hasBalanceBreakdown = (connector) => typeof connector.getBalanceBreakdown === 'function';
const hasGetBalance = (connector) => typeof connector.getBalance === 'function';
const hasEarnBalance = (connector) => typeof connector.getEarnBalance === 'function';
function roundToInterval(date, intervalMinutes = 60) {
    const rounded = new Date(date);
    if (intervalMinutes >= 1440) {
        rounded.setUTCHours(0, 0, 0, 0);
        return rounded;
    }
    const minutes = rounded.getMinutes();
    rounded.setMinutes(Math.floor(minutes / intervalMinutes) * intervalMinutes, 0, 0);
    return rounded;
}
let EquitySnapshotAggregator = class EquitySnapshotAggregator {
    snapshotDataRepo;
    connectionRepo;
    userRepo;
    connectorCache;
    constructor(snapshotDataRepo, connectionRepo, userRepo, connectorCache) {
        this.snapshotDataRepo = snapshotDataRepo;
        this.connectionRepo = connectionRepo;
        this.userRepo = userRepo;
        this.connectorCache = connectorCache;
    }
    matchesMarketType(symbol, marketType) {
        const s = symbol.toUpperCase();
        switch (marketType) {
            case 'swap': return s.includes('PERP') || s.includes('SWAP') || s.includes(':USDT') || s.includes(':USD') || s.includes(':BUSD');
            case 'future': return /\d{6}/.test(s) && !s.includes('-C') && !s.includes('-P');
            case 'options': return s.includes('-C') || s.includes('-P');
            case 'spot':
            case 'margin': return !s.includes('PERP') && !s.includes('SWAP') && !s.includes(':USDT') && !s.includes(':USD') && !/\d{6}/.test(s) && !s.includes('-C') && !s.includes('-P');
            default: return true;
        }
    }
    async updateCurrentSnapshot(userUid, exchange) {
        try {
            const { connector, currentSnapshot } = await this.getConnectorAndSnapshotTime(userUid, exchange);
            if (!connector) {
                logger.warn(`No connector found for ${userUid}/${exchange}`);
                return;
            }
            const { balancesByMarket, globalEquity, globalMargin, filteredTypes } = await this.fetchBalancesByMarket(connector, exchange);
            const startOfDay = time_utils_1.TimeUtils.getStartOfDayUTC(currentSnapshot);
            const { tradesByMarket, swapSymbols } = await this.fetchTradesByMarket(exchange, startOfDay, filteredTypes, connector);
            const totalFundingFees = await this.calculateFundingFees(connector, swapSymbols, startOfDay);
            const breakdown = this.buildMarketBreakdown(balancesByMarket, tradesByMarket, totalFundingFees, globalEquity, globalMargin);
            const totalUnrealizedPnl = await this.calculateUnrealizedPnl(connector, balancesByMarket);
            await this.saveSnapshot({
                userUid,
                exchange,
                currentSnapshot,
                globalEquity,
                totalUnrealizedPnl,
                breakdown
            });
            const totalRealizedBalance = globalEquity - totalUnrealizedPnl;
            logger.info(`Updated snapshot for ${userUid} on ${exchange}: equity=${globalEquity.toFixed(2)}, realized=${totalRealizedBalance.toFixed(2)}, unrealized=${totalUnrealizedPnl.toFixed(2)}, markets=${Object.keys(breakdown).length - 1}`);
        }
        catch (error) {
            logger.error(`Failed to update snapshot with breakdown for ${userUid}`, error);
            throw error;
        }
    }
    async getConnectorAndSnapshotTime(userUid, exchange) {
        const user = await this.userRepo.getUserByUid(userUid);
        if (!user) {
            logger.error(`User ${userUid} not found`);
            return { connector: null, syncInterval: 60, currentSnapshot: new Date() };
        }
        const syncInterval = user.syncIntervalMinutes || 60;
        const currentSnapshot = roundToInterval(new Date(), syncInterval);
        const connections = (await this.connectionRepo.getConnectionsByUser(userUid)) ?? [];
        const connection = connections.find(c => c.exchange === exchange && c.isActive);
        if (!connection) {
            logger.error(`No active connection found for ${exchange}`, {
                userUid,
                availableExchanges: connections.map(c => c.exchange)
            });
            return { connector: null, syncInterval, currentSnapshot };
        }
        const credentials = await this.connectionRepo.getDecryptedCredentials(connection.id);
        if (!credentials) {
            logger.error(`Failed to decrypt credentials for ${exchange}`, { userUid, connectionId: connection.id });
            return { connector: null, syncInterval, currentSnapshot };
        }
        const connector = this.connectorCache.getOrCreate(exchange, credentials);
        return { connector, syncInterval, currentSnapshot };
    }
    async fetchBalancesByMarket(connector, exchange) {
        const balancesByMarket = {};
        let globalEquity = 0;
        let globalMargin = 0;
        let filteredTypes = [];
        const isCcxtConnector = hasMarketTypes(connector);
        if (isCcxtConnector) {
            const marketTypes = await connector.detectMarketTypes();
            filteredTypes = (0, snapshot_breakdown_1.getFilteredMarketTypes)(exchange, marketTypes);
            const balanceResults = await Promise.allSettled(filteredTypes.map(async (marketType) => ({
                marketType,
                data: await connector.getBalanceByMarket(marketType)
            })));
            for (const result of balanceResults) {
                if (result.status === 'fulfilled') {
                    const { marketType, data } = result.value;
                    const typedData = data;
                    if (typedData.equity > 0) {
                        balancesByMarket[marketType] = { totalEquityUsd: typedData.equity, unrealizedPnl: 0 };
                        globalEquity += typedData.equity;
                        globalMargin += typedData.available_margin || 0;
                    }
                }
            }
            if (hasEarnBalance(connector)) {
                try {
                    const earnData = await connector.getEarnBalance();
                    if (earnData.equity > 0) {
                        balancesByMarket['earn'] = { totalEquityUsd: earnData.equity, unrealizedPnl: 0 };
                        globalEquity += earnData.equity;
                        logger.info(`Earn balance: ${earnData.equity.toFixed(2)} USD`);
                    }
                }
                catch (earnError) {
                    logger.debug('Earn balance not available', { error: earnError instanceof Error ? earnError.message : String(earnError) });
                }
            }
        }
        else if (hasBalanceBreakdown(connector)) {
            const breakdown = await connector.getBalanceBreakdown();
            if (breakdown.global) {
                globalEquity = breakdown.global.equity || breakdown.global.totalEquityUsd || 0;
                globalMargin = breakdown.global.available_margin || breakdown.global.availableBalance || 0;
            }
            for (const [marketType, marketData] of Object.entries(breakdown)) {
                const equityValue = marketData?.equity ?? marketData?.totalEquityUsd;
                if (marketData && equityValue !== undefined) {
                    balancesByMarket[marketType] = {
                        totalEquityUsd: equityValue,
                        unrealizedPnl: marketData.unrealizedPnl,
                        realizedPnl: marketData.realizedPnl,
                        availableBalance: marketData.available_margin || marketData.availableBalance,
                        usedMargin: marketData.usedMargin,
                        positions: marketData.positions
                    };
                }
            }
            filteredTypes = Object.keys(balancesByMarket);
        }
        else if (hasGetBalance(connector)) {
            const balanceData = await connector.getBalance();
            const typedBalanceData = balanceData;
            balancesByMarket['global'] = {
                totalEquityUsd: typedBalanceData.equity,
                unrealizedPnl: typedBalanceData.unrealizedPnl || 0
            };
            globalEquity = typedBalanceData.equity;
            filteredTypes = ['global'];
        }
        return { balancesByMarket, globalEquity, globalMargin, filteredTypes };
    }
    async fetchTradesByMarket(exchange, since, filteredTypes, connector) {
        const tradesByMarket = {};
        const swapSymbols = new Set();
        const isCcxtConnector = hasMarketTypes(connector) && connector.getExecutedOrders;
        if (isCcxtConnector) {
            for (const marketType of filteredTypes) {
                try {
                    const trades = await connector.getExecutedOrders(marketType, since);
                    tradesByMarket[marketType] = trades;
                    if (marketType === 'swap') {
                        trades.forEach((trade) => swapSymbols.add(trade.symbol));
                    }
                    logger.debug(`Fetched ${trades.length} trades from ${exchange} ${marketType} API since ${since.toISOString()}`);
                }
                catch (apiError) {
                    logger.warn(`Failed to fetch trades from ${exchange} ${marketType} API`, { error: apiError instanceof Error ? apiError.message : String(apiError) });
                    tradesByMarket[marketType] = [];
                }
            }
        }
        else {
            logger.debug(`${exchange}: Trade metrics from historical summaries only (no individual trade storage)`);
            for (const marketType of filteredTypes) {
                tradesByMarket[marketType] = [];
            }
        }
        return { tradesByMarket, swapSymbols };
    }
    async calculateFundingFees(connector, swapSymbols, since) {
        if (swapSymbols.size === 0) {
            return 0;
        }
        try {
            const fundingData = connector.getFundingFees
                ? await connector.getFundingFees(Array.from(swapSymbols), since)
                : [];
            return fundingData.reduce((sum, f) => sum + f.amount, 0);
        }
        catch (error) {
            return 0;
        }
    }
    createDualCaseMetrics(tradingFees, fundingFees) {
        return {
            tradingFees,
            trading_fees: tradingFees,
            fundingFees,
            funding_fees: fundingFees
        };
    }
    buildMarketBreakdown(balancesByMarket, tradesByMarket, totalFundingFees, globalEquity, globalMargin) {
        const breakdown = {};
        const allTrades = [];
        for (const trades of Object.values(tradesByMarket)) {
            allTrades.push(...trades);
        }
        const standardMarkets = ['spot', 'swap', 'earn', 'options'];
        let totalVolume = 0;
        let totalTrades = 0;
        let totalTradingFees = 0;
        for (const marketType of standardMarkets) {
            const marketTrades = allTrades.filter(t => this.matchesMarketType(t.symbol, marketType));
            const volume = marketTrades.reduce((sum, t) => {
                const tradeCost = t.cost || (t.price && t.amount ? t.price * t.amount : 0);
                return sum + tradeCost;
            }, 0);
            const fees = marketTrades.reduce((sum, t) => sum + (t.fee?.cost || 0), 0);
            const trades = marketTrades.length;
            const balance = balancesByMarket[marketType];
            const fundingForMarket = marketType === 'swap' ? totalFundingFees : 0;
            const marketData = {
                totalEquityUsd: balance?.totalEquityUsd || 0,
                unrealizedPnl: balance?.unrealizedPnl || 0,
                realizedPnl: balance?.realizedPnl,
                availableBalance: balance?.availableBalance,
                usedMargin: balance?.usedMargin,
                positions: balance?.positions,
                equity: balance?.totalEquityUsd || balance?.equity || 0,
                available_margin: balance?.availableBalance || balance?.available_margin || 0,
                volume,
                trades,
                ...this.createDualCaseMetrics(fees, fundingForMarket)
            };
            breakdown[marketType] = marketData;
            totalVolume += volume;
            totalTrades += trades;
            totalTradingFees += fees;
        }
        breakdown.global = {
            totalEquityUsd: globalEquity,
            availableBalance: globalMargin,
            unrealizedPnl: 0,
            equity: globalEquity,
            available_margin: globalMargin,
            volume: totalVolume,
            trades: totalTrades,
            ...this.createDualCaseMetrics(totalTradingFees, totalFundingFees)
        };
        return breakdown;
    }
    async calculateUnrealizedPnl(connector, balancesByMarket) {
        let totalUnrealizedPnl = 0;
        try {
            const positions = await connector.getCurrentPositions();
            if (positions && Array.isArray(positions)) {
                for (const position of positions) {
                    if (position.size && Number(position.size) !== 0) {
                        totalUnrealizedPnl += Number(position.unrealizedPnl) || 0;
                    }
                }
            }
        }
        catch (posError) {
            totalUnrealizedPnl = Object.values(balancesByMarket).reduce((sum, market) => sum + (market.unrealizedPnl || 0), 0);
        }
        return totalUnrealizedPnl;
    }
    async saveSnapshot(params) {
        const { userUid, exchange, currentSnapshot, globalEquity, totalUnrealizedPnl, breakdown } = params;
        const totalRealizedBalance = globalEquity - totalUnrealizedPnl;
        const snapshot = {
            id: `${userUid}-${exchange}-${currentSnapshot.toISOString()}`,
            userUid,
            timestamp: currentSnapshot.toISOString(),
            exchange,
            totalEquity: globalEquity,
            realizedBalance: totalRealizedBalance,
            unrealizedPnL: totalUnrealizedPnl,
            deposits: 0,
            withdrawals: 0,
            breakdown_by_market: breakdown,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await this.snapshotDataRepo.upsertSnapshotData(snapshot);
    }
    async backfillIbkrHistoricalSnapshots(userUid, exchange) {
        if (exchange !== 'ibkr') {
            return;
        }
        try {
            const connections = (await this.connectionRepo.getConnectionsByUser(userUid)) ?? [];
            const connection = connections.find(c => c.exchange === exchange && c.isActive);
            if (!connection) {
                return;
            }
            const credentials = await this.connectionRepo.getDecryptedCredentials(connection.id);
            if (!credentials) {
                return;
            }
            const connector = this.connectorCache.getOrCreate(exchange, credentials);
            if (!connector.getHistoricalSummaries) {
                return;
            }
            const historicalData = await connector.getHistoricalSummaries(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
            if (!historicalData || historicalData.length === 0) {
                return;
            }
            let processedCount = 0, skippedCount = 0;
            for (const entry of historicalData) {
                const globalEquity = entry.breakdown?.global?.equity || entry.breakdown?.global?.totalEquityUsd || 0;
                const unrealizedPnl = entry.breakdown?.global?.unrealizedPnl || 0;
                const realizedBalance = globalEquity - unrealizedPnl;
                if (globalEquity === 0) {
                    skippedCount++;
                    continue;
                }
                const year = parseInt(entry.date.substring(0, 4));
                const month = parseInt(entry.date.substring(4, 6)) - 1;
                const day = parseInt(entry.date.substring(6, 8));
                const snapshotDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
                await this.snapshotDataRepo.upsertSnapshotData({
                    userUid,
                    exchange,
                    timestamp: snapshotDate.toISOString(),
                    totalEquity: globalEquity,
                    realizedBalance: realizedBalance,
                    unrealizedPnL: unrealizedPnl,
                    deposits: 0,
                    withdrawals: 0,
                    breakdown_by_market: entry.breakdown
                });
                processedCount++;
            }
            logger.info(`IBKR historical backfill completed for ${userUid}: ${processedCount} daily snapshots created, ${skippedCount} days skipped`);
        }
        catch (error) {
            logger.error(`Failed to backfill IBKR historical snapshots for ${userUid}`, error);
            throw error;
        }
    }
};
exports.EquitySnapshotAggregator = EquitySnapshotAggregator;
exports.EquitySnapshotAggregator = EquitySnapshotAggregator = __decorate([
    (0, tsyringe_1.injectable)(),
    __param(0, (0, tsyringe_1.inject)(snapshot_data_repository_1.SnapshotDataRepository)),
    __param(1, (0, tsyringe_1.inject)(exchange_connection_repository_1.ExchangeConnectionRepository)),
    __param(2, (0, tsyringe_1.inject)(user_repository_1.UserRepository)),
    __param(3, (0, tsyringe_1.inject)(universal_connector_cache_service_1.UniversalConnectorCacheService)),
    __metadata("design:paramtypes", [snapshot_data_repository_1.SnapshotDataRepository,
        exchange_connection_repository_1.ExchangeConnectionRepository,
        user_repository_1.UserRepository,
        universal_connector_cache_service_1.UniversalConnectorCacheService])
], EquitySnapshotAggregator);
//# sourceMappingURL=equity-snapshot-aggregator.js.map