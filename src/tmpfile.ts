// GitHub action
// Copyright © 2026 Alexander Thoukydides

import path from 'path';
import crypto from 'crypto';
import fs from 'node:fs';
import os from 'node:os';

// Write a temporary file with the given content and return the file path
export function writeTmpFile(prefix: string, ext: string, content: string): string {
    // Generate a unique temporary filename
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const name = `${prefix}_${hash.substring(0, 8)}`;
    const tmpFile = path.format({ dir: os.tmpdir(), name, ext });

    // Save the content to the temporary file
    fs.writeFileSync(tmpFile, content, { encoding: 'utf8' });
    return tmpFile;
}