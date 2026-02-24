// GitHub action
// Copyright © 2026 Alexander Thoukydides

import { ContentListUnion, ContentUnion, GenerateContentConfig, GenerateContentParameters, ThinkingLevel } from '@google/genai';
import { Prompt } from './prompt';
import { replaceTemplateVariables, TemplateVariables } from './template';

// Prepare the inference parameters
export function prepareInferenceParams(prompt: Prompt, maxOutputTokens: number, variables: TemplateVariables): GenerateContentParameters {
    const { model, messages } = prompt;
    const config: GenerateContentConfig = { maxOutputTokens };

    // Substitute template variables in messages
    const { systemInstruction, contents } = prepareMessages(messages, variables);
    config.systemInstruction = systemInstruction;

    // Prepare schema for structured response if required
    if ('jsonSchema' in prompt) {
        config.responseMimeType = 'application/json';
        try {
            config.responseJsonSchema = JSON.parse(prompt.jsonSchema) as unknown;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to parse JSON schema: ${message}`);
        }
    }

    // Map the thinking level and enable thought summaries in the output
    const thinkingLevelMap: Record<NonNullable<Prompt['thinkingLevel']>, ThinkingLevel> = {
        'minimal': ThinkingLevel.MINIMAL,
        'low':     ThinkingLevel.LOW,
        'medium':  ThinkingLevel.MEDIUM,
        'high':    ThinkingLevel.HIGH
    };
    const thinkingLevel = thinkingLevelMap[prompt.thinkingLevel ?? 'high'];
    config.thinkingConfig = { includeThoughts: true, thinkingLevel };

    return { model, config, contents } satisfies GenerateContentParameters;
}

// Prepare the system and user messages for the input context
function prepareMessages(
    messages:   Prompt['messages'],
    variables:  TemplateVariables
): { systemInstruction?: ContentUnion; contents: ContentListUnion } {
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