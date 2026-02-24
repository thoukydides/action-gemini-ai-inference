// GitHub action
// Copyright © 2026 Alexander Thoukydides

import * as core from '@actions/core';
import { loadPromptFile } from './prompt.js';
import { parseFileTemplateVariables, parseTemplateVariables } from './template.js';
import { geminiInference } from './inference.js';
import { writeTmpFile } from './tmpfile.js';
import { prepareInferenceParams } from './inference-params.js';

// Script entry point
async function run(): Promise<void> {
    // Action inputs
    const gemini_api_key    =        core.getInput('gemini_api_key',    { required: true });
    const prompt_file       =        core.getInput('prompt_file',       { required: true });
    const input             =        core.getInput('input',             { required: false });
    const file_input        =        core.getInput('file_input',        { required: false });
    const max_tokens        = Number(core.getInput('max_tokens',        { required: true }));
    const max_retries       = Number(core.getInput('max_retries',       { required: true }));

    // Load the prompt file
    const prompt = loadPromptFile(prompt_file);

    // Substitute template variables in the prompt messages
    const variables = {
        ...parseTemplateVariables(input),
        ...parseFileTemplateVariables(file_input)
    };
    const params = prepareInferenceParams(prompt, max_tokens, variables);

    // Log the request
    core.startGroup('Inference request');
    core.info(JSON.stringify(params, null, 4));
    core.endGroup();

    // Perform the inference
    const { response, thoughts } = await geminiInference(gemini_api_key, params, max_retries);

    // Log the response
    core.startGroup('Inference response');
    if (thoughts) core.info(`Thoughts:\n${thoughts}\nResponse:\n`);
    core.info(response);
    core.endGroup();

    // Write the response to a file
    const response_file = writeTmpFile('response', '.txt', response);
    core.debug(`Wrote response to file '${response_file}'`);

    // Action outputs
    core.setOutput('response',      response);
    core.setOutput('response_file', response_file);
    core.setOutput('thoughts',      thoughts);
}

// Run the script and handle errors
void (async () => {
    try {
        await run();
    } catch (err) {
        core.setFailed(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        if (err instanceof Error && err.stack) core.debug(err.stack);
    }
})();