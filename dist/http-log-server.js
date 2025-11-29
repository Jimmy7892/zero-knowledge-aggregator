"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpLogServer = void 0;
exports.startHttpLogServer = startHttpLogServer;
const express_1 = __importDefault(require("express"));
const secure_enclave_logger_1 = require("./utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('HttpLogServer');
class HttpLogServer {
    app;
    port;
    server = null;
    sseClients = new Set();
    constructor() {
        this.app = (0, express_1.default)();
        this.port = parseInt(process.env.HTTP_LOG_PORT || '50052');
        this.setupRoutes();
    }
    setupRoutes() {
        this.app.get('/health', (_req, res) => {
            res.json({ status: 'ok', service: 'enclave-log-server' });
        });
        this.app.get('/logs/stream', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.write('data: {"type":"connected","message":"SSE connection established"}\n\n');
            this.sseClients.add(res);
            const existingLogs = (0, secure_enclave_logger_1.getLogBuffer)();
            existingLogs.forEach(log => {
                res.write(`data: ${log}\n\n`);
            });
            req.on('close', () => {
                this.sseClients.delete(res);
            });
        });
        this.app.get('/logs', (_req, res) => {
            const logs = (0, secure_enclave_logger_1.getLogBuffer)();
            res.json({ logs, count: logs.length });
        });
        this.app.post('/logs/clear', (_req, res) => {
            (0, secure_enclave_logger_1.clearLogBuffer)();
            res.json({ success: true, message: 'Logs cleared' });
        });
    }
    broadcastLog(log) {
        this.sseClients.forEach(client => {
            try {
                client.write(`data: ${log}\n\n`);
            }
            catch (error) {
            }
        });
    }
    async start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                logger.info(`Listening on port ${this.port}`);
                logger.info(`Logs endpoint: http://localhost:${this.port}/logs`);
                resolve();
            });
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logger.info('Stopped');
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
exports.HttpLogServer = HttpLogServer;
async function startHttpLogServer() {
    const server = new HttpLogServer();
    await server.start();
    return server;
}
//# sourceMappingURL=http-log-server.js.map