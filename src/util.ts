import * as fs from 'fs/promises';

export async function isFileExists(filePath: string, checkDir: boolean): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return checkDir ? stats.isDirectory() : stats.isFile();
    } catch {
        return false;
    }
}