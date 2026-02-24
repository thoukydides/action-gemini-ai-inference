// GitHub action
// Copyright © 2026 Alexander Thoukydides

import fs from 'node:fs';
import { load as yamlLoad } from 'js-yaml';
import z from 'zod';

// Prompt file format
const makeMessageSchema = <T extends string>(role: T) => z.strictObject({
    role:       z.literal(role),
    content:    z.string()
});
const SystemMessageSchema = makeMessageSchema('system');
const UserMessageSchema   = makeMessageSchema('user');
const BasePromptSchema = z.strictObject({
    model:          z.string(),
    thinkingLevel:  z.optional(z.enum(['minimal', 'low', 'medium', 'high'])),
    messages:       z.union([
        z.tuple([UserMessageSchema], UserMessageSchema),
        z.tuple([SystemMessageSchema, UserMessageSchema], UserMessageSchema)
    ])
});
const PromptSchema = z.union([
    BasePromptSchema,
    BasePromptSchema.safeExtend({
        responseFormat: z.literal('json_schema'),
        jsonSchema:     z.string()
    })
]);
export type Prompt = z.infer<typeof PromptSchema>;

// Load and parse the prompt file, substituting template variables in messages
export function loadPromptFile(filePath: string): Prompt {
    try {
        const yaml = fs.readFileSync(filePath, { encoding: 'utf8' });
        return PromptSchema.parse(yamlLoad(yaml));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load or parse prompt file '${filePath}': ${message}`);
    }
}