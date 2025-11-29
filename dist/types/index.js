"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeStatus = exports.TradeType = void 0;
var TradeType;
(function (TradeType) {
    TradeType["BUY"] = "buy";
    TradeType["SELL"] = "sell";
})(TradeType || (exports.TradeType = TradeType = {}));
var TradeStatus;
(function (TradeStatus) {
    TradeStatus["PENDING"] = "pending";
    TradeStatus["MATCHED"] = "matched";
    TradeStatus["PARTIALLY_MATCHED"] = "partially_matched";
})(TradeStatus || (exports.TradeStatus = TradeStatus = {}));
//# sourceMappingURL=index.js.map