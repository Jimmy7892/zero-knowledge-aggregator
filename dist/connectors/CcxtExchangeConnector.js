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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CcxtExchangeConnector = void 0;
const ccxt = __importStar(require("ccxt"));
const CryptoExchangeConnector_1 = require("../external/base/CryptoExchangeConnector");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const snapshot_breakdown_1 = require("../types/snapshot-breakdown");
class CcxtExchangeConnector extends CryptoExchangeConnector_1.CryptoExchangeConnector {
    exchange;
    exchangeName;
    constructor(exchangeId, credentials) {
        super(credentials);
        this.exchangeName = exchangeId;
        const ExchangeClass = ccxt[exchangeId];
        if (!ExchangeClass || typeof ExchangeClass !== 'function') {
            throw new Error(`Exchange '${exchangeId}' not supported by CCXT.`);
        }
        this.exchange = new ExchangeClass({
            apiKey: credentials.apiKey,
            secret: credentials.apiSecret,
            password: credentials.passphrase,
            enableRateLimit: true,
            options: { defaultType: 'future', recvWindow: 10000 },
        });
        this.logger.info(`CCXT connector initialized for ${exchangeId}`);
    }
    getExchangeName() {
        return this.exchangeName;
    }
    async getBalance() {
        return this.withErrorHandling('getBalance', async () => {
            const balance = await this.exchange.fetchBalance();
            const usdtBalance = balance['USDT'] || balance['USD'] || balance.total;
            if (!usdtBalance) {
                this.logger.warn('No USDT/USD balance found, returning zero balance');
                return this.createBalanceData(0, 0, this.defaultCurrency);
            }
            return this.createBalanceData(usdtBalance.free || 0, usdtBalance.total || 0, this.defaultCurrency);
        });
    }
    async getCurrentPositions() {
        return this.withErrorHandling('getCurrentPositions', async () => {
            const positions = await this.exchange.fetchPositions();
            return positions
                .filter(pos => pos.contracts && pos.contracts > 0)
                .map(pos => ({
                symbol: pos.symbol, side: pos.side, size: Math.abs(pos.contracts || 0),
                entryPrice: pos.entryPrice || 0, markPrice: pos.markPrice || 0,
                unrealizedPnl: pos.unrealizedPnl || 0, realizedPnl: 0,
                leverage: pos.leverage || 1, liquidationPrice: pos.liquidationPrice,
                marginType: pos.marginMode,
            }));
        });
    }
    async getTrades(startDate, endDate) {
        return this.withErrorHandling('getTrades', async () => {
            const since = this.dateToTimestamp(startDate);
            const marketTypes = await this.detectMarketTypes();
            const filteredTypes = (0, snapshot_breakdown_1.getFilteredMarketTypes)(this.exchangeName, marketTypes);
            this.logger.info(`Fetching trades from markets: ${filteredTypes.join(', ')}`);
            const allTrades = [];
            for (const marketType of filteredTypes) {
                const originalType = this.exchange.options['defaultType'];
                this.exchange.options['defaultType'] = marketType;
                const symbols = await this.getActiveSymbols(marketType, since);
                for (const symbol of symbols) {
                    try {
                        const symbolTrades = await this.exchange.fetchMyTrades(symbol, since);
                        if (symbolTrades.length > 0) {
                            allTrades.push(...symbolTrades);
                        }
                    }
                    catch {
                    }
                }
                this.exchange.options['defaultType'] = originalType;
            }
            this.logger.info(`Total: ${allTrades.length} trades from ${filteredTypes.length} markets`);
            return allTrades
                .filter(trade => this.isInDateRange(this.timestampToDate(trade.timestamp || 0), startDate, endDate))
                .map(trade => ({
                tradeId: trade.id || `${trade.timestamp}`, symbol: trade.symbol || '', side: trade.side,
                quantity: trade.amount || 0, price: trade.price || 0, fee: trade.fee?.cost || 0,
                feeCurrency: trade.fee?.currency || this.defaultCurrency,
                timestamp: this.timestampToDate(trade.timestamp || 0), orderId: trade.order || '',
                realizedPnl: Number(trade.info?.realizedPnl) || 0,
            }));
        });
    }
    async testConnection() {
        try {
            await this.exchange.fetchBalance();
            this.logger.info(`${this.exchangeName}: CCXT connection test successful`);
            return true;
        }
        catch (error) {
            this.logger.error(`${this.exchangeName}: CCXT connection test failed`, error);
            return false;
        }
    }
    async detectMarketTypes() {
        return this.withErrorHandling('detectMarketTypes', async () => {
            await this.exchange.loadMarkets();
            const marketTypes = new Set();
            for (const [_marketId, market] of Object.entries(this.exchange.markets)) {
                if (market.spot) {
                    marketTypes.add('spot');
                }
                if (market.swap) {
                    marketTypes.add('swap');
                }
                if (market.future) {
                    marketTypes.add('future');
                }
                if (market.option) {
                    marketTypes.add('options');
                }
                if (market.margin) {
                    marketTypes.add('margin');
                }
            }
            const detected = Array.from(marketTypes);
            this.logger.info(`Detected market types for ${this.exchangeName}: ${detected.join(', ')}`);
            return detected;
        });
    }
    async getBalanceByMarket(marketType) {
        return this.withErrorHandling('getBalanceByMarket', async () => {
            if ((0, snapshot_breakdown_1.isUnifiedAccountExchange)(this.exchangeName)) {
                return this.getBalanceForUnifiedAccount(marketType);
            }
            this.exchange.options['defaultType'] = marketType;
            const balance = await this.exchange.fetchBalance();
            const usdtBalance = balance['USDT'] || balance['USD'] || balance['USDC'];
            if (!usdtBalance) {
                return { equity: 0, available_margin: 0 };
            }
            return { equity: usdtBalance.total || 0, available_margin: usdtBalance.free || 0 };
        });
    }
    async getBalanceForUnifiedAccount(marketType) {
        if (marketType === 'spot') {
            this.exchange.options['defaultType'] = 'spot';
            const balance = await this.exchange.fetchBalance({ type: 'spot' });
            let spotEquity = 0;
            for (const [currency, value] of Object.entries(balance)) {
                if (['info', 'free', 'used', 'total', 'debt', 'timestamp', 'datetime'].includes(currency)) {
                    continue;
                }
                const holding = value;
                if (holding && holding.total && Number(holding.total) > 0) {
                    spotEquity += Number(holding.total) || 0;
                }
            }
            this.logger.info(`Spot wallet equity: ${spotEquity.toFixed(2)} USDT`);
            return { equity: spotEquity, available_margin: 0 };
        }
        else if (marketType === 'swap' || marketType === 'future') {
            this.exchange.options['defaultType'] = 'swap';
            const balance = await this.exchange.fetchBalance();
            const usdtBalance = balance['USDT'] || balance['USD'] || balance['USDC'];
            if (!usdtBalance) {
                this.logger.warn(`No USDT balance found in swap/unified account for ${this.exchangeName}`);
                return { equity: 0, available_margin: 0 };
            }
            const equity = usdtBalance.total || 0;
            const availableMargin = usdtBalance.free || 0;
            this.logger.info(`SWAP/Unified account equity: ${equity.toFixed(2)} USDT, margin: ${availableMargin.toFixed(2)} USDT`);
            return { equity, available_margin: availableMargin };
        }
        else {
            return { equity: 0, available_margin: 0 };
        }
    }
    async getExecutedOrders(marketType, since) {
        return this.withErrorHandling('getExecutedOrders', async () => {
            this.exchange.options['defaultType'] = marketType;
            const sinceTimestamp = this.dateToTimestamp(since);
            if (!this.exchange.has['fetchMyTrades']) {
                this.logger.warn(`${this.exchangeName} does not support fetchMyTrades`);
                return [];
            }
            const symbols = await this.getActiveSymbols(marketType, sinceTimestamp);
            if (symbols.length === 0) {
                this.logger.info(`No symbols traded in ${marketType} market`);
                return [];
            }
            this.logger.info(`Fetching trades for ${symbols.length} ${marketType} symbols`);
            const allTrades = [];
            for (const symbol of symbols) {
                try {
                    const symbolTrades = await this.exchange.fetchMyTrades(symbol, sinceTimestamp);
                    if (symbolTrades.length > 0) {
                        allTrades.push(...symbolTrades);
                        this.logger.debug(`${symbol}: ${symbolTrades.length} trades`);
                    }
                }
                catch (error) {
                    this.logger.debug(`${symbol}: no trades or error`);
                }
            }
            this.logger.info(`Total: ${allTrades.length} trades from ${marketType} market`);
            return this.mapTradesToExecutedOrders(allTrades);
        });
    }
    mapTradesToExecutedOrders(trades) {
        return trades.map(trade => ({
            id: trade.id || `${trade.timestamp}`,
            timestamp: trade.timestamp || 0,
            symbol: trade.symbol || '',
            side: trade.side,
            price: trade.price || 0,
            amount: trade.amount || 0,
            cost: trade.cost || (trade.amount || 0) * (trade.price || 0),
            fee: trade.fee ? {
                cost: trade.fee.cost || 0,
                currency: trade.fee.currency || this.defaultCurrency,
            } : undefined,
        }));
    }
    async getActiveSymbols(marketType, since) {
        const symbols = new Set();
        if (this.exchange.has['fetchClosedOrders']) {
            try {
                const closedOrders = await this.exchange.fetchClosedOrders(undefined, since);
                closedOrders.forEach(order => {
                    if (order.symbol)
                        symbols.add(order.symbol);
                });
                this.logger.debug(`Found ${symbols.size} symbols from closed orders`);
            }
            catch (error) {
                this.logger.debug(`fetchClosedOrders without symbol not supported`);
            }
        }
        if (marketType === 'swap' || marketType === 'future') {
            try {
                if (this.exchange.has['fetchPositions']) {
                    const positions = await this.exchange.fetchPositions();
                    positions.forEach(pos => {
                        if (pos.symbol)
                            symbols.add(pos.symbol);
                    });
                }
            }
            catch {
            }
        }
        if (marketType === 'spot') {
            try {
                const balance = await this.exchange.fetchBalance();
                await this.exchange.loadMarkets();
                const totalBalances = balance.total;
                const assets = Object.keys(totalBalances || {}).filter(asset => {
                    const total = totalBalances?.[asset] || 0;
                    return total > 0 && asset !== 'USDT' && asset !== 'USD' && asset !== 'USDC';
                });
                for (const asset of assets) {
                    const pair = `${asset}/USDT`;
                    if (this.exchange.markets[pair])
                        symbols.add(pair);
                }
            }
            catch {
            }
        }
        this.logger.info(`Discovered ${symbols.size} symbols for ${marketType}`);
        return Array.from(symbols);
    }
    async getFundingFees(symbols, since) {
        return this.withErrorHandling('getFundingFees', async () => {
            if (!this.exchange.has['fetchFundingHistory']) {
                this.logger.warn(`${this.exchangeName} does not support fetchFundingHistory`);
                return [];
            }
            const sinceTimestamp = this.dateToTimestamp(since);
            const allFunding = [];
            for (const symbol of symbols) {
                try {
                    const funding = await this.exchange.fetchFundingHistory(symbol, sinceTimestamp);
                    for (const payment of funding) {
                        allFunding.push({
                            timestamp: payment.timestamp || 0,
                            symbol: payment.symbol,
                            amount: payment.amount || 0,
                        });
                    }
                }
                catch (error) {
                    this.logger.warn(`Failed to fetch funding for ${symbol}:`, { error: (0, secure_enclave_logger_1.extractErrorMessage)(error) });
                }
            }
            return allFunding;
        });
    }
    async getEarnBalance() {
        return this.withErrorHandling('getEarnBalance', async () => {
            let earnEquity = 0;
            const earnTypes = ['earn', 'savings', 'funding'];
            for (const earnType of earnTypes) {
                try {
                    const balance = await this.exchange.fetchBalance({ type: earnType });
                    for (const [currency, value] of Object.entries(balance)) {
                        if (['info', 'free', 'used', 'total', 'debt', 'timestamp', 'datetime'].includes(currency)) {
                            continue;
                        }
                        const holding = value;
                        if (holding && holding.total && Number(holding.total) > 0) {
                            if (['USDT', 'USDC', 'USD', 'BUSD', 'DAI'].includes(currency)) {
                                earnEquity += Number(holding.total) || 0;
                            }
                        }
                    }
                    if (earnEquity > 0) {
                        this.logger.info(`Earn balance (${earnType}): ${earnEquity.toFixed(2)} USD`);
                        return { equity: earnEquity, available_margin: 0 };
                    }
                }
                catch (error) {
                    this.logger.debug(`${earnType} balance not available: ${(0, secure_enclave_logger_1.extractErrorMessage)(error)}`);
                }
            }
            if (this.exchangeName.toLowerCase() === 'binance') {
                try {
                    const earnProducts = await this.exchange.sapiGetSimpleEarnFlexiblePosition();
                    if (earnProducts?.rows) {
                        for (const product of earnProducts.rows) {
                            if (['USDT', 'USDC', 'BUSD'].includes(product.asset)) {
                                earnEquity += parseFloat(product.totalAmount || 0);
                            }
                        }
                    }
                }
                catch {
                    this.logger.debug('Binance Simple Earn API not available');
                }
            }
            this.logger.info(`Total earn balance: ${earnEquity.toFixed(2)} USD`);
            return { equity: earnEquity, available_margin: 0 };
        });
    }
}
exports.CcxtExchangeConnector = CcxtExchangeConnector;
//# sourceMappingURL=CcxtExchangeConnector.js.map