#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = require("net");
const client_1 = require("@prisma/client");
const secure_enclave_logger_1 = require("./utils/secure-enclave-logger");
const GRPC_PORT = parseInt(process.env.ENCLAVE_PORT || '50051', 10);
const TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10);
const CHECK_DATABASE = process.env.HEALTH_CHECK_DATABASE === 'true';
async function checkGrpcServer() {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const socket = (0, net_1.createConnection)({ port: GRPC_PORT, host: 'localhost' });
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve({
                check: 'grpc_server',
                status: 'fail',
                duration_ms: Date.now() - startTime,
                error: `Timeout after ${TIMEOUT_MS}ms`
            });
        }, TIMEOUT_MS);
        socket.on('connect', () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({
                check: 'grpc_server',
                status: 'pass',
                duration_ms: Date.now() - startTime
            });
        });
        socket.on('error', (err) => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({
                check: 'grpc_server',
                status: 'fail',
                duration_ms: Date.now() - startTime,
                error: err.message
            });
        });
    });
}
async function checkDatabase() {
    const startTime = Date.now();
    if (!CHECK_DATABASE) {
        return {
            check: 'database',
            status: 'pass',
            duration_ms: 0,
            error: 'Skipped (HEALTH_CHECK_DATABASE=false)'
        };
    }
    try {
        const prisma = new client_1.PrismaClient({
            datasources: {
                db: {
                    url: process.env.DATABASE_URL
                }
            },
        });
        await Promise.race([
            prisma.$queryRaw `SELECT 1`,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), TIMEOUT_MS))
        ]);
        await prisma.$disconnect();
        return {
            check: 'database',
            status: 'pass',
            duration_ms: Date.now() - startTime
        };
    }
    catch (error) {
        const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
        return {
            check: 'database',
            status: 'fail',
            duration_ms: Date.now() - startTime,
            error: errorMessage
        };
    }
}
function checkMemory() {
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const maxHeapMB = 1800;
    if (heapUsedMB > maxHeapMB) {
        return {
            check: 'memory',
            status: 'fail',
            duration_ms: Date.now() - startTime,
            error: `Heap used ${heapUsedMB.toFixed(0)}MB exceeds limit ${maxHeapMB}MB`
        };
    }
    return {
        check: 'memory',
        status: 'pass',
        duration_ms: Date.now() - startTime
    };
}
async function main() {
    const results = [];
    const [grpcResult, dbResult] = await Promise.all([
        checkGrpcServer(),
        checkDatabase()
    ]);
    results.push(grpcResult);
    results.push(dbResult);
    results.push(checkMemory());
    const failed = results.filter(r => r.status === 'fail');
    const isHealthy = failed.length === 0;
    if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            healthy: isHealthy,
            checks: results
        }));
    }
    else {
        console.log(`Health Check: ${isHealthy ? '✓ HEALTHY' : '✗ UNHEALTHY'}`);
        results.forEach(r => {
            const icon = r.status === 'pass' ? '✓' : '✗';
            const msg = r.error ? ` (${r.error})` : '';
            console.log(`  ${icon} ${r.check}: ${r.status} (${r.duration_ms}ms)${msg}`);
        });
    }
    process.exit(isHealthy ? 0 : 1);
}
main().catch((error) => {
    console.error('Health check failed:', error);
    process.exit(1);
});
//# sourceMappingURL=health-check.js.map