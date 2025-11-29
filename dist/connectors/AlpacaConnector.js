"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaConnector = void 0;
const RestBrokerConnector_1 = require("../external/base/RestBrokerConnector");
const alpaca_api_service_1 = require("../external/alpaca-api-service");
class AlpacaConnector extends RestBrokerConnector_1.RestBrokerConnector {
    api;
    apiBaseUrl = 'https://api.alpaca.markets/v2';
    constructor(credentials) {
        super(credentials);
        if (!credentials.apiKey || !credentials.apiSecret) {
            throw new Error('Alpaca requires apiKey and apiSecret');
        }
        this.api = new alpaca_api_service_1.AlpacaApiService(credentials);
    }
    getExchangeName() {
        return 'alpaca';
    }
    async getAuthHeaders() {
        return {
            'APCA-API-KEY-ID': this.credentials.apiKey,
            'APCA-API-SECRET-KEY': this.credentials.apiSecret,
        };
    }
    async getBalance() {
        return this.withErrorHandling('getBalance', async () => {
            const accountInfo = await this.api.getAccountInfo();
            if (!accountInfo) {
                throw new Error('Failed to fetch Alpaca account info');
            }
            const cash = this.parseFloat(accountInfo.cash);
            const portfolioValue = this.parseFloat(accountInfo.portfolio_value);
            return this.createBalanceData(cash, portfolioValue, accountInfo.currency || this.defaultCurrency);
        });
    }
    async getCurrentPositions() {
        return this.withErrorHandling('getCurrentPositions', async () => {
            const alpacaPositions = await this.api.getCurrentPositions();
            return alpacaPositions.map(pos => {
                const side = pos.side === 'long' ? 'long' : 'short';
                const size = this.parseFloat(pos.qty);
                return {
                    symbol: pos.symbol,
                    side: side,
                    size,
                    entryPrice: this.parseFloat(pos.avg_entry_price || '0'),
                    markPrice: this.parseFloat(pos.current_price || '0'),
                    unrealizedPnl: this.parseFloat(pos.unrealized_pl || '0'),
                    realizedPnl: 0,
                    leverage: 1,
                    assetClass: pos.asset_class,
                };
            });
        });
    }
    async getTrades(startDate, endDate) {
        return this.withErrorHandling('getTrades', async () => {
            const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            const activities = await this.api.getTradeHistory(daysDiff);
            return activities
                .filter(activity => {
                const activityDate = new Date(activity.transaction_time);
                return this.isInDateRange(activityDate, startDate, endDate);
            })
                .map(activity => ({
                tradeId: activity.transaction_time,
                symbol: activity.symbol || '',
                side: activity.side === 'buy' ? 'buy' : 'sell',
                quantity: this.parseFloat(activity.qty || '0'),
                price: this.parseFloat(activity.price || '0'),
                fee: 0,
                feeCurrency: this.defaultCurrency,
                timestamp: new Date(activity.transaction_time),
                orderId: '',
                realizedPnl: this.parseFloat(activity.net_amount || '0'),
            }));
        });
    }
    async testConnection() {
        try {
            const isConnected = await this.api.testConnection();
            if (!isConnected) {
                this.logger.warn('Alpaca connection test failed');
            }
            return isConnected;
        }
        catch (error) {
            this.logger.error('Alpaca connection test error', error);
            return false;
        }
    }
}
exports.AlpacaConnector = AlpacaConnector;
//# sourceMappingURL=AlpacaConnector.js.map