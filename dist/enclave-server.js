"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnclaveServer = void 0;
exports.startEnclaveServer = startEnclaveServer;
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const tsyringe_1 = require("tsyringe");
const enclave_worker_1 = require("./enclave-worker");
const secure_enclave_logger_1 = require("./utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('EnclaveServer');
const grpc_schemas_1 = require("./validation/grpc-schemas");
const PROTO_PATH = path_1.default.join(__dirname, 'proto/enclave.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const enclaveProto = grpc.loadPackageDefinition(packageDefinition);
class EnclaveServer {
    server;
    enclaveWorker;
    port;
    constructor() {
        this.server = new grpc.Server();
        this.port = parseInt(process.env.ENCLAVE_PORT || '50051');
        this.enclaveWorker = tsyringe_1.container.resolve(enclave_worker_1.EnclaveWorker);
        this.server.addService(enclaveProto.enclave.EnclaveService.service, {
            ProcessSyncJob: this.processSyncJob.bind(this),
            GetAggregatedMetrics: this.getAggregatedMetrics.bind(this),
            GetSnapshotTimeSeries: this.getSnapshotTimeSeries.bind(this),
            CreateUserConnection: this.createUserConnection.bind(this),
            HealthCheck: this.healthCheck.bind(this)
        });
        logger.info('Enclave gRPC server initialized');
    }
    async processSyncJob(call, callback) {
        try {
            const rawRequest = call.request;
            const request = {
                user_uid: rawRequest.user_uid,
                exchange: rawRequest.exchange === '' ? undefined : rawRequest.exchange,
                type: rawRequest.type || 'incremental'
            };
            const validation = (0, grpc_schemas_1.validateRequest)(grpc_schemas_1.SyncJobRequestSchema, request);
            if (!validation.success) {
                logger.warn('Invalid ProcessSyncJob request', {
                    error: validation.success === false ? validation.error : 'Unknown error',
                    request: { user_uid: request.user_uid, exchange: request.exchange }
                });
                callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: validation.success === false ? validation.error : 'Validation failed'
                }, null);
                return;
            }
            const validated = validation.data;
            logger.info('Processing sync job request', {
                user_uid: validated.user_uid,
                exchange: validated.exchange
            });
            const syncRequest = {
                userUid: validated.user_uid,
                exchange: validated.exchange || undefined
            };
            const result = await this.enclaveWorker.processSyncJob(syncRequest);
            const response = {
                success: result.success,
                user_uid: result.userUid,
                exchange: result.exchange || '',
                synced: result.synced,
                snapshots_generated: result.snapshotsGenerated,
                latest_snapshot: result.latestSnapshot ? {
                    balance: result.latestSnapshot.balance,
                    equity: result.latestSnapshot.equity,
                    timestamp: result.latestSnapshot.timestamp.getTime().toString()
                } : null,
                error: result.error || ''
            };
            callback(null, response);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error('ProcessSyncJob failed', {
                error: errorMessage,
                stack: errorStack
            });
            callback({
                code: grpc.status.INTERNAL,
                message: errorMessage
            }, null);
        }
    }
    async getAggregatedMetrics(call, callback) {
        try {
            const rawRequest = call.request;
            const request = {
                user_uid: rawRequest.user_uid,
                exchange: rawRequest.exchange === '' ? undefined : rawRequest.exchange
            };
            const validation = (0, grpc_schemas_1.validateRequest)(grpc_schemas_1.AggregatedMetricsRequestSchema, request);
            if (!validation.success) {
                logger.warn('Invalid GetAggregatedMetrics request', {
                    error: validation.success === false ? validation.error : 'Unknown error',
                    request: {
                        user_uid: request.user_uid,
                        exchange: request.exchange
                    }
                });
                callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: validation.success === false ? validation.error : 'Validation failed'
                }, null);
                return;
            }
            const validated = validation.data;
            logger.info('Getting aggregated metrics', {
                user_uid: validated.user_uid,
                exchange: validated.exchange
            });
            const metrics = await this.enclaveWorker.getAggregatedMetrics(validated.user_uid, validated.exchange || undefined);
            const response = {
                total_balance: metrics.totalBalance,
                total_equity: metrics.totalEquity,
                total_realized_pnl: metrics.totalRealizedPnl,
                total_unrealized_pnl: metrics.totalUnrealizedPnl,
                total_fees: metrics.totalFees,
                total_trades: metrics.totalTrades,
                last_sync: metrics.lastSync ? metrics.lastSync.getTime().toString() : '0'
            };
            callback(null, response);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error('GetAggregatedMetrics failed', {
                error: errorMessage,
                stack: errorStack
            });
            callback({
                code: grpc.status.INTERNAL,
                message: errorMessage
            }, null);
        }
    }
    async getSnapshotTimeSeries(call, callback) {
        try {
            const rawRequest = call.request;
            const request = {
                user_uid: rawRequest.user_uid,
                exchange: rawRequest.exchange === '' ? undefined : rawRequest.exchange,
                start_date: rawRequest.start_date === '0' ? undefined : rawRequest.start_date,
                end_date: rawRequest.end_date === '0' ? undefined : rawRequest.end_date
            };
            const validation = (0, grpc_schemas_1.validateRequest)(grpc_schemas_1.SnapshotTimeSeriesRequestSchema, request);
            if (!validation.success) {
                logger.warn('Invalid GetSnapshotTimeSeries request', {
                    error: validation.success === false ? validation.error : 'Unknown error',
                    request: {
                        user_uid: request.user_uid,
                        exchange: request.exchange
                    }
                });
                callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: validation.success === false ? validation.error : 'Validation failed'
                }, null);
                return;
            }
            const validated = validation.data;
            logger.info('Getting snapshot time series', {
                user_uid: validated.user_uid,
                exchange: validated.exchange,
                start_date: validated.start_date,
                end_date: validated.end_date
            });
            const snapshots = await this.enclaveWorker.getSnapshotTimeSeries(validated.user_uid, validated.exchange || undefined, validated.start_date ? new Date(validated.start_date) : undefined, validated.end_date ? new Date(validated.end_date) : undefined);
            const response = {
                snapshots: snapshots.map(snapshot => {
                    const bd = snapshot.breakdown;
                    const mapMetrics = (data) => data ? {
                        equity: data.equity || 0,
                        available_margin: data.available_margin || 0,
                        volume: data.volume || 0,
                        trades: data.trades || 0,
                        trading_fees: data.trading_fees || 0,
                        funding_fees: data.funding_fees || 0
                    } : undefined;
                    return {
                        user_uid: snapshot.userUid,
                        exchange: snapshot.exchange,
                        timestamp: snapshot.timestamp.getTime(),
                        total_equity: snapshot.totalEquity,
                        realized_balance: snapshot.realizedBalance,
                        unrealized_pnl: snapshot.unrealizedPnL,
                        deposits: snapshot.deposits,
                        withdrawals: snapshot.withdrawals,
                        breakdown: bd ? {
                            global: mapMetrics(bd.global),
                            spot: mapMetrics(bd.spot),
                            swap: mapMetrics(bd.swap),
                            stocks: mapMetrics(bd.stocks),
                            futures: mapMetrics(bd.futures),
                            cfd: mapMetrics(bd.cfd),
                            forex: mapMetrics(bd.forex),
                            commodities: mapMetrics(bd.commodities),
                            options: mapMetrics(bd.options)
                        } : undefined
                    };
                })
            };
            callback(null, response);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error('GetSnapshotTimeSeries failed', {
                error: errorMessage,
                stack: errorStack
            });
            callback({
                code: grpc.status.INTERNAL,
                message: errorMessage
            }, null);
        }
    }
    async createUserConnection(call, callback) {
        try {
            const rawRequest = call.request;
            const request = {
                exchange: rawRequest.exchange,
                label: rawRequest.label,
                api_key: rawRequest.api_key,
                api_secret: rawRequest.api_secret,
                passphrase: rawRequest.passphrase === '' ? undefined : rawRequest.passphrase
            };
            const validation = (0, grpc_schemas_1.validateRequest)(grpc_schemas_1.CreateUserConnectionRequestSchema, request);
            if (!validation.success) {
                logger.warn('Invalid CreateUserConnection request', {
                    error: validation.success === false ? validation.error : 'Unknown error'
                });
                callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: validation.success === false ? validation.error : 'Validation failed'
                }, null);
                return;
            }
            const validated = validation.data;
            logger.info('Creating user connection');
            const result = await this.enclaveWorker.createUserConnection({
                exchange: validated.exchange,
                label: validated.label,
                apiKey: validated.api_key,
                apiSecret: validated.api_secret,
                passphrase: validated.passphrase
            });
            const response = {
                success: result.success,
                user_uid: result.userUid || '',
                error: result.error || ''
            };
            callback(null, response);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error('CreateUserConnection failed', {
                error: errorMessage,
                stack: errorStack
            });
            callback({
                code: grpc.status.INTERNAL,
                message: errorMessage
            }, null);
        }
    }
    async healthCheck(_call, callback) {
        try {
            const health = await this.enclaveWorker.healthCheck();
            const response = {
                status: health.status === 'healthy' ? 0 : 1,
                enclave: health.enclave,
                version: health.version,
                uptime: health.uptime
            };
            callback(null, response);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('HealthCheck failed', {
                error: errorMessage
            });
            callback(null, {
                status: 1,
                enclave: true,
                version: 'error',
                uptime: 0
            });
        }
    }
    async start() {
        return new Promise((resolve, reject) => {
            const credentials = this.createServerCredentials();
            this.server.bindAsync(`0.0.0.0:${this.port}`, credentials, (error, port) => {
                if (error) {
                    logger.error('Failed to bind enclave server', {
                        error: error.message,
                        port: this.port
                    });
                    reject(error);
                    return;
                }
                this.server.start();
                logger.info(`Enclave gRPC server started on port ${port} with TLS`);
                this.logAttestationInfo();
                resolve();
            });
        });
    }
    async stop() {
        return new Promise((resolve) => {
            this.server.tryShutdown((error) => {
                if (error) {
                    logger.error('Error during enclave server shutdown', {
                        error: error.message
                    });
                    this.server.forceShutdown();
                }
                logger.info('Enclave gRPC server stopped');
                resolve();
            });
        });
    }
    createServerCredentials() {
        const caCertPath = process.env.TLS_CA_CERT || '/etc/enclave/ca.crt';
        const serverCertPath = process.env.TLS_SERVER_CERT || '/etc/enclave/server.crt';
        const serverKeyPath = process.env.TLS_SERVER_KEY || '/etc/enclave/server.key';
        try {
            const rootCert = fs_1.default.readFileSync(caCertPath);
            const serverCert = fs_1.default.readFileSync(serverCertPath);
            const serverKey = fs_1.default.readFileSync(serverKeyPath);
            logger.info('TLS certificates loaded successfully', {
                ca: caCertPath,
                cert: serverCertPath,
                key: serverKeyPath
            });
            const requireClientCert = process.env.NODE_ENV === 'production' || process.env.REQUIRE_CLIENT_CERT === 'true';
            return grpc.ServerCredentials.createSsl(rootCert, [{
                    cert_chain: serverCert,
                    private_key: serverKey
                }], requireClientCert);
        }
        catch (error) {
            const errorMsg = `TLS certificates not found or invalid. Enclave CANNOT start without TLS.
Required certificates:
  - CA cert: ${caCertPath}
  - Server cert: ${serverCertPath}
  - Server key: ${serverKeyPath}

Error: ${error.message}

For development, generate self-signed certificates:
  mkdir -p /etc/enclave
  openssl req -x509 -newkey rsa:4096 -keyout ${serverKeyPath} -out ${serverCertPath} -days 365 -nodes -subj "/CN=enclave"
  cp ${serverCertPath} ${caCertPath}
`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
    logAttestationInfo() {
        const isEnclave = process.env.ENCLAVE_MODE === 'true';
        const attestationId = process.env.ATTESTATION_ID;
        if (isEnclave) {
            logger.info('Running in ENCLAVE mode', {
                attestationId,
                platform: 'AMD SEV-SNP',
                tcbSize: '4,572 LOC',
                isolation: 'hardware-enforced'
            });
        }
        else {
            logger.warn('Running in DEVELOPMENT mode (no hardware isolation)', {
                recommendation: 'Deploy to AMD SEV-SNP for production'
            });
        }
    }
}
exports.EnclaveServer = EnclaveServer;
async function startEnclaveServer() {
    const server = new EnclaveServer();
    await server.start();
    return server;
}
exports.default = EnclaveServer;
//# sourceMappingURL=enclave-server.js.map