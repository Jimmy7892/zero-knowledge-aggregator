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
exports.AlpacaApiService = void 0;
const tsyringe_1 = require("tsyringe");
const alpaca_trade_api_1 = __importDefault(require("@alpacahq/alpaca-trade-api"));
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('AlpacaApiService');
let AlpacaApiService = class AlpacaApiService {
    alpaca;
    isPaper;
    constructor(credentials) {
        this.isPaper = credentials.apiKey.startsWith('PK');
        this.alpaca = new alpaca_trade_api_1.default({
            keyId: credentials.apiKey,
            secretKey: credentials.apiSecret,
            paper: this.isPaper,
            baseUrl: this.isPaper
                ? 'https://paper-api.alpaca.markets'
                : 'https://api.alpaca.markets',
        });
    }
    async testConnection() {
        try {
            await this.alpaca.getAccount();
            return true;
        }
        catch (error) {
            logger.error('Alpaca connection test failed', error);
            return false;
        }
    }
    async getCurrentPositions() {
        try {
            const positions = await this.alpaca.getPositions();
            return positions.map((pos) => ({
                symbol: pos.symbol,
                qty: pos.qty,
                side: pos.side,
                market_value: pos.market_value,
                cost_basis: pos.cost_basis,
                unrealized_pl: pos.unrealized_pl,
                unrealized_plpc: pos.unrealized_plpc,
                current_price: pos.current_price,
                lastday_price: pos.lastday_price || '0',
                change_today: pos.change_today || '0',
            }));
        }
        catch (error) {
            logger.error('Failed to fetch Alpaca positions', error);
            return [];
        }
    }
    async getTradeHistory(days = 90) {
        try {
            const after = new Date();
            after.setDate(after.getDate() - days);
            const activities = await this.alpaca.getAccountActivities({
                activityTypes: 'FILL',
                after: after.toISOString(),
                direction: 'desc',
                pageSize: 500,
            });
            return activities.map((activity) => ({
                id: activity.id,
                activity_type: activity.activity_type,
                transaction_time: activity.transaction_time,
                type: activity.type || '',
                price: activity.price || '0',
                qty: activity.qty || '0',
                side: activity.side || 'buy',
                symbol: activity.symbol || '',
                leaves_qty: activity.leaves_qty || '0',
                order_id: activity.order_id || '',
                cum_qty: activity.cum_qty || '0',
                order_status: activity.order_status || '',
            }));
        }
        catch (error) {
            logger.error('Failed to fetch Alpaca trade history:', error);
            return [];
        }
    }
    async getAccountInfo() {
        try {
            const account = await this.alpaca.getAccount();
            return {
                id: account.id || '',
                account_number: account.account_number,
                status: account.status,
                currency: account.currency,
                buying_power: account.buying_power,
                regt_buying_power: account.regt_buying_power || '',
                daytrading_buying_power: account.daytrading_buying_power || '',
                cash: account.cash,
                portfolio_value: account.portfolio_value,
                pattern_day_trader: account.pattern_day_trader,
                trading_blocked: account.trading_blocked,
                transfers_blocked: account.transfers_blocked,
                account_blocked: account.account_blocked,
                created_at: account.created_at,
                trade_suspended_by_user: account.trade_suspended_by_user,
                multiplier: account.multiplier || '',
                shorting_enabled: account.shorting_enabled || false,
                equity: account.equity || '',
                last_equity: account.last_equity || '',
                long_market_value: account.long_market_value || '',
                short_market_value: account.short_market_value || '',
                initial_margin: account.initial_margin || '',
                maintenance_margin: account.maintenance_margin || '',
                last_maintenance_margin: account.last_maintenance_margin || '',
                sma: account.sma || '',
                daytrade_count: account.daytrade_count || 0,
            };
        }
        catch (error) {
            logger.error('Failed to fetch Alpaca account info:', error);
            return null;
        }
    }
};
exports.AlpacaApiService = AlpacaApiService;
exports.AlpacaApiService = AlpacaApiService = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [Object])
], AlpacaApiService);
//# sourceMappingURL=alpaca-api-service.js.map