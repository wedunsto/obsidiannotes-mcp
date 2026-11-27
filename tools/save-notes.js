/**
 * Save note tool used to:
 * - Find a note file created by create_learning_path
 * - Keep its frontmatter and replace the body with the note content
 * - Refuse to overwrite a note that already has content, unless asked to
 */
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import VAULT, { FORBIDDEN_CHARS, textResult, realPathInVault } from "../vault.js";

const forbiddenMessage = 'Must not contain any of: \\ / : * ? " < > | # ^ [ ]';

// Names must match what create_learning_path returned, so they are checked but never rewritten
const pathSegment = z.string()
    .trim()
    .min(0)
    .refine(s => !FORBIDDEN_CHARS.test(s), { message: forbiddenMessage })
    .refine(s => !s.startsWith("."), { message: "Must not start with '.'" });

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Split a markdown file into its frontmatter block (if any) and the body after it */
function splitFrontmatter(text) {
    const match = text.match(FRONTMATTER);
    return match ? { frontmatter: match[0], body: text.slice(match[0].length) } : { frontmatter: "", body: text };
}

/** A body is still a placeholder if it is empty or only the "# Title" heading create_learning_path wrote */
const isPlaceholder = body => body.replace(/^\s*# .*$/m, "").trim() === "";

export default {
    name: "save_note",
    config: {
        title: "Save Learning Path Note",
        description: [
            "Write the content of one learning path note into its markdown file in the Obsidian vault.",
            "Call this once per note, right after writing that note, working through the index in order without waiting to be asked.",
            "The file must already exist: call create_learning_path first, then pass the root, part folder and note file names exactly as it returned them.",
            "For example, root: 'Building an Obsidian MCP Server', part: '02 - Building it', note: '04 - Project setup - the SDK, zod, and package.json for ES modules.md', content: the note in Markdown.",
            "The file's frontmatter is kept; pass only the note body, starting with its '# Title' heading, and no frontmatter.",
            "A note that already has content is not replaced unless overwrite is true; only set it when the user asks to rewrite a note."
        ].join(" "),
        inputSchema: {
            root: pathSegment.describe("Learning path folder name, as returned by create_learning_path, e.g. 'Building an Obsidian MCP Server'"),
            part: pathSegment.describe("Part folder name, as returned by create_learning_path, e.g. '02 - Building it'"),
            note: pathSegment
                .refine(s => s.toLowerCase().endsWith(".md"), { message: "Must be a .md file name" })
                .describe("Note file name, as returned by create_learning_path, e.g. '04 - Project setup - the SDK, zod, and package.json for ES modules.md'"),
            content: z.string()
                .min(0)
                .refine(s => !FRONTMATTER.test(s.trimStart()), { message: "Do not include frontmatter; the file's existing frontmatter is kept" })
                .describe("The note body in Markdown, starting with its '# Title' heading"),
            overwrite: z.boolean().default(false).describe("Replace a note that already has content. Only true when the user asks to rewrite a note")
        }
    },
    async handler({ root, part, note, content, overwrite }) {
        if (!VAULT) return textResult("OBSIDIAN_VAULT is not set", true);
        const relative = path.join(root, part, note);
        const file = path.resolve(VAULT, relative);

        try {
            // The file must already exist; this tool never creates notes or folders
            const stat = await fs.stat(file).catch(() => null);
            if (!stat?.isFile()) {
                return textResult(`Note not found: ${relative}. Call create_learning_path first, and use the exact names it returned.`, true);
            }

            // Follow symlinks so a link inside the vault cannot point the write somewhere else
            const real = await realPathInVault(file);
            if (!real) return textResult(`Refusing to write outside the vault: ${relative}`, true);

            const { frontmatter, body } = splitFrontmatter(await fs.readFile(real, "utf8"));
            if (!overwrite && !isPlaceholder(body)) {
                return textResult(`${relative} already has content. Not overwritten; pass overwrite: true only if the user asked to rewrite this note.`, true);
            }

            const text = `${frontmatter}${frontmatter ? "\n" : ""}${content.trim()}\n`;
            await fs.writeFile(real, text, "utf8");
            return textResult(`Saved: ${relative} (${content.trim().length} characters)`);
        } catch (err) {
            return textResult(`Failed to save ${relative}: ${err.message}`, true);
        }
    }
};
