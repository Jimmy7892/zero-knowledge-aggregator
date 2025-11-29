"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeConnectorFactory = void 0;
const tsyringe_1 = require("tsyringe");
const CcxtExchangeConnector_1 = require("../../connectors/CcxtExchangeConnector");
const IbkrFlexConnector_1 = require("../../connectors/IbkrFlexConnector");
const AlpacaConnector_1 = require("../../connectors/AlpacaConnector");
const ibkr_flex_service_1 = require("../ibkr-flex-service");
const secure_enclave_logger_1 = require("../../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('ExchangeConnectorFactory');
class ExchangeConnectorFactory {
    static CCXT_EXCHANGES = {
        'binance': 'binance',
        'binance_futures': 'binance',
        'binanceusdm': 'binance',
        'bitget': 'bitget',
        'mexc': 'mexc',
        'okx': 'okx',
        'bybit': 'bybit',
        'kucoin': 'kucoin',
        'coinbase': 'coinbase',
        'gate': 'gate',
        'huobi': 'huobi',
        'kraken': 'kraken',
    };
    static CUSTOM_BROKERS = ['ibkr', 'alpaca'];
    static create(credentials) {
        const exchange = credentials.exchange.toLowerCase();
        logger.info(`Creating connector for exchange: ${exchange}`);
        if (this.CUSTOM_BROKERS.includes(exchange)) {
            return this.createCustomBrokerConnector(exchange, credentials);
        }
        const ccxtExchangeId = this.CCXT_EXCHANGES[exchange];
        if (ccxtExchangeId) {
            logger.info(`Using CCXT connector for ${exchange} (CCXT ID: ${ccxtExchangeId})`);
            return new CcxtExchangeConnector_1.CcxtExchangeConnector(ccxtExchangeId, credentials);
        }
        const error = `Unsupported exchange: ${exchange}. Supported: ${this.getSupportedExchanges().join(', ')}`;
        logger.error(error);
        throw new Error(error);
    }
    static createCustomBrokerConnector(exchange, credentials) {
        switch (exchange) {
            case 'ibkr': {
                const flexService = tsyringe_1.container.resolve(ibkr_flex_service_1.IbkrFlexService);
                logger.info('Injecting shared IbkrFlexService singleton into connector');
                return new IbkrFlexConnector_1.IbkrFlexConnector(credentials, flexService);
            }
            case 'alpaca':
                return new AlpacaConnector_1.AlpacaConnector(credentials);
            default:
                throw new Error(`Custom broker ${exchange} not implemented`);
        }
    }
    static getSupportedExchanges() {
        const cryptoExchanges = Object.keys(this.CCXT_EXCHANGES);
        const brokers = this.CUSTOM_BROKERS;
        return [...cryptoExchanges, ...brokers];
    }
    static isSupported(exchange) {
        const exchangeLower = exchange.toLowerCase();
        return (Object.hasOwn(this.CCXT_EXCHANGES, exchangeLower) ||
            this.CUSTOM_BROKERS.includes(exchangeLower));
    }
    static isCryptoExchange(exchange) {
        return Object.hasOwn(this.CCXT_EXCHANGES, exchange.toLowerCase());
    }
}
exports.ExchangeConnectorFactory = ExchangeConnectorFactory;
//# sourceMappingURL=ExchangeConnectorFactory.js.map