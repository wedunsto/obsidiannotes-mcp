/**
 * Shared vault settings and helpers used by every tool
 */
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = process.env.OBSIDIAN_VAULT; // set in the Claude Desktop config

export default VAULT;

// Characters that are invalid on Windows/macOS, refused by Obsidian, or break [[wikilinks]]
export const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/;

export const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError && { isError }) });

/**
 * Resolve an existing path and confirm it is inside the vault, following symlinks.
 * Returns the real absolute path, or null if it escapes the vault.
 */
export async function realPathInVault(p) {
    const vault = await fs.realpath(path.resolve(VAULT));
    const real = await fs.realpath(p);
    return real.startsWith(vault + path.sep) ? real : null;
}
