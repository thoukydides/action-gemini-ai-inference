// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { ApiError, FinishReason, GenerateContentParameters, GoogleGenAI } from '@google/genai';
import z from 'zod';
import { JSONSchema } from 'zod/v4/core';
import { setTimeout } from 'node:timers/promises';
import { formatMilliseconds, plural } from './utils';
import { getDailyQuotaExceeded, getRetryAfterSeconds } from './apierror';
import { ModelOptions, updateModelParams } from './models';
import { InferenceParams } from './inference-params';

// Inference options
export interface InferenceOptions {
    gemini_api_key:         string;
    max_retries:            number;
    max_elapsed_minutes:    number;
    fallback:               boolean;
    fallback_lite:          boolean;
}

// Inference response
export interface InferenceResponse {
    response:   string;
    thoughts?:  string;
}

// Retryable errors
class RetryableError extends Error {}
const RETRYABLE_STATUS_CODE_RATE_LIMIT = 429;
const RETRYABLE_STATUS_CODES_OTHER = [500, 503, 504];

// Delay before retrying
const MIN_RETRY_DELAY_MS    = 1 * 60_000;   // 1 minute (for RPM and TPM limits)
const MIN_RETRY_JITTER_MS   =     10_000;   // Start with 10 seconds of random jitter
const MAX_RETRY_JITTER_MS   = 5 * 60_000;   // Cap jitter at 5 minutes
const RETRY_JITTER_FACTOR   = 1.5;          // Exponential backoff factor for jitter

// Perform an inference request
export async function geminiInference(params: InferenceParams, options: InferenceOptions): Promise<InferenceResponse> {
    const { gemini_api_key, max_retries, max_elapsed_minutes, fallback, fallback_lite } = options;
    const ai = new GoogleGenAI({ apiKey: gemini_api_key });

    const startTime = Date.now();
    let retryCount = 0;
    for (let attempt = 1;; attempt++) {
        try {
            // Check whether a fallback model should be used
            const modelOptions: ModelOptions = { fallback, fallback_lite };
            const attemptParams = updateModelParams(params, modelOptions, attempt);
            core.info(`Inference attempt #${attempt} using model '${attemptParams.model}'`);

            // Attempt inference and return if successful
            const result = await attemptInference(ai, attemptParams);
            core.info(`Inference attempt #${attempt} successful`);
            return result;

        } catch (err) {
            // Check whether the error is retryable
            const message = err instanceof Error ? err.message : String(err);
            let retryDelay = MIN_RETRY_DELAY_MS;
            if (err instanceof RetryableError) {
                // Retryable model response error; try again after minimum delay
                ++retryCount;
            } else if (err instanceof ApiError && err.status === RETRYABLE_STATUS_CODE_RATE_LIMIT
                && !getDailyQuotaExceeded(err)) {
                // Too many requests; try after delay specified in error
                const retryAfter = getRetryAfterSeconds(err);
                if (retryAfter) retryDelay = retryAfter * 1000;
            } else if (err instanceof ApiError && RETRYABLE_STATUS_CODES_OTHER.includes(err.status)
                || err instanceof TypeError && err.message === 'fetch failed') {
                // HTTP error with retryable status code; add exponentially increasing jitter
                const jitterMultiplier = Math.pow(RETRY_JITTER_FACTOR, attempt - 1);
                const jitterWindow = Math.min(MIN_RETRY_JITTER_MS * jitterMultiplier, MAX_RETRY_JITTER_MS);
                retryDelay += Math.floor(Math.random() * jitterWindow);
                // (retryCount not increased for HTTP errors)
            } else {
                // Non-retryable error
                throw new Error(`Inference failed with non-retryable error: ${message}`);
            }

            // Check whether the retry limits have been exceeded
            if (max_retries <= retryCount) {
                throw new Error(`Inference failed after ${plural(retryCount, 'retry')}: ${message}`);
            } else if (startTime + max_elapsed_minutes * 60_000 < Date.now() + retryDelay) {
                throw new Error(`Inference failed after ${formatMilliseconds(Date.now() - startTime)} elapsed: ${message}`);
            }

            // Log the retryable error and retry after a delay
            core.info(`Inference attempt #${attempt} failed: ${message}`);
            core.info(`Trying again in ${formatMilliseconds(retryDelay)} (${retryCount} of ${plural(max_retries, 'retry')})...`);
            await setTimeout(retryDelay);
        }
    }
}

// Attempt a single inference request
async function attemptInference(ai: GoogleGenAI, params: GenerateContentParameters): Promise<InferenceResponse> {
    // Perform the inference
    const result = await ai.models.generateContent(params);
    core.debug(`Raw response:\n${JSON.stringify(result, null, 4)}`);

    // Log the token usage, if available
    if (result.usageMetadata) {
        const { totalTokenCount, promptTokenCount, thoughtsTokenCount,
            candidatesTokenCount, cachedContentTokenCount } = result.usageMetadata;
        core.info(`Tokens used: ${totalTokenCount}`
            + ` (prompt=${promptTokenCount} + thoughts=${thoughtsTokenCount} + candidates=${candidatesTokenCount},`
            + ` cached=${cachedContentTokenCount})`);
    }

    // Extract the response text and thoughts from the result
    const response = result.text;
    const candidate = result.candidates?.[0];
    const thoughts = candidate?.content?.parts?.find(part => part.thought)?.text;

    // Validate the response
    if (candidate?.finishReason !== FinishReason.STOP) {
        throw new RetryableError(`Abnormal finish reason: ${candidate?.finishReason}`);
    }
    if (!response) throw new RetryableError('No text response');
    const schema = params.config?.responseJsonSchema;
    if (schema) {
        const zodSchema = z.fromJSONSchema(schema as JSONSchema.JSONSchema);
        try {
            // A JSON schema was provided, so validate the response against it
            const json = JSON.parse(response) as unknown;
            void zodSchema.parse(json); // (validation only; result discarded)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new RetryableError(`Structured response failed validation: ${message}`);
        }
    }

    // Return the text response
    return { response, thoughts };
}