"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IbkrFlexConnector = void 0;
const BaseExchangeConnector_1 = require("../external/base/BaseExchangeConnector");
const ibkr_flex_service_1 = require("../external/ibkr-flex-service");
class IbkrFlexConnector extends BaseExchangeConnector_1.BaseExchangeConnector {
    flexService;
    flexToken;
    queryId;
    constructor(credentials, flexService) {
        super(credentials);
        if (!credentials.apiKey || !credentials.apiSecret) {
            throw new Error('IBKR Flex requires apiKey (token) and apiSecret (queryId)');
        }
        this.flexToken = credentials.apiKey;
        this.queryId = credentials.apiSecret;
        this.flexService = flexService || new ibkr_flex_service_1.IbkrFlexService();
    }
    getExchangeName() {
        return 'ibkr';
    }
    supportsFeature(feature) {
        const supported = ['positions', 'trades', 'historical_data'];
        return supported.includes(feature);
    }
    async fetchFlexData(parser) {
        const xmlData = await this.flexService.getFlexDataCached(this.flexToken, this.queryId);
        return await parser(xmlData);
    }
    async getBalance() {
        return this.withErrorHandling('getBalance', async () => {
            const summaries = await this.fetchFlexData(xml => this.flexService.parseAccountSummary(xml));
            if (summaries.length === 0) {
                throw new Error('No account data found in Flex report');
            }
            summaries.sort((a, b) => a.date.localeCompare(b.date));
            const latest = summaries[summaries.length - 1];
            return this.createBalanceData(latest.cash, latest.netLiquidationValue, 'USD');
        });
    }
    async getHistoricalSummaries() {
        return this.withErrorHandling('getHistoricalSummaries', async () => {
            const [summaries, trades] = await Promise.all([
                this.fetchFlexData(xml => this.flexService.parseAccountSummary(xml)),
                this.fetchFlexData(xml => this.flexService.parseTrades(xml))
            ]);
            if (summaries.length === 0) {
                return [];
            }
            const tradesByDate = this.groupTradesByDate(trades);
            return summaries.map(summary => ({
                date: summary.date,
                breakdown: this.mapSummaryToBreakdown(summary, tradesByDate.get(summary.date))
            }));
        });
    }
    groupTradesByDate(trades) {
        const tradesByDate = new Map();
        const createEmptyMetrics = () => ({
            stocks: { volume: 0, count: 0, fees: 0 },
            options: { volume: 0, count: 0, fees: 0 },
            futures_commodities: { volume: 0, count: 0, fees: 0 },
            cfd: { volume: 0, count: 0, fees: 0 },
            forex: { volume: 0, count: 0, fees: 0 },
            total: { volume: 0, count: 0, fees: 0 }
        });
        for (const trade of trades) {
            const date = trade.tradeDate;
            const volume = Math.abs(trade.quantity * trade.tradePrice);
            const fees = Math.abs(trade.ibCommission || 0);
            if (!tradesByDate.has(date)) {
                tradesByDate.set(date, createEmptyMetrics());
            }
            const dayMetrics = tradesByDate.get(date);
            const category = trade.assetCategory?.toUpperCase() || 'STK';
            let marketType;
            switch (category) {
                case 'STK':
                    marketType = 'stocks';
                    break;
                case 'OPT':
                    marketType = 'options';
                    break;
                case 'FUT':
                case 'FOP':
                case 'CMDTY':
                    marketType = 'futures_commodities';
                    break;
                case 'CFD':
                    marketType = 'cfd';
                    break;
                case 'CASH':
                    marketType = 'forex';
                    break;
                default: marketType = 'stocks';
            }
            const categoryMetrics = dayMetrics[marketType];
            if (categoryMetrics) {
                categoryMetrics.volume += volume;
                categoryMetrics.count += 1;
                categoryMetrics.fees += fees;
            }
            dayMetrics.total.volume += volume;
            dayMetrics.total.count += 1;
            dayMetrics.total.fees += fees;
        }
        return tradesByDate;
    }
    mapSummaryToBreakdown(summary, tradeMetrics) {
        const getMetrics = (key) => tradeMetrics?.[key] || { volume: 0, count: 0, fees: 0 };
        const totalMetrics = getMetrics('total');
        return {
            global: {
                equity: summary.netLiquidationValue,
                available_margin: summary.cash,
                volume: totalMetrics.volume,
                trades: totalMetrics.count,
                trading_fees: totalMetrics.fees,
                funding_fees: 0
            },
            stocks: {
                equity: summary.stockValue,
                available_margin: 0,
                volume: getMetrics('stocks').volume,
                trades: getMetrics('stocks').count,
                trading_fees: getMetrics('stocks').fees,
                funding_fees: 0
            },
            options: {
                equity: summary.optionValue,
                available_margin: 0,
                volume: getMetrics('options').volume,
                trades: getMetrics('options').count,
                trading_fees: getMetrics('options').fees,
                funding_fees: 0
            },
            futures_commodities: {
                equity: summary.commodityValue,
                available_margin: 0,
                volume: getMetrics('futures_commodities').volume,
                trades: getMetrics('futures_commodities').count,
                trading_fees: getMetrics('futures_commodities').fees,
                funding_fees: 0
            },
            cfd: {
                equity: 0,
                available_margin: 0,
                volume: getMetrics('cfd').volume,
                trades: getMetrics('cfd').count,
                trading_fees: getMetrics('cfd').fees,
                funding_fees: 0
            },
            forex: {
                equity: 0,
                available_margin: 0,
                volume: getMetrics('forex').volume,
                trades: getMetrics('forex').count,
                trading_fees: getMetrics('forex').fees,
                funding_fees: 0
            }
        };
    }
    async getBalanceBreakdown() {
        return this.withErrorHandling('getBalanceBreakdown', async () => {
            const [summaries, trades] = await Promise.all([
                this.fetchFlexData(xml => this.flexService.parseAccountSummary(xml)),
                this.fetchFlexData(xml => this.flexService.parseTrades(xml))
            ]);
            if (summaries.length === 0) {
                throw new Error('No account data found in Flex report');
            }
            summaries.sort((a, b) => a.date.localeCompare(b.date));
            const latest = summaries[summaries.length - 1];
            const tradesByDate = this.groupTradesByDate(trades);
            return this.mapSummaryToBreakdown(latest, tradesByDate.get(latest.date));
        });
    }
    async getCurrentPositions() {
        return this.withErrorHandling('getCurrentPositions', async () => {
            const flexPositions = await this.fetchFlexData(xml => this.flexService.parsePositions(xml));
            return flexPositions.map(pos => {
                const side = pos.position > 0 ? 'long' : 'short';
                return {
                    symbol: pos.symbol, side: side, size: Math.abs(pos.position),
                    entryPrice: pos.costBasisPrice, markPrice: pos.markPrice,
                    unrealizedPnl: pos.fifoPnlUnrealized, realizedPnl: 0, leverage: 1,
                };
            });
        });
    }
    async getTrades(startDate, endDate) {
        return this.withErrorHandling('getTrades', async () => {
            const flexTrades = await this.fetchFlexData(xml => this.flexService.parseTrades(xml));
            return flexTrades
                .filter(trade => this.isInDateRange(new Date(trade.tradeDate), startDate, endDate))
                .map(trade => ({
                tradeId: trade.tradeID, symbol: trade.symbol,
                side: trade.buySell === 'BUY' ? 'buy' : 'sell',
                quantity: Math.abs(trade.quantity), price: trade.tradePrice,
                fee: Math.abs(trade.ibCommission), feeCurrency: trade.ibCommissionCurrency,
                timestamp: this.parseFlexDateTime(trade.tradeDate, trade.tradeTime),
                orderId: trade.ibOrderID, realizedPnl: trade.fifoPnlRealized,
            }));
        });
    }
    async testConnection() {
        try {
            const isValid = await this.flexService.testConnection(this.flexToken, this.queryId);
            if (!isValid) {
                this.logger.warn('IBKR Flex connection test failed - invalid token or query ID');
            }
            return isValid;
        }
        catch (error) {
            this.logger.error('IBKR Flex connection test error', error);
            return false;
        }
    }
    async getFullFlexReport() {
        return this.withErrorHandling('getFullFlexReport', async () => {
            return await this.fetchFlexData(xml => Promise.resolve(xml));
        });
    }
    parseFlexDateTime(dateStr, timeStr) {
        if (dateStr.includes('-')) {
            return new Date(`${dateStr}T${timeStr}Z`);
        }
        else {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return new Date(`${year}-${month}-${day}T${timeStr}Z`);
        }
    }
}
exports.IbkrFlexConnector = IbkrFlexConnector;
//# sourceMappingURL=IbkrFlexConnector.js.map