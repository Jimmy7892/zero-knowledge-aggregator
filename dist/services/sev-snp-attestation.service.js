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
exports.SevSnpAttestationService = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const secure_enclave_logger_1 = require("../utils/secure-enclave-logger");
const logger = (0, secure_enclave_logger_1.getLogger)('SevSnpAttestation');
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class SevSnpAttestationService {
    SEV_GUEST_DEVICE = '/dev/sev-guest';
    AZURE_IMDS_ENDPOINT = 'http://169.254.169.254/metadata/attested/document';
    GCP_METADATA_ENDPOINT = 'http://metadata.google.internal/computeMetadata/v1/instance/confidential-computing/attestation-report';
    async getAttestationReport(_reportData) {
        if (!this.isSevSnpAvailable()) {
            logger.warn('AMD SEV-SNP not available on this system');
            return this.createFailureResult('SEV-SNP hardware not available');
        }
        try {
            const report = await this.fetchAttestation();
            if (!report) {
                throw new Error('Failed to retrieve attestation report');
            }
            const signatureValid = await this.verifySignature(report);
            if (!signatureValid) {
                throw new Error('Attestation signature verification failed');
            }
            logger.info('AMD SEV-SNP attestation successful', { measurement: report.measurement });
            return {
                verified: true,
                enclave: true,
                sevSnpEnabled: true,
                measurement: report.measurement,
                reportData: report.reportData ?? null,
                platformVersion: report.platformVersion?.toString() || null
            };
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('AMD SEV-SNP attestation failed', { error: errorMessage });
            return this.createFailureResult(errorMessage);
        }
    }
    isSevSnpAvailable() {
        return process.env.AMD_SEV_SNP === 'true' ||
            fs.existsSync(this.SEV_GUEST_DEVICE) ||
            this.checkCpuInfo();
    }
    checkCpuInfo() {
        try {
            if (!fs.existsSync('/proc/cpuinfo')) {
                return false;
            }
            const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
            return cpuinfo.includes('sev_snp') || cpuinfo.includes('sev');
        }
        catch {
            return false;
        }
    }
    async fetchAttestation() {
        if (fs.existsSync(this.SEV_GUEST_DEVICE)) {
            return this.getSevGuestAttestation();
        }
        if (await this.isAzure()) {
            return this.getAzureAttestation();
        }
        if (await this.isGcp()) {
            return this.getGcpAttestation();
        }
        throw new Error('No SEV-SNP attestation method available');
    }
    async getSevGuestAttestation() {
        const tools = ['/opt/amd/sev-guest/bin/get-report', '/usr/bin/snpguest'];
        for (const tool of tools) {
            if (fs.existsSync(tool)) {
                try {
                    const { stdout } = await execAsync(`${tool} --format json`);
                    return JSON.parse(stdout);
                }
                catch (error) {
                    const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
                    logger.warn(`SEV guest tool ${tool} failed: ${errorMessage}`);
                }
            }
        }
        throw new Error('No SEV-SNP guest tools found');
    }
    async getAzureAttestation() {
        const response = await fetch(this.AZURE_IMDS_ENDPOINT, {
            headers: { 'Metadata': 'true' }
        });
        if (!response.ok) {
            throw new Error(`Azure IMDS failed: ${response.statusText}`);
        }
        const doc = await response.json();
        return doc.sevSnpReport || {};
    }
    async getGcpAttestation() {
        const response = await fetch(this.GCP_METADATA_ENDPOINT, {
            headers: { 'Metadata-Flavor': 'Google' }
        });
        if (!response.ok) {
            throw new Error(`GCP metadata failed: ${response.statusText}`);
        }
        return response.json();
    }
    async verifySignature(report) {
        try {
            const vcekPubKey = await this.getVcekPublicKey(report.chipId || report.chip_id || '');
            const signatureBuffer = Buffer.from(report.signature, 'hex');
            if (signatureBuffer.length !== 96) {
                throw new Error('Invalid signature length');
            }
            const verify = crypto.createVerify('SHA384');
            verify.update(this.serializeReport(report));
            return verify.verify({ key: vcekPubKey, format: 'pem', type: 'spki' }, signatureBuffer);
        }
        catch (error) {
            const errorMessage = (0, secure_enclave_logger_1.extractErrorMessage)(error);
            logger.error('Signature verification failed', { error: errorMessage });
            return false;
        }
    }
    async getVcekPublicKey(chipId) {
        try {
            const response = await fetch(`https://kdsintf.amd.com/vcek/v1/${chipId}`);
            if (!response.ok) {
                throw new Error(`AMD KDS request failed`);
            }
            return response.text();
        }
        catch (error) {
            const cachedVcek = process.env.AMD_VCEK_CACHE_PATH || '/etc/enclave/vcek.pem';
            if (fs.existsSync(cachedVcek)) {
                return fs.readFileSync(cachedVcek, 'utf8');
            }
            throw new Error('VCEK not available');
        }
    }
    serializeReport(report) {
        const buffer = Buffer.alloc(720);
        let offset = 0;
        buffer.writeUInt32LE(report.version || 0, offset);
        offset += 4;
        buffer.writeUInt32LE(report.guest_svn || report.guestSvn || 0, offset);
        offset += 4;
        buffer.writeBigUInt64LE(BigInt(report.policy || 0), offset);
        offset += 8;
        return buffer;
    }
    async isAzure() {
        try {
            const response = await fetch('http://169.254.169.254/metadata/instance?api-version=2021-02-01', {
                headers: { 'Metadata': 'true' },
                signal: AbortSignal.timeout(2000)
            });
            if (response.ok) {
                const metadata = await response.json();
                return metadata.compute?.securityType === 'ConfidentialVM';
            }
        }
        catch { }
        return false;
    }
    async isGcp() {
        try {
            const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/attributes/', {
                headers: { 'Metadata-Flavor': 'Google' },
                signal: AbortSignal.timeout(2000)
            });
            if (response.ok) {
                const attributes = await response.text();
                return attributes.includes('confidential-compute');
            }
        }
        catch { }
        return false;
    }
    async getAttestationInfo() {
        let platform = 'unknown';
        let attestationMethod = 'none';
        if (await this.isAzure()) {
            platform = 'Azure Confidential VM';
            attestationMethod = 'IMDS';
        }
        else if (await this.isGcp()) {
            platform = 'GCP Confidential VM';
            attestationMethod = 'Metadata Server';
        }
        else if (fs.existsSync(this.SEV_GUEST_DEVICE)) {
            platform = 'Bare Metal / KVM';
            attestationMethod = '/dev/sev-guest';
        }
        return { platform, sevSnpAvailable: this.isSevSnpAvailable(), attestationMethod };
    }
    createFailureResult(errorMessage) {
        return {
            verified: false,
            enclave: false,
            sevSnpEnabled: this.isSevSnpAvailable(),
            measurement: null,
            reportData: null,
            platformVersion: null,
            errorMessage
        };
    }
}
exports.SevSnpAttestationService = SevSnpAttestationService;
//# sourceMappingURL=sev-snp-attestation.service.js.map