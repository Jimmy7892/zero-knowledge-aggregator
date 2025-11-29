"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIFIED_ACCOUNT_EXCHANGES = void 0;
exports.isUnifiedAccountExchange = isUnifiedAccountExchange;
exports.getFilteredMarketTypes = getFilteredMarketTypes;
exports.UNIFIED_ACCOUNT_EXCHANGES = ['bitget', 'okx', 'bybit'];
function isUnifiedAccountExchange(exchangeId) {
    return exports.UNIFIED_ACCOUNT_EXCHANGES.includes(exchangeId.toLowerCase());
}
function getFilteredMarketTypes(exchangeId, detectedTypes) {
    if (isUnifiedAccountExchange(exchangeId)) {
        return detectedTypes.filter(t => !['future', 'margin'].includes(t));
    }
    return detectedTypes;
}
//# sourceMappingURL=snapshot-breakdown.js.map