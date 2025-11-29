"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseExchangeConnector = void 0;
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
class BaseExchangeConnector {
    logger;
    credentials;
    constructor(credentials) {
        this.credentials = credentials;
        this.logger = (0, secure_enclave_logger_1.getLogger)(this.constructor.name);
    }
    async testConnection() {
        try {
            await this.getBalance();
            this.logger.info(`${this.getExchangeName()}: Connection test successful`);
            return true;
        }
        catch (error) {
            this.logger.error(`${this.getExchangeName()}: Connection test failed`, error);
            return false;
        }
    }
    supportsFeature(feature) {
        const defaultSupported = ['positions', 'trades'];
        return defaultSupported.includes(feature);
    }
    handleError(error, context) {
        const err = error;
        const errorMessage = err?.message || 'Unknown error';
        const fullMessage = `${this.getExchangeName()}: ${context} failed - ${errorMessage}`;
        this.logger.error(fullMessage, {
            context,
            exchange: this.getExchangeName(),
            error: {
                name: err?.name,
                message: errorMessage,
                stack: err?.stack,
            },
        });
        throw new Error(fullMessage);
    }
    async withErrorHandling(context, fn) {
        try {
            return await fn();
        }
        catch (error) {
            this.handleError(error, context);
        }
    }
    createBalanceData(balance, equity, currency = 'USDT') {
        return {
            balance,
            equity,
            unrealizedPnl: equity - balance,
            currency,
        };
    }
    toDate(timestamp) {
        if (typeof timestamp === 'string') {
            return new Date(timestamp);
        }
        return new Date(timestamp);
    }
    isInDateRange(date, startDate, endDate) {
        return date >= startDate && date <= endDate;
    }
    parseFloat(value) {
        if (typeof value === 'number') {
            return value;
        }
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.BaseExchangeConnector = BaseExchangeConnector;
//# sourceMappingURL=BaseExchangeConnector.js.map