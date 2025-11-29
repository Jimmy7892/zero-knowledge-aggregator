"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IbkrFlexService = void 0;
const tsyringe_1 = require("tsyringe");
const axios_1 = __importDefault(require("axios"));
const xml2js_1 = require("xml2js");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('IbkrFlexService');
let IbkrFlexService = class IbkrFlexService {
    baseUrl = 'https://ndcdyn.interactivebrokers.com/Universal/servlet';
    flexCache = new Map();
    CACHE_TTL_MS = 30 * 60 * 1000;
    async requestFlexReport(token, queryId) {
        const startTime = Date.now();
        try {
            logger.info('Requesting Flex report', { queryId });
            const response = await axios_1.default.get(`${this.baseUrl}/FlexStatementService.SendRequest`, {
                params: { t: token, q: queryId, v: '3' },
                timeout: 30000,
            });
            const parsed = await (0, xml2js_1.parseStringPromise)(response.data);
            if (parsed.FlexStatementResponse?.Status?.[0] === 'Fail') {
                const errorCode = parsed.FlexStatementResponse?.ErrorCode?.[0];
                const errorMessage = parsed.FlexStatementResponse?.ErrorMessage?.[0];
                throw new Error(`Flex API Error ${errorCode}: ${errorMessage}`);
            }
            const referenceCode = parsed.FlexStatementResponse?.ReferenceCode?.[0];
            if (!referenceCode) {
                throw new Error('No reference code received from Flex API');
            }
            const duration = ((Date.now() - startTime) / 1000).toFixed(3);
            logger.info(`Flex report requested successfully (${duration}s)`, { referenceCode });
            return referenceCode;
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to request Flex report', error);
            throw new Error(`Flex request failed: ${errorMessage}`);
        }
    }
    async getFlexStatement(token, referenceCode) {
        const startTime = Date.now();
        try {
            logger.info('Retrieving Flex statement', { referenceCode });
            const maxRetries = 20;
            const retryDelay = 3000;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const response = await axios_1.default.get(`${this.baseUrl}/FlexStatementService.GetStatement`, {
                    params: { t: token, q: referenceCode, v: '3' },
                    timeout: 30000,
                });
                const xmlData = response.data;
                if (xmlData.includes('<FlexQueryResponse')) {
                    const duration = ((Date.now() - startTime) / 1000).toFixed(3);
                    logger.info(`Flex statement retrieved successfully after ${attempt} attempts (${duration}s)`);
                    return xmlData;
                }
                const parsed = await (0, xml2js_1.parseStringPromise)(xmlData);
                const status = parsed.FlexStatementResponse?.Status?.[0];
                if (status === 'Success') {
                    const duration = ((Date.now() - startTime) / 1000).toFixed(3);
                    logger.info(`Flex statement retrieved successfully after ${attempt} attempts (${duration}s)`);
                    return xmlData;
                }
                else if (status === 'Fail') {
                    const errorCode = parsed.FlexStatementResponse?.ErrorCode?.[0];
                    const errorMessage = parsed.FlexStatementResponse?.ErrorMessage?.[0];
                    if (errorCode === '1019' && attempt < maxRetries) {
                        logger.info(`Statement not ready, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    }
                    throw new Error(`Flex API Error ${errorCode}: ${errorMessage}`);
                }
            }
            throw new Error('Flex statement generation timeout - report not ready after retries');
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to get Flex statement', error);
            throw new Error(`Flex retrieval failed: ${errorMessage}`);
        }
    }
    async parseTrades(xmlData) {
        try {
            const parsed = await (0, xml2js_1.parseStringPromise)(xmlData);
            const tradesList = parsed.FlexQueryResponse?.FlexStatements?.[0]?.FlexStatement?.[0]?.Trades?.[0]?.Trade;
            if (!tradesList || tradesList.length === 0) {
                logger.info('No trades found in Flex report');
                return [];
            }
            return tradesList.map((trade) => {
                const attrs = trade.$;
                return {
                    symbol: attrs.symbol || '',
                    tradeID: attrs.tradeID || '',
                    ibOrderID: attrs.ibOrderID || '',
                    tradeDate: attrs.tradeDate || '',
                    tradeTime: attrs.tradeTime || '',
                    buySell: attrs.buySell === 'BUY' ? 'BUY' : 'SELL',
                    quantity: parseFloat(attrs.quantity || '0'),
                    tradePrice: parseFloat(attrs.tradePrice || '0'),
                    ibCommission: parseFloat(attrs.ibCommission || '0'),
                    ibCommissionCurrency: attrs.ibCommissionCurrency || 'USD',
                    netCash: parseFloat(attrs.netCash || '0'),
                    closePrice: parseFloat(attrs.closePrice || '0'),
                    fifoPnlRealized: parseFloat(attrs.fifoPnlRealized || '0'),
                    assetCategory: attrs.assetCategory || 'STK',
                };
            });
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to parse trades from Flex report', error);
            throw new Error(`Trade parsing failed: ${errorMessage}`);
        }
    }
    async parsePositions(xmlData) {
        try {
            const parsed = await (0, xml2js_1.parseStringPromise)(xmlData);
            const positionsList = parsed.FlexQueryResponse?.FlexStatements?.[0]?.FlexStatement?.[0]?.OpenPositions?.[0]?.OpenPosition;
            if (!positionsList || positionsList.length === 0) {
                logger.info('No positions found in Flex report');
                return [];
            }
            return positionsList.map((position) => {
                const attrs = position.$;
                return {
                    symbol: attrs.symbol || '',
                    position: parseFloat(attrs.position || '0'),
                    markPrice: parseFloat(attrs.markPrice || '0'),
                    positionValue: parseFloat(attrs.positionValue || '0'),
                    openPrice: parseFloat(attrs.openPrice || '0'),
                    costBasisPrice: parseFloat(attrs.costBasisPrice || '0'),
                    fifoPnlUnrealized: parseFloat(attrs.fifoPnlUnrealized || '0'),
                };
            });
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to parse positions from Flex report', error);
            throw new Error(`Position parsing failed: ${errorMessage}`);
        }
    }
    async parseCashTransactions(xmlData) {
        try {
            const parsed = await (0, xml2js_1.parseStringPromise)(xmlData);
            const cashList = parsed.FlexQueryResponse?.FlexStatements?.[0]?.FlexStatement?.[0]?.CashTransactions?.[0]?.CashTransaction;
            if (!cashList || cashList.length === 0) {
                logger.info('No cash transactions found in Flex report');
                return [];
            }
            return cashList.map((cash) => {
                const attrs = cash.$;
                return {
                    symbol: attrs.symbol || '',
                    date: attrs.dateTime || attrs.reportDate || '',
                    type: attrs.type || '',
                    amount: parseFloat(attrs.amount || '0'),
                    currency: attrs.currency || 'USD',
                    description: attrs.description || '',
                };
            });
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to parse cash transactions from Flex report', error);
            throw new Error(`Cash transaction parsing failed: ${errorMessage}`);
        }
    }
    async parseAccountSummary(xmlData) {
        try {
            const parsed = await (0, xml2js_1.parseStringPromise)(xmlData);
            const flexStatement = parsed.FlexQueryResponse?.FlexStatements?.[0]?.FlexStatement?.[0];
            if (!flexStatement) {
                return [];
            }
            logger.info('IBKR FlexStatement structure:', {
                keys: Object.keys(flexStatement),
                hasEquitySummaryByReportDateInBase: !!flexStatement.EquitySummaryByReportDateInBase,
                hasEquitySummaryInBase: !!flexStatement.EquitySummaryInBase
            });
            let dataList = flexStatement.EquitySummaryByReportDateInBase
                || flexStatement.AccountInformation?.[0]?.AccountInformation;
            if (!dataList && flexStatement.EquitySummaryInBase) {
                dataList = flexStatement.EquitySummaryInBase[0]?.EquitySummaryByReportDateInBase;
            }
            if (!dataList || dataList.length === 0) {
                logger.info('No account summary data found in Flex report');
                return [];
            }
            const firstEntry = dataList[0]?.$;
            const lastEntry = dataList[dataList.length - 1]?.$;
            logger.info('IBKR Data Range:', {
                totalEntries: dataList.length,
                firstDate: firstEntry?.reportDate,
                lastDate: lastEntry?.reportDate,
                lastTotal: lastEntry?.total,
                lastCash: lastEntry?.cash
            });
            return dataList.map((info, index) => {
                const attrs = info.$;
                if (index === dataList.length - 1) {
                    logger.info('IBKR EquitySummary attributes (latest entry):', { attrs });
                }
                const netLiquidation = parseFloat(attrs.total || attrs.netLiquidation || attrs.netLiquidationValue || attrs.equityWithLoanValue || attrs.equity || '0');
                return {
                    date: attrs.reportDate || attrs.toDate || '',
                    cash: parseFloat(attrs.cash || '0'),
                    stockValue: parseFloat(attrs.stock || attrs.stockMarketValue || '0'),
                    optionValue: parseFloat(attrs.options || attrs.optionMarketValue || '0'),
                    commodityValue: parseFloat(attrs.commodities || attrs.commodityOptions || attrs.commodityMarketValue || '0'),
                    netLiquidationValue: netLiquidation,
                    unrealizedPnL: parseFloat(attrs.forexCfdUnrealizedPl || attrs.unrealizedPnL || '0'),
                    realizedPnL: parseFloat(attrs.realizedPnL || '0'),
                };
            });
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Failed to parse account summary from Flex report', error);
            throw new Error(`Account summary parsing failed: ${errorMessage}`);
        }
    }
    async testConnection(token, queryId) {
        try {
            const referenceCode = await this.requestFlexReport(token, queryId);
            await this.getFlexStatement(token, referenceCode);
            logger.info('Flex connection test successful');
            return true;
        }
        catch (error) {
            logger.error('Flex connection test failed', error);
            return false;
        }
    }
    async getFlexDataCached(token, queryId) {
        const cacheKey = `${token}:${queryId}`;
        const now = Date.now();
        const cached = this.flexCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
            const age = Math.round((now - cached.timestamp) / 1000);
            logger.debug(`Flex cache HIT (age: ${age}s)`, { queryId });
            return cached.xmlData;
        }
        logger.debug('Flex cache MISS - fetching from API', { queryId });
        const referenceCode = await this.requestFlexReport(token, queryId);
        const xmlData = await this.getFlexStatement(token, referenceCode);
        this.flexCache.set(cacheKey, { xmlData, timestamp: now });
        for (const [key, value] of this.flexCache.entries()) {
            if (now - value.timestamp > 60 * 60 * 1000) {
                this.flexCache.delete(key);
            }
        }
        logger.debug('Flex data cached', { queryId, cacheSize: this.flexCache.size });
        return xmlData;
    }
};
exports.IbkrFlexService = IbkrFlexService;
exports.IbkrFlexService = IbkrFlexService = __decorate([
    (0, tsyringe_1.injectable)()
], IbkrFlexService);
//# sourceMappingURL=ibkr-flex-service.js.map