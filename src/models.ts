// GitHub action
// Copyright © 2026 Alexander Thoukydides

import { GenerateContentParameters } from '@google/genai';
import { InferenceParams } from './inference-params';
import * as core from '@actions/core';

// Model selection options
export interface ModelOptions {
    fallback:       boolean;
    fallback_lite:  boolean;
}

// List of models and their characteristics (in descending order of capability)
enum ModelType { FlashLite, Flash, Pro };
interface ModelDetails {
    model:          string;
    type:           ModelType;
    thinkingLevel:  boolean;
}
const MODELS = [{
    model:          'gemini-3-flash-preview',
    type:           ModelType.Flash,
    thinkingLevel:  true
}, {
    model:          'gemini-2.5-flash',
    type:           ModelType.Flash,
    thinkingLevel:  true
}, {
    // Gemini 3.1 Flash Lite allows 500 RPD; all others are 20 RPD
    model:          'gemini-3.1-flash-lite-preview',
    type:           ModelType.FlashLite,
    thinkingLevel:  false
}, {
    model:          'gemini-2.5-flash-lite',
    type:           ModelType.FlashLite,
    thinkingLevel:  false
}] as const satisfies ModelDetails[];

// Number of attempts to use the preferred model
const PREFERRED_MODEL_ATTEMPTS = 3;

// Update inference parameters with the model for specific try
export function updateModelParams(params: InferenceParams, options: ModelOptions, attempt: number): GenerateContentParameters {
    const { fallback, fallback_lite } = options;

    // Choose the model for this attempt
    let modelDetails: ModelDetails;
    if (attempt <= PREFERRED_MODEL_ATTEMPTS || !fallback) {
        // Use the preferred model
        modelDetails = MODELS[0];
        if (params.model) {
            const found = MODELS.find(m => m.model === params.model);
            if (found) modelDetails = found;
            else core.warning(`Requested model '${params.model}' not recognised`);
        }
    } else {
        // Iterate through available models (starting with second choice)
        const models = fallback_lite ? MODELS : MODELS.filter(m => m.type !== ModelType.FlashLite);
        const index = (attempt - PREFERRED_MODEL_ATTEMPTS) % models.length;
        modelDetails = models[index] as ModelDetails;
    }

    // Remove any thinkingLevel configuration if unsupported by the model
    const thinkingConfig = modelDetails.thinkingLevel ? params.config?.thinkingConfig
        : { ...params.config?.thinkingConfig, thinkingLevel: undefined };

    // Return the updated inference parameters for the selected model
    const { model } = modelDetails;
    return { ...params, model, config: { ...params.config, thinkingConfig } };
}