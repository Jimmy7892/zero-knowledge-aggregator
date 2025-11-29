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
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsService = exports.MetricsService = void 0;
const http = __importStar(require("http"));
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('MetricsService');
class MetricsService {
    static instance;
    metrics = new Map();
    server = null;
    collectors = [];
    constructor() {
        this.initializeMetrics();
    }
    static getInstance() {
        if (!MetricsService.instance) {
            MetricsService.instance = new MetricsService();
        }
        return MetricsService.instance;
    }
    initializeMetrics() {
        this.registerMetric({
            name: 'grpc_requests_total',
            type: 'counter',
            help: 'Total number of gRPC requests',
            value: new Map(),
            labels: ['method', 'status']
        });
        this.registerMetric({
            name: 'grpc_request_duration_seconds',
            type: 'histogram',
            help: 'gRPC request duration in seconds',
            value: new Map(),
            labels: ['method']
        });
        this.registerMetric({
            name: 'grpc_active_connections',
            type: 'gauge',
            help: 'Number of active gRPC connections',
            value: 0
        });
        this.registerMetric({
            name: 'db_queries_total',
            type: 'counter',
            help: 'Total number of database queries',
            value: new Map(),
            labels: ['operation']
        });
        this.registerMetric({
            name: 'db_query_duration_seconds',
            type: 'histogram',
            help: 'Database query duration in seconds',
            value: new Map(),
            labels: ['operation']
        });
        this.registerMetric({
            name: 'process_memory_bytes',
            type: 'gauge',
            help: 'Process memory usage in bytes',
            value: 0
        });
        this.registerMetric({
            name: 'process_cpu_usage_percent',
            type: 'gauge',
            help: 'Process CPU usage percentage',
            value: 0
        });
        this.registerMetric({
            name: 'enclave_attestation_success_total',
            type: 'counter',
            help: 'Total number of successful attestations',
            value: 0
        });
        this.registerMetric({
            name: 'enclave_attestation_failure_total',
            type: 'counter',
            help: 'Total number of failed attestations',
            value: 0
        });
        this.registerMetric({
            name: 'sync_jobs_total',
            type: 'counter',
            help: 'Total number of sync jobs processed',
            value: new Map(),
            labels: ['status']
        });
        this.registerMetric({
            name: 'snapshots_created_total',
            type: 'counter',
            help: 'Total number of snapshots created',
            value: 0
        });
        this.registerMetric({
            name: 'exchange_connections_total',
            type: 'gauge',
            help: 'Total number of active exchange connections',
            value: 0
        });
    }
    registerMetric(metric) {
        this.metrics.set(metric.name, metric);
    }
    incrementCounter(name, labels) {
        const metric = this.metrics.get(name);
        if (!metric || metric.type !== 'counter') {
            logger.warn(`Counter metric ${name} not found`);
            return;
        }
        if (labels && metric.value instanceof Map) {
            const key = this.getLabelKey(labels);
            const current = metric.value.get(key) || 0;
            metric.value.set(key, current + 1);
        }
        else if (typeof metric.value === 'number') {
            metric.value++;
        }
    }
    setGauge(name, value, labels) {
        const metric = this.metrics.get(name);
        if (!metric || metric.type !== 'gauge') {
            logger.warn(`Gauge metric ${name} not found`);
            return;
        }
        if (labels && metric.value instanceof Map) {
            const key = this.getLabelKey(labels);
            metric.value.set(key, value);
        }
        else {
            metric.value = value;
        }
    }
    observeHistogram(name, value, labels) {
        const metric = this.metrics.get(name);
        if (!metric || metric.type !== 'histogram') {
            logger.warn(`Histogram metric ${name} not found`);
            return;
        }
        if (labels && metric.value instanceof Map) {
            const key = this.getLabelKey(labels);
            metric.value.set(key, value);
        }
    }
    registerCollector(collector) {
        this.collectors.push(collector);
    }
    updateSystemMetrics() {
        const memUsage = process.memoryUsage();
        this.setGauge('process_memory_bytes', memUsage.heapUsed);
        const cpuUsage = process.cpuUsage();
        const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000;
        this.setGauge('process_cpu_usage_percent', cpuPercent);
    }
    async runCollectors() {
        await Promise.all(this.collectors.map(collector => collector().catch(err => logger.error('Collector failed', err))));
    }
    getLabelKey(labels) {
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
    exportMetrics() {
        this.updateSystemMetrics();
        const lines = [];
        for (const [name, metric] of this.metrics) {
            lines.push(`# HELP ${name} ${metric.help}`);
            lines.push(`# TYPE ${name} ${metric.type}`);
            if (metric.value instanceof Map) {
                for (const [labels, value] of metric.value) {
                    lines.push(`${name}{${labels}} ${value}`);
                }
            }
            else {
                lines.push(`${name} ${metric.value}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
    startMetricsServer(port = 9090) {
        if (process.env.METRICS_ENABLED !== 'true') {
            logger.info('Metrics server disabled (METRICS_ENABLED=false)');
            return;
        }
        this.server = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/metrics') {
                this.runCollectors()
                    .then(() => {
                    const metrics = this.exportMetrics();
                    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
                    res.end(metrics);
                })
                    .catch(err => {
                    logger.error('Failed to collect metrics', err);
                    res.writeHead(500);
                    res.end('Internal Server Error');
                });
            }
            else if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            }
            else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        this.server.listen(port, '0.0.0.0', () => {
            logger.info(`Metrics server listening on port ${port}`, {
                endpoint: `http://localhost:${port}/metrics`
            });
        });
    }
    stopMetricsServer() {
        if (this.server) {
            this.server.close();
            logger.info('Metrics server stopped');
        }
    }
    async measureAsync(metricName, labels, fn) {
        const startTime = Date.now();
        try {
            const result = await fn();
            const duration = (Date.now() - startTime) / 1000;
            this.observeHistogram(metricName, duration, labels);
            return result;
        }
        catch (error) {
            const duration = (Date.now() - startTime) / 1000;
            this.observeHistogram(metricName, duration, { ...labels, error: 'true' });
            throw error;
        }
    }
}
exports.MetricsService = MetricsService;
exports.metricsService = MetricsService.getInstance();
//# sourceMappingURL=metrics.service.js.map