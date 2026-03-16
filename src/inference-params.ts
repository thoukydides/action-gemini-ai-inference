// GitHub action
// Copyright © 2026 Alexander Thoukydides

import { ContentListUnion, ContentUnion, GenerateContentConfig,
         GenerateContentParameters, ThinkingConfig, ThinkingLevel } from '@google/genai';
import { Prompt } from './prompt';
import { replaceTemplateVariables, TemplateVariables } from './template';
import { ModelDetails } from './models';

// Prepared response type and schema
type InferenceResponseSchema = Pick<GenerateContentConfig, 'responseMimeType' | 'responseJsonSchema'>;

// Prepared system and user messages for the input context
interface InferenceMessages {
    systemInstruction?: ContentUnion;
    contents:           ContentListUnion;
}

// Prepare the inference parameters for all models in the fallback list
export function prepareInferenceParams(
    modelDetails:       ModelDetails[],
    prompt:             Prompt,
    maxOutputTokens:    number,
    variables:          TemplateVariables
): GenerateContentParameters[] {
    // Substitute template variables in messages
    const messages = prepareMessages(prompt.messages, variables);

    // Prepare schema for structured response if required
    const responseSchema = prepareResponse(prompt);

    // Prepare the parameters for each fallback model
    return modelDetails.map(md => prepareModelParams(md, prompt, maxOutputTokens, messages, responseSchema));
}

// Prepare the inference parameters for a single model
function prepareModelParams(
    modelDetails:       ModelDetails,
    prompt:             Prompt,
    maxOutputTokens:    number,
    messages:           InferenceMessages,
    responseSchema:     InferenceResponseSchema
): GenerateContentParameters {
    const { model } = modelDetails;
    const { systemInstruction, contents } = messages;

    // Map the thinking level and enable thought summaries in the output
    const thinkingLevelMap: Record<NonNullable<Prompt['thinkingLevel']>, ThinkingLevel> = {
        'minimal': ThinkingLevel.MINIMAL,
        'low':     ThinkingLevel.LOW,
        'medium':  ThinkingLevel.MEDIUM,
        'high':    ThinkingLevel.HIGH
    };
    const thinkingLevel = modelDetails.thinkingLevel ? thinkingLevelMap[prompt.thinkingLevel ?? 'high'] : undefined;
    const thinkingConfig: ThinkingConfig  = { includeThoughts: true, thinkingLevel };

    // Build the inference configuration
    const config: GenerateContentConfig = { maxOutputTokens, systemInstruction, thinkingConfig, ...responseSchema };
    return { model, config, contents } satisfies GenerateContentParameters;
}

// Prepare the response type and schema
function prepareResponse(prompt: Prompt): InferenceResponseSchema {
    if (!('jsonSchema' in prompt)) return {};
    try {
        return {
            responseMimeType:   'application/json',
            responseJsonSchema: JSON.parse(prompt.jsonSchema) as unknown
        };
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to parse JSON schema: ${message}`, { cause });
    }
}

// Prepare the system and user messages for the input context
function prepareMessages(
    messages:   Prompt['messages'],
    variables:  TemplateVariables
): InferenceMessages {
    // Substitute template variables
    const finalMessages = messages.map(message =>
        ({ ...message, content: replaceTemplateVariables(message.content, variables) })) as Prompt['messages'];

    // Gemini requires the system instruction to be separate from user messages
    let systemInstruction: ContentUnion | undefined;
    if (finalMessages[0].role === 'system') systemInstruction = finalMessages.shift()?.content ?? '';

    // Convert the user messages to the format expected by the API
    const contents: ContentListUnion = finalMessages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
    return { systemInstruction, contents };
}