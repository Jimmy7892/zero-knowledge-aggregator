"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthCheckRequestSchema = exports.CreateUserConnectionRequestSchema = exports.SnapshotTimeSeriesRequestSchema = exports.AggregatedMetricsRequestSchema = exports.SyncJobRequestSchema = void 0;
exports.formatValidationError = formatValidationError;
exports.validateRequest = validateRequest;
const zod_1 = require("zod");
const uuidSchema = zod_1.z.string().uuid();
const exchangeSchema = zod_1.z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/);
const timestampSchema = zod_1.z.string().regex(/^\d+$/).transform(val => parseInt(val, 10))
    .refine(val => val > 0 && val < Date.now() + 86400000);
exports.SyncJobRequestSchema = zod_1.z.object({
    user_uid: uuidSchema,
    exchange: exchangeSchema.optional(),
    type: zod_1.z.enum(['INCREMENTAL', 'HISTORICAL', 'FULL', 'incremental', 'historical', 'full'])
        .transform(val => val.toLowerCase())
        .optional()
        .default('incremental')
});
exports.AggregatedMetricsRequestSchema = zod_1.z.object({
    user_uid: uuidSchema,
    exchange: exchangeSchema.optional()
});
exports.SnapshotTimeSeriesRequestSchema = zod_1.z.object({
    user_uid: uuidSchema,
    exchange: exchangeSchema.optional(),
    start_date: timestampSchema.optional(),
    end_date: timestampSchema.optional()
}).refine(data => !data.start_date || !data.end_date || data.start_date < data.end_date, 'Invalid date range')
    .refine(data => !data.start_date || !data.end_date || (data.end_date - data.start_date) <= 5 * 365 * 24 * 60 * 60 * 1000, 'Max 5 years');
exports.CreateUserConnectionRequestSchema = zod_1.z.object({
    exchange: exchangeSchema,
    label: zod_1.z.string().min(1).max(100),
    api_key: zod_1.z.string().min(1).max(500),
    api_secret: zod_1.z.string().min(1).max(500),
    passphrase: zod_1.z.string().max(500).optional()
});
exports.HealthCheckRequestSchema = zod_1.z.object({}).strict();
function formatValidationError(error) {
    const errors = error?.issues ?? [];
    if (errors.length === 0) {
        return 'Validation failed: Unknown error';
    }
    return `Validation failed: ${errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
}
function validateRequest(schema, data) {
    const result = schema.safeParse(data);
    return result.success ? { success: true, data: result.data } : { success: false, error: formatValidationError(result.error) };
}
//# sourceMappingURL=grpc-schemas.js.map