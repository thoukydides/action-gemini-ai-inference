// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { FinishReason, GenerateContentParameters, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import z from 'zod';
import { JSONSchema } from 'zod/v4/core';
import { setTimeout } from 'node:timers/promises';
import { assertIsDefined, formatMilliseconds, plural } from './utils';
import { isDailyQuotaExceeded, getRetryAfterSeconds, isRetryableApiError } from './apierror';

// Inference options
export interface InferenceOptions {
    gemini_api_key:         string;
    max_retries:            number;
    max_elapsed_minutes:    number;
}

// Inference response
export interface InferenceResponse {
    response:   string;
    thoughts?:  string;
}

// Delay before retrying
const MIN_RETRY_DELAY_MS    = 1 * 60_000;   // 1 minute (for RPM and TPM limits)
const MIN_RETRY_JITTER_MS   =     10_000;   // Start with 10 seconds of random jitter
const MAX_RETRY_JITTER_MS   = 5 * 60_000;   // Cap jitter at 5 minutes
const RETRY_JITTER_FACTOR   = 1.5;          // Exponential backoff factor for jitter

// Number of attempts to use the preferred model
const PREFERRED_MODEL_ATTEMPTS = 3;

// Retryable errors (excluding ApiError thrown by @google/genai)
interface RetryableErrorOptions extends ErrorOptions {
    failModel?:         boolean;
    retryAfterSeconds?: number;
}
class RetryableError extends Error {
    failModel?:     boolean;
    retryAfter?:    number;
    constructor(message: string, options?: RetryableErrorOptions) {
        super(message, options);
        this.failModel = options?.failModel;
        if (options?.retryAfterSeconds) this.retryAfter = options.retryAfterSeconds * 1000;
    }
}
class RetryableModelError extends RetryableError {
    constructor(message: string, options?: RetryableErrorOptions) {
        super(message, { retryAfterSeconds: MIN_RETRY_DELAY_MS, ...options} );
    }
}

// Perform an inference request
export async function geminiInference(fallbackParams: GenerateContentParameters[], options: InferenceOptions): Promise<InferenceResponse> {
    const { gemini_api_key, max_retries, max_elapsed_minutes } = options;
    const ai = new GoogleGenAI({ apiKey: gemini_api_key });

    const startTime = Date.now();
    let retryCount = 0;
    for (let attempt = 1;; attempt++) {
        try {
            // Check whether a fallback model should be used
            const params = fallbackParams[0];
            assertIsDefined(params);
            core.info(`Inference attempt #${attempt} using model '${params.model}'`);

            // Attempt inference and return if successful
            const response = await attemptInference(ai, params);
            const result = checkInferenceResult(params, response);
            core.info(`Inference attempt #${attempt} successful`);
            return result;

        } catch (cause) {
            // Check whether the error is retryable
            const message = cause instanceof Error ? cause.message : String(cause);
            if (!(cause instanceof RetryableError)) {
                throw new Error(`Inference failed with non-retryable error: ${message}`, { cause });
            }

            // Use a different model for each retry (after the initial attempts)
            if (PREFERRED_MODEL_ATTEMPTS <= attempt) {
                const thisParam = fallbackParams.shift();
                if (thisParam && !cause.failModel) fallbackParams.push(thisParam);
            }
            if (!fallbackParams.length) {
                throw new Error(`Inference failed after exhausting all models: ${message}`, { cause });
            }

            // Select the retry delay
            let retryDelay: number;
            if (cause.retryAfter !== undefined) {
                // Use the delay specified in the error (e.g. from rate limiting)
                retryDelay = cause.retryAfter;
            } else {
                // Otherwise use exponential backoff with jitter
                const jitterMultiplier = Math.pow(RETRY_JITTER_FACTOR, attempt - 1);
                const jitterWindow = Math.min(MIN_RETRY_JITTER_MS * jitterMultiplier, MAX_RETRY_JITTER_MS);
                retryDelay = MIN_RETRY_DELAY_MS + Math.floor(Math.random() * jitterWindow);
            }

            // Only count model responses against the retry count
            if (cause instanceof RetryableModelError) ++retryCount;

            // Check whether any retry limits have been exceeded
            if (max_retries <= retryCount) {
                throw new Error(`Inference failed after ${plural(retryCount, 'retry')}: ${message}`, { cause });
            } else if (startTime + max_elapsed_minutes * 60_000 < Date.now() + retryDelay) {
                throw new Error(`Inference failed after ${formatMilliseconds(Date.now() - startTime)} elapsed: ${message}`, { cause });
            }

            // Log the retryable error and retry after a delay
            core.info(`Inference attempt #${attempt} failed: ${message}`);
            core.info(`Trying again in ${formatMilliseconds(retryDelay)} (${retryCount} of ${plural(max_retries, 'retry')})...`);
            await setTimeout(retryDelay);
        }
    }
}

// Attempt a single inference request
async function attemptInference(ai: GoogleGenAI, params: GenerateContentParameters): Promise<GenerateContentResponse> {
    try {
        // Attempt the inference operation
        const response = await ai.models.generateContent(params);
        core.debug(`Raw response:\n${JSON.stringify(response, null, 4)}`);
        return response;

    } catch (cause) {
        if (cause instanceof TypeError && cause.message === 'fetch failed') {
            // Undici (pre-response) fetch failure
            throw new RetryableError(cause.message, { cause });
        } else if (isRetryableApiError(cause)) {
            // API returned a retryable HTTP error
            const failModel = isDailyQuotaExceeded(cause);
            const retryAfterSeconds = getRetryAfterSeconds(cause);
            throw new RetryableError(cause.message, { cause, failModel, retryAfterSeconds });
        }
        throw cause;
    }
}

// Check the result of an inference request
function checkInferenceResult(params: GenerateContentParameters, result: GenerateContentResponse): InferenceResponse {
    // Log the token usage, if available
    if (result.usageMetadata) {
        const { totalTokenCount, promptTokenCount, thoughtsTokenCount,
            candidatesTokenCount, cachedContentTokenCount } = result.usageMetadata;
        core.info(`Tokens used: ${totalTokenCount}`
            + ` (prompt=${promptTokenCount} + thoughts=${thoughtsTokenCount} + candidates=${candidatesTokenCount},`
            + ` cached=${cachedContentTokenCount})`);
    }

    // Extract the response text and thoughts from the result
    let response = result.text;
    const candidate = result.candidates?.[0];
    const thoughts = candidate?.content?.parts?.find(part => part.thought)?.text;

    // Validate the response
    if (candidate?.finishReason !== FinishReason.STOP) {
        throw new RetryableModelError(`Abnormal finish reason: ${candidate?.finishReason}`);
    }
    if (!response) throw new RetryableModelError('No text response');
    const schema = params.config?.responseJsonSchema;
    if (schema) {
        const zodSchema = z.fromJSONSchema(schema as JSONSchema.JSONSchema);
        try {
            // A JSON schema was provided, so validate the response against it
            const json = parseJSONResponse(response);
            const parsed = zodSchema.parse(json);

            // Use the possibly modified validated response
            response = JSON.stringify(parsed, null, 4);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new RetryableModelError(`Structured response failed validation: ${message}`);
        }
    }

    // Return the text response
    return { response, thoughts };
}

// Parse a structured response, patching any known issues
function parseJSONResponse(response: string): unknown {
    // Parse as JSON, checking for correctly escaped newlines within strings
    const status = { anyNewline: false };
    const json: unknown = JSON.parse(response, (_, value): unknown => {
        if (typeof value === 'string' && value.includes('\n')) status.anyNewline = true;
        return value;
    });
    if (status.anyNewline) return json;

    // If none found, parse again replacing incorrectly double-escaped newlines
    return JSON.parse(response, (_, value: unknown) =>
        typeof value === 'string' ? value.replaceAll(/(?<!\\)\\n/g, '\n') : value);
}