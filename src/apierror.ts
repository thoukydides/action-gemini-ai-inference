
// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { ApiError } from '@google/genai';
import { z } from 'zod';

// https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
const GeminiStatusSchema = z.enum([
    'OK',
    'CANCELLED',
    'UNKNOWN',
    'INVALID_ARGUMENT',
    'DEADLINE_EXCEEDED',
    'NOT_FOUND',
    'ALREADY_EXISTS',
    'PERMISSION_DENIED',
    'UNAUTHENTICATED',
    'RESOURCE_EXHAUSTED',
    'FAILED_PRECONDITION',
    'ABORTED',
    'OUT_OF_RANGE',
    'UNIMPLEMENTED',
    'INTERNAL',
    'UNAVAILABLE',
    'DATA_LOSS'
]);

// https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
const GoogleApiErrorInfoSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.ErrorInfo'),
    reason:             z.string().optional(),
    domain:             z.string().optional(),
    metadata:           z.record(z.string(), z.string()).optional()
});
const GoogleApiRetryInfoSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.RetryInfo'),
    retryDelay:         z.string()
});
const GoogleApiDebugInfoSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.DebugInfo'),
    stackEntries:       z.array(z.string()).optional(),
    detail:             z.string().optional()
});
const GoogleApiQuotaFailureSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.QuotaFailure'),
    violations:         z.array(z.object({
        subject:            z.string().optional(),
        description:        z.string().optional(),
        apiService:         z.string().optional(),
        quotaMetric:        z.string(),
        quotaId:            z.string(),
        quotaDimensions:    z.record(z.string(), z.string()),
        quotaValue:         z.string().optional(),
        futureQuotaValue:   z.string().optional()
    }))
});
const GoogleApiPreconditionFailureSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.PreconditionFailure'),
    violations:         z.array(z.object({
        type:               z.string(),
        subject:            z.string(),
        description:        z.string()
    }))
});
const GoogleApiBadRequestSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.BadRequest'),
    fieldViolations:    z.array(z.object({
        field:              z.string(),
        description:        z.string(),
        reason:             z.string(),
        localizedMessage:   z.string()
    }))
});
const GoogleApiRequestInfoSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.RequestInfo'),
    requestId:          z.string(),
    servingData:        z.string()
});
const GoogleApiResourceInfoSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.ResourceInfo'),
    resourceType:       z.string(),
    resourceName:       z.string(),
    owner:              z.string(),
    description:        z.string()
});
const GoogleApiHelpSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.Help'),
    links:              z.array(z.object({
        description:        z.string(),
        url:                z.string()
    }))
});
const GoogleApiLocalizedMessageSchema = z.object({
    '@type':            z.literal('type.googleapis.com/google.rpc.LocalizedMessage'),
    locale:             z.string(),
    message:            z.string()
});
const GoogleApiDetailUnionSchema = z.discriminatedUnion('@type', [
    GoogleApiErrorInfoSchema,
    GoogleApiRetryInfoSchema,
    GoogleApiDebugInfoSchema,
    GoogleApiQuotaFailureSchema,
    GoogleApiPreconditionFailureSchema,
    GoogleApiBadRequestSchema,
    GoogleApiRequestInfoSchema,
    GoogleApiResourceInfoSchema,
    GoogleApiHelpSchema,
    GoogleApiLocalizedMessageSchema
]);
type GoogleApiDetailUnion = z.infer<typeof GoogleApiDetailUnionSchema>;
export type GoogleApiDetailType = GoogleApiDetailUnion['@type'];
type GoogleApiDetail<T extends GoogleApiDetailType> = Extract<GoogleApiDetailUnion, { '@type': T }>;

// Schema for a Google AI Studio ApiError, with loosely typed details
// https://google.aip.dev/193
const GoogleApiErrorSchema = z.object({
    error: z.object({
        code:    z.number(),
        message: z.string(),
        status:  GeminiStatusSchema,
        details: z.array(
            z.looseObject({ '@type': z.string() })
        ).optional()
    })
});
export type GoogleApiError = z.infer<typeof GoogleApiErrorSchema>;

// Parse a Google API error (returning undefined if code/status do not match)
export function parseApiError(err: unknown, code?: number, status?: z.infer<typeof GeminiStatusSchema>): GoogleApiError | undefined {
    // Only attempt to parse ApiError messages with matching HTTP status code
    if (!(err instanceof ApiError)) return;
    if (code !== undefined && err.status !== code) return;

    // Attempt to parse and validate the error message as JSON
    const json = JSON.parse(err.message) as unknown;
    const parsedError = GoogleApiErrorSchema.parse(json);

    // Return the parsed error if the status code matches
    if (status !== undefined && parsedError.error.status !== status) return;
    return parsedError;
}

// Find any matching detail(s) from a Google API error
export function findApiErrorDetails<T extends GoogleApiDetailType>(err: GoogleApiError, type: T): GoogleApiDetail<T>[] {
    const filteredDetails = err.error.details?.filter(detail => detail['@type'] === type) ?? [];
    return filteredDetails.map(detail => GoogleApiDetailUnionSchema.parse(detail) as GoogleApiDetail<T>);
}

// Has a daily usage quota been exceeded
export function isDailyQuotaExceeded(err: unknown): boolean | undefined {
    try {
        // Ignore non-quota errors
        const parsedError = parseApiError(err, 429, 'RESOURCE_EXHAUSTED');
        if (!parsedError) return undefined;

        // Check for any daily quota violations in the structured error
        const quotaFailure = findApiErrorDetails(parsedError, 'type.googleapis.com/google.rpc.QuotaFailure');
        return quotaFailure[0]?.violations.some(v => v.quotaId.includes('PerDay'));
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        core.info(`Failed to parse Google ApiError QuotaFailure: ${message}`);
    }
    return false;
}

// Attempt to extract retry-after for a 429 error
export function getRetryAfterSeconds(err: ApiError): number | undefined {
    try {
        // Ignore non-quota errors
        const parsedError = parseApiError(err, 429, 'RESOURCE_EXHAUSTED');
        if (!parsedError) return undefined;

        // Attempt to extract the retry delay from the message
        const RETRY_DELAY_RE = /\b(\d+(?:\.\d+)?)s\b/;
        const messageMatch = RETRY_DELAY_RE.exec(parsedError.error.message);
        if (messageMatch) return Number(messageMatch[1]);

        // Attempt to extract the retry delay from the details
        const retryInfo = findApiErrorDetails(parsedError, 'type.googleapis.com/google.rpc.RetryInfo');
        const retryDelay = retryInfo[0]?.retryDelay;
        if (!retryDelay) throw new Error('Missing retryDelay');
        const infoMatch = RETRY_DELAY_RE.exec(retryDelay);
        if (infoMatch) return Number(infoMatch[1]) + 1; // (extra second due to rounding down)

        // Failed to extract any retry delay
        throw new Error(`Unexpected retryDelay format: ${retryDelay}`);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        core.info(`Failed to parse Google ApiError retry delay: ${message}`);
    }
}

// Is this a retryable error
export function isRetryableApiError(err: unknown): err is ApiError {
    // Not an API error
    if (!(err instanceof ApiError)) return false;

    // Use the HTTP status code to determine whether retryable
    switch (err.status) {
    case 429: // Too Many Requests      (RESOURCE_EXHAUSTED)
    case 500: // Internal Server Error  (UNKNOWN, INTERNAL, DATA_LOSS)
    case 503: // Service Unavailable    (UNAVAILABLE)
    case 504: // Gateway Timeout        (DEADLINE_EXCEEDED)
        return true;
    default:
        // All other errors are non-retryable
        return false;
    }
}
