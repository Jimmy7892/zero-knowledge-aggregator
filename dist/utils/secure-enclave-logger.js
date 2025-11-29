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
var SecureEnclaveLogger_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.SecureEnclaveLogger = exports.LogLevel = void 0;
exports.registerSSEBroadcast = registerSSEBroadcast;
exports.getLogBuffer = getLogBuffer;
exports.clearLogBuffer = clearLogBuffer;
exports.getLogger = getLogger;
exports.setLogLevel = setLogLevel;
exports.getLogLevel = getLogLevel;
exports.extractErrorMessage = extractErrorMessage;
const tsyringe_1 = require("tsyringe");
var LogLevel;
(function (LogLevel) {
    LogLevel["ERROR"] = "ERROR";
    LogLevel["WARN"] = "WARN";
    LogLevel["INFO"] = "INFO";
    LogLevel["DEBUG"] = "DEBUG";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
const TIER1_SENSITIVE_PATTERNS = [
    /^api[-_]?key$/i,
    /^api[-_]?secret$/i,
    /^access[-_]?key$/i,
    /^secret[-_]?key$/i,
    /^password$/i,
    /^passwd$/i,
    /^pwd$/i,
    /^token$/i,
    /^access[-_]?token$/i,
    /^refresh[-_]?token$/i,
    /^bearer[-_]?token$/i,
    /^jwt$/i,
    /^encryption[-_]?key$/i,
    /^private[-_]?key$/i,
    /^secret$/i,
    /^auth$/i,
    /^authorization$/i,
    /^credentials$/i,
    /^passphrase$/i,
    /encrypted/i,
];
const TIER2_BUSINESS_PATTERNS = [
    /^user[-_]?uid$/i,
    /^user[-_]?id$/i,
    /^account[-_]?id$/i,
    /^customer[-_]?id$/i,
    /^exchange$/i,
    /^exchange[-_]?name$/i,
    /^broker$/i,
    /^platform$/i,
    /balance/i,
    /equity/i,
    /amount/i,
    /^value$/i,
    /^price$/i,
    /^total/i,
    /pnl/i,
    /profit/i,
    /loss/i,
    /fee/i,
    /commission/i,
    /deposit/i,
    /withdrawal/i,
    /^trade/i,
    /^position/i,
    /^order/i,
    /^quantity/i,
    /^size$/i,
    /^volume$/i,
    /^synced$/i,
    /^count$/i,
    /^num/i,
    /^name$/i,
    /^email$/i,
    /^phone$/i,
    /^address$/i,
    /^ssn$/i,
    /^tax[-_]?id$/i,
];
function isTier1Sensitive(fieldName) {
    return TIER1_SENSITIVE_PATTERNS.some(pattern => pattern.test(fieldName));
}
function isTier2Sensitive(fieldName) {
    return TIER2_BUSINESS_PATTERNS.some(pattern => pattern.test(fieldName));
}
function shouldRedactField(fieldName) {
    return isTier1Sensitive(fieldName) || isTier2Sensitive(fieldName);
}
function filterSensitiveData(data) {
    if (data === null || data === undefined) {
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => filterSensitiveData(item));
    }
    if (typeof data === 'object') {
        const filtered = {};
        for (const [key, value] of Object.entries(data)) {
            if (shouldRedactField(key)) {
                filtered[key] = '[REDACTED]';
            }
            else {
                filtered[key] = filterSensitiveData(value);
            }
        }
        return filtered;
    }
    return data;
}
let globalLogLevel = LogLevel.INFO;
const envLogLevel = process.env.LOG_LEVEL?.toUpperCase();
if (envLogLevel && envLogLevel in LogLevel) {
    globalLogLevel = LogLevel[envLogLevel];
}
const LOG_LEVEL_PRIORITY = {
    [LogLevel.ERROR]: 0,
    [LogLevel.WARN]: 1,
    [LogLevel.INFO]: 2,
    [LogLevel.DEBUG]: 3,
};
function shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[globalLogLevel];
}
const MAX_LOG_BUFFER_SIZE = 500;
const logBuffer = [];
let sseBroadcastCallback = null;
function registerSSEBroadcast(callback) {
    sseBroadcastCallback = callback;
}
function addLogToBuffer(logEntry) {
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
        logBuffer.shift();
    }
    if (sseBroadcastCallback) {
        sseBroadcastCallback(logEntry);
    }
}
function getLogBuffer() {
    return [...logBuffer];
}
function clearLogBuffer() {
    logBuffer.length = 0;
}
console.log('[Logger] Enclave log SSE streaming ENABLED (always active for deterministic auditing)');
console.log('[Logger] ⚠️  TIER 1 (credentials) + TIER 2 (business data) redaction ACTIVE');
console.log('[Logger] ⚠️  NO user IDs, amounts, or sensitive data will be exposed');
let SecureEnclaveLogger = SecureEnclaveLogger_1 = class SecureEnclaveLogger {
    context;
    constructor(context = 'Enclave') {
        this.context = context;
    }
    emit(level, message, metadata) {
        if (!shouldLog(level)) {
            return;
        }
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            context: this.context,
            message,
            enclave: true,
        };
        if (metadata && Object.keys(metadata).length > 0) {
            entry.metadata = filterSensitiveData(metadata);
        }
        const jsonLog = JSON.stringify(entry);
        if (level === LogLevel.ERROR) {
            process.stderr.write(jsonLog + '\n');
        }
        else {
            process.stdout.write(jsonLog + '\n');
        }
        addLogToBuffer(jsonLog);
    }
    error(message, error, metadata) {
        const enrichedMeta = { ...metadata };
        if (error instanceof Error) {
            enrichedMeta.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }
        else if (error) {
            enrichedMeta.error = String(error);
        }
        this.emit(LogLevel.ERROR, message, enrichedMeta);
    }
    warn(message, metadata) {
        this.emit(LogLevel.WARN, message, metadata);
    }
    info(message, metadata) {
        this.emit(LogLevel.INFO, message, metadata);
    }
    debug(message, metadata) {
        this.emit(LogLevel.DEBUG, message, metadata);
    }
    child(childContext) {
        return new SecureEnclaveLogger_1(`${this.context}.${childContext}`);
    }
};
exports.SecureEnclaveLogger = SecureEnclaveLogger;
exports.SecureEnclaveLogger = SecureEnclaveLogger = SecureEnclaveLogger_1 = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [String])
], SecureEnclaveLogger);
function getLogger(context) {
    return new SecureEnclaveLogger(context);
}
function setLogLevel(level) {
    globalLogLevel = level;
}
function getLogLevel() {
    return globalLogLevel;
}
function extractErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
exports.logger = new SecureEnclaveLogger('Enclave');
//# sourceMappingURL=secure-enclave-logger.js.map