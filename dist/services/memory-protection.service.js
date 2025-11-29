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
exports.MemoryProtectionService = void 0;
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const crypto_1 = __importDefault(require("crypto"));
const logger = (0, secure_enclave_logger_1.getLogger)('MemoryProtection');
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class MemoryProtectionService {
    static mlockSupported = false;
    static coreDumpsDisabled = false;
    static ptraceProtected = false;
    static async initialize() {
        logger.info('[MEMORY_PROTECTION] Initializing...');
        await this.disableCoreDumps();
        await this.enablePtraceProtection();
        this.checkMlockSupport();
        this.registerCleanupHandlers();
        logger.info('[MEMORY_PROTECTION] Initialized', {
            coreDumps: this.coreDumpsDisabled,
            ptrace: this.ptraceProtected,
            mlock: this.mlockSupported
        });
    }
    static async disableCoreDumps() {
        try {
            if (process.setrlimit) {
                process.setrlimit('core', { soft: 0, hard: 0 });
                this.coreDumpsDisabled = true;
                logger.info('[MEMORY_PROTECTION] ✓ Core dumps disabled');
                return;
            }
            try {
                await execAsync('ulimit -c 0');
                this.coreDumpsDisabled = true;
                logger.info('[MEMORY_PROTECTION] ✓ Core dumps disabled via ulimit');
            }
            catch {
                logger.warn('[MEMORY_PROTECTION] ⚠ Core dumps may be enabled - configure at OS level');
            }
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('[MEMORY_PROTECTION] Failed to disable core dumps', { error: errorMessage });
        }
    }
    static async enablePtraceProtection() {
        try {
            if (process.platform !== 'linux') {
                return;
            }
            const ptraceScopePath = '/proc/sys/kernel/yama/ptrace_scope';
            if (!fs.existsSync(ptraceScopePath)) {
                return;
            }
            const scope = fs.readFileSync(ptraceScopePath, 'utf8').trim();
            if (scope === '2' || scope === '3') {
                this.ptraceProtected = true;
                logger.info(`[MEMORY_PROTECTION] ✓ Ptrace protection active (scope=${scope})`);
            }
            else {
                logger.warn(`[MEMORY_PROTECTION] ⚠ Weak ptrace protection (scope=${scope})`);
            }
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('[MEMORY_PROTECTION] Ptrace protection check failed', { error: errorMessage });
        }
    }
    static checkMlockSupport() {
        try {
            if (process.platform === 'linux' && fs.existsSync('/proc/self/status')) {
                const status = fs.readFileSync('/proc/self/status', 'utf8');
                const vmLck = status.match(/VmLck:\s+(\d+)/);
                if (vmLck) {
                    this.mlockSupported = true;
                    logger.info('[MEMORY_PROTECTION] mlock available');
                }
                else {
                    logger.warn('[MEMORY_PROTECTION] ⚠ mlock not available (missing CAP_IPC_LOCK)');
                }
            }
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.warn('[MEMORY_PROTECTION] Could not check mlock', { error: errorMessage });
        }
    }
    static wipeBuffer(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            return;
        }
        try {
            crypto_1.default.randomFillSync(buffer);
            buffer.fill(0);
            logger.debug(`[MEMORY_PROTECTION] Wiped ${buffer.length} bytes`);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('[MEMORY_PROTECTION] Buffer wipe failed', { error: errorMessage });
        }
    }
    static wipeString(str) {
        const buffer = Buffer.from(str, 'utf8');
        this.wipeBuffer(buffer);
        return buffer;
    }
    static registerCleanupHandlers() {
        const cleanup = () => {
            logger.info('[MEMORY_PROTECTION] Cleaning up secrets...');
            if (process.env.ENCRYPTION_KEY) {
                this.wipeString(process.env.ENCRYPTION_KEY);
                delete process.env.ENCRYPTION_KEY;
            }
            if (process.env.JWT_SECRET) {
                this.wipeString(process.env.JWT_SECRET);
                delete process.env.JWT_SECRET;
            }
            logger.info('[MEMORY_PROTECTION] Cleanup completed');
        };
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
        process.on('beforeExit', cleanup);
    }
    static getStatus() {
        return {
            coreDumpsDisabled: this.coreDumpsDisabled,
            ptraceProtected: this.ptraceProtected,
            mlockSupported: this.mlockSupported,
            platform: process.platform
        };
    }
    static getProductionRecommendations() {
        const recs = [];
        if (!this.coreDumpsDisabled) {
            recs.push('Configure systemd DumpMode=none or ulimit -c 0');
        }
        if (!this.ptraceProtected) {
            recs.push('Set kernel.yama.ptrace_scope=2');
        }
        if (!this.mlockSupported) {
            recs.push('Add CAP_IPC_LOCK or systemd LockPersonality=yes');
        }
        if (process.platform === 'linux') {
            recs.push('Run in AMD SEV-SNP VM for hardware memory encryption');
            recs.push('Enable ASLR and seccomp');
        }
        return recs;
    }
}
exports.MemoryProtectionService = MemoryProtectionService;
//# sourceMappingURL=memory-protection.service.js.map