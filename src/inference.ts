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
const RETRY_DELAY_MS = 60_000; // 1 minute (to avoid RPM and TPM limits)

// Perform an inference request
export async function geminiInference(apiKey: string, params: GenerateContentParameters, maxRetries: number): Promise<InferenceResponse> {
    let attempt = 1;
    for (;;) {
        try {
            // Attempt inference and return if successful
            const result = await attemptInference(apiKey, params);
            core.info(`Inference attempt #${attempt} successful`);
            return result;

        } catch (err) {
            // Handle non-retryable errors or after exhausting retries
            const message = err instanceof Error ? err.message : String(err);
            if (!isRetryableError(err)) {
                throw new Error(`Inference failed with non-retryable error: ${message}`);
            } else if (maxRetries <= attempt) {
                throw new Error(`Inference failed after ${plural(attempt, 'attempts')}: ${message}`);
            }

            // Log the retryable error and retry after a delay
            core.info(`Inference failed: ${message}`);
            core.info(`Trying again in ${formatMilliseconds(RETRY_DELAY_MS)} (attempt #${++attempt} of ${maxRetries})...`);
            await setTimeout(RETRY_DELAY_MS);
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

// Check whether an error is retryable
function isRetryableError(err: unknown): boolean {
    return err instanceof RetryableError
        || (err instanceof ApiError && RETRYABLE_STATUS_CODES.includes(err.status));
}