// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { ApiError, FinishReason, GenerateContentParameters, GoogleGenAI } from '@google/genai';
import z from 'zod';
import { JSONSchema } from 'zod/v4/core';
import { setTimeout } from 'node:timers/promises';
import { formatMilliseconds, plural } from './utils';

// Inference response
export interface InferenceResponse {
    response:   string;
    thoughts?:  string;
}

// Retryable errors
class RetryableError extends Error {}
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

// Delay before retrying
const MIN_RETRY_DELAY_MS = 1 * 60_000; // 1 minute (for RPM and TPM limits)
const MIN_RETRY_JITTER_MS = 10_000; // Start with 10 seconds of random jitter
const MAX_RETRY_JITTER_MS = 5 * 60_000; // Cap jitter at 5 minutes
const RETRY_JITTER_FACTOR = 1.5; // Exponential backoff factor for jitter

// Perform an inference request
export async function geminiInference(
    apiKey:             string,
    params:             GenerateContentParameters,
    maxRetries:         number,
    maxElapsedMinutes:  number
): Promise<InferenceResponse> {
    const startTime = Date.now();
    let retryCount = 0;
    for (let attempt = 1;; attempt++) {
        try {
            // Attempt inference and return if successful
            const result = await attemptInference(apiKey, params);
            core.info(`Inference attempt #${attempt} successful`);
            return result;

        } catch (err) {
            // Check whether the error is retryable
            const message = err instanceof Error ? err.message : String(err);
            let retryDelay = MIN_RETRY_DELAY_MS;
            if (err instanceof RetryableError) {
                // Retryable model response error; try again after minimum delay
                ++retryCount;
            } else if (err instanceof ApiError && RETRYABLE_STATUS_CODES.includes(err.status)) {
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
            if (maxRetries <= retryCount) {
                throw new Error(`Inference failed after ${plural(retryCount, 'retry')}: ${message}`);
            } else if (startTime + maxElapsedMinutes * 60_000 < Date.now() + retryDelay) {
                throw new Error(`Inference failed after ${formatMilliseconds(Date.now() - startTime)} elapsed: ${message}`);
            }

            // Log the retryable error and retry after a delay
            core.info(`Inference attempt #${attempt} failed: ${message}`);
            core.info(`Trying again in ${formatMilliseconds(retryDelay)} (${retryCount} of ${plural(maxRetries, 'retry')})...`);
            await setTimeout(retryDelay);
        }
    }
}

// Attempt a single inference request
async function attemptInference(apiKey: string, params: GenerateContentParameters): Promise<InferenceResponse> {
    // Perform the inference
    const ai = new GoogleGenAI({ apiKey });
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