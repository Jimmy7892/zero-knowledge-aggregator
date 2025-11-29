"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoExchangeConnector = void 0;
const BaseExchangeConnector_1 = require("./BaseExchangeConnector");
class CryptoExchangeConnector extends BaseExchangeConnector_1.BaseExchangeConnector {
    defaultCurrency = 'USDT';
    supportsFeature(feature) {
        const cryptoSupported = [
            'positions',
            'trades',
            'historical_data',
        ];
        return cryptoSupported.includes(feature);
    }
    timestampToDate(timestamp) {
        return new Date(timestamp);
    }
    dateToTimestamp(date) {
        return date.getTime();
    }
}
exports.CryptoExchangeConnector = CryptoExchangeConnector;
//# sourceMappingURL=CryptoExchangeConnector.js.map