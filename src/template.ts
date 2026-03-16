// GitHub action
// Copyright © 2026 Alexander Thoukydides

import fs from 'node:fs';
import * as core from '@actions/core';
import { load as yamlLoad } from 'js-yaml';

// Pattern to match non-printable characters that can cause YAML parsing to fail
const JSYAML_NON_PRINTABLE_RE =
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g;

// Pattern to match template variables in the format {{variable_name}}
const TEMPLATE_VARIABLE_RE = /\{\{([\w.-]+)\}\}/g;

// Template variables
export type TemplateVariables = Record<string, string>;

// Parse template variables
export function parseTemplateVariables(yaml: string): TemplateVariables {
    // Strip any non-printable characters that will fail YAML parsing
    const cleanYaml = yaml.replace(JSYAML_NON_PRINTABLE_RE, '');
    if (cleanYaml !== yaml) {
        core.warning('Template variables contained non-printable characters that were removed to allow YAML parsing');
    }

    // Return an empty map if the cleaned YAML is empty
    if (!cleanYaml.trim()) return {};

    try {
        // Parse the cleaned YAML and ensure that it is an object
        const parsed = yamlLoad(cleanYaml);
        if (typeof parsed !== 'object' || parsed === null) throw new Error('Not an object');

        // YAML parsing decodes any JSON-like values, so convert back to strings
        const variables: TemplateVariables = {};
        for (const [key, value] of Object.entries(parsed)) {
            variables[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
        return variables;
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to parse template variables: ${message}`, { cause });
    }
}

// Parse template variables from files
export function parseFileTemplateVariables(yaml: string): TemplateVariables {
    // Return an empty map if the YAML is empty
    if (!yaml.trim()) return {};

    let parsed: unknown;
    try {
        // Parse the YAML and ensure that it is an object of string values
        parsed = yamlLoad(yaml);
        if (typeof parsed !== 'object' || parsed === null) throw new Error('Not an object');
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to parse file template variables: ${message}`, { cause });
    }

    // Read the contents of each file and return as an object
    const variables: TemplateVariables = {};
    for (const [key, filePath] of Object.entries(parsed)) {
        try {
            if (typeof filePath !== 'string') throw new Error('File path is not a string');
            variables[key] = fs.readFileSync(filePath, { encoding: 'utf8' });
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Failed to read file template '${key}' from '${filePath}': ${message}`, { cause });
        }
    }
    return variables;
}

// Replace template variables in the prompt messages
export function replaceTemplateVariables(text: string, variables: TemplateVariables): string {
    return text.replace(TEMPLATE_VARIABLE_RE, (_, varName: string) => {
        const varValue = variables[varName];
        if (varValue === undefined) throw new Error(`Undefined template variable: ${varName}`);
        return varValue;
    });
}