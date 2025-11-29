"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RestBrokerConnector = void 0;
const BaseExchangeConnector_1 = require("./BaseExchangeConnector");
class RestBrokerConnector extends BaseExchangeConnector_1.BaseExchangeConnector {
    defaultCurrency = 'USD';
    supportsFeature(feature) {
        const brokerSupported = [
            'positions',
            'trades',
            'historical_data',
        ];
        return brokerSupported.includes(feature);
    }
    async makeRequest(method, endpoint, params) {
        const headers = await this.getAuthHeaders();
        const url = `${this.apiBaseUrl}${endpoint}`;
        let fullUrl = url;
        if (method === 'GET' && params) {
            const queryString = new URLSearchParams(Object.entries(params).reduce((acc, [key, value]) => {
                acc[key] = String(value);
                return acc;
            }, {})).toString();
            fullUrl = `${url}?${queryString}`;
        }
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        };
        if ((method === 'POST' || method === 'PUT') && params) {
            options.body = JSON.stringify(params);
        }
        const response = await fetch(fullUrl, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorText}`);
        }
        if (response.status === 204) {
            return {};
        }
        return (await response.json());
    }
    isoStringToDate(isoString) {
        return new Date(isoString);
    }
    dateToIsoString(date) {
        return date.toISOString();
    }
    parseBrokerError(error) {
        const errorObj = error;
        if (errorObj.response?.data?.message) {
            return errorObj.response.data.message;
        }
        if (errorObj.message) {
            return errorObj.message;
        }
        return 'Unknown broker error';
    }
}
exports.RestBrokerConnector = RestBrokerConnector;
//# sourceMappingURL=RestBrokerConnector.js.map