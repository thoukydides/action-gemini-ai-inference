// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { assertIsDefined } from './utils';

// List of models and their characteristics (in descending order of capability)
export enum ModelType { FlashLite, Flash, Pro };
export interface ModelDetails {
    model:          string;
    type:           ModelType;
    thinkingLevel:  boolean;
}
const MODELS: ModelDetails[] = [{
    model:          'gemini-3-flash-preview',
    type:           ModelType.Flash,
    thinkingLevel:  true
}, {
    model:          'gemini-2.5-flash',
    type:           ModelType.Flash,
    thinkingLevel:  false
}, {
    // Gemini 3.1 Flash Lite allows 500 RPD; all others are 20 RPD
    model:          'gemini-3.1-flash-lite-preview',
    type:           ModelType.FlashLite,
    thinkingLevel:  true
}, {
    model:          'gemini-2.5-flash-lite',
    type:           ModelType.FlashLite,
    thinkingLevel:  false
}];

// Get the preferred and any fallback models
export function getModels(fallback: boolean, fallback_lite: boolean, preferred?: string): ModelDetails[] {
    // Select the fallback models, if any
    const allFallbackModels = fallback ? MODELS.filter(m => fallback_lite || m.type !== ModelType.FlashLite) : [];

    // Choose the preferred model
    const foundPreferred = MODELS.find(m => m.model === preferred);
    const preferredModel = foundPreferred ?? allFallbackModels[0] ?? MODELS[0];
    assertIsDefined(preferredModel);
    if (preferred && !foundPreferred) {
        core.warning(`Requested model '${preferred}' not recognised; using '${preferredModel.model}' instead`);
    }

    // Avoid duplicating the preferred model in the fallback list
    const fallbackModels = allFallbackModels.filter(m => m !== preferredModel);
    return [preferredModel, ...fallbackModels];
}