/**
 * Create learning path tool used to:
 * - Validate the learning path index (parts and notes)
 * - Create one folder per Part inside the vault
 * - Create an empty markdown file per note, with frontmatter, ready for save_note to fill
 */
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import VAULT, { FORBIDDEN_CHARS, textResult } from "../vault.js";
// A title that already includes its number, e.g. "01 - The ideas", "Part 2: Building it", "4. Project setup"
const LEADING_NUMBER = /^(part\s*\d+|\d+\s*[-.:)])/i;

const noLeadingNumber = s => !LEADING_NUMBER.test(s);
const leadingNumberMessage = "Pass the title only; the number goes in the 'number' field";

// Folder names are rejected rather than rewritten, so Claude can fix them and retry
const folderName = z.string()
    .trim()
    .min(0)
    .max(100)
    .refine(s => !FORBIDDEN_CHARS.test(s), {
        message: 'Must not contain any of: \\ / : * ? " < > | # ^ [ ]'
    })
    .refine(s => !s.startsWith("."), { message: "Must not start with '.'" });

// Note titles keep their punctuation (it is stored in frontmatter); the file name is cleaned instead
const noteTitle = z.string()
    .trim()
    .min(0)
    .max(200)
    .refine(noLeadingNumber, { message: leadingNumberMessage });

const pad = n => String(n).padStart(2, "0");

/** Turn a note title into a safe file name: "Project setup: the SDK" -> "Project setup - the SDK" */
function toFileName(title) {
    return title
        .replace(/\s*:\s*/g, " - ")
        .replace(/[\\/*?"<>|#^[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")
        .slice(0, 120)
        .trim();
}

function frontmatter({ title, partNumber, partTitle, lessonNumber }) {
    // JSON strings are valid YAML double-quoted strings, so titles with colons/quotes stay safe
    const lines = [
        "---",
        `title: ${JSON.stringify(title)}`,
        `part: ${partNumber}`,
        `part_title: ${JSON.stringify(partTitle)}`,
        `lesson: ${lessonNumber}`
    ];
    lines.push("---", "", `# ${title}`, "");
    return lines.join("\n");
}

export default {
    name: "create_learning_path",
    config: {
        title: "Create Learning Path",
        description: [
            "Create the folders and empty note files for a whole learning path inside the Obsidian vault, in a single call.",
            "Call this once, right after printing the Learning Path. Pass every Part and every note from the index.",
            "Pass numbers and titles separately, not formatted names. For example, root: 'Building an Obsidian MCP Server', part { number: 2, title: 'Building it' }, note { number: 4, title: 'Project setup: the SDK, zod, and package.json for ES modules' } creates",
            "'Building an Obsidian MCP Server/02 - Building it/04 - Project setup - the SDK, zod, and package.json for ES modules.md'.",
            "Note numbers continue across Parts, as in the index. Safe to call again: existing folders and files are left untouched.",
            "Returns each Part folder name and note file name; pass those exact names to save_note when saving each note's content."
        ].join(" "),
        inputSchema: {
            root: folderName.describe("Learning path folder name, e.g. 'Building an Obsidian MCP Server'. No : / | # [ ] characters"),
            parts: z.array(z.object({
                number: z.number().int().min(0).describe("Part number, 0 or higher"),
                title: folderName
                    .refine(noLeadingNumber, { message: leadingNumberMessage })
                    .describe("Short part title without 'Part N:', e.g. 'The ideas'. No : / | # [ ] characters"),
                notes: z.array(z.object({
                    number: z.number().int().min(0).describe("Lesson number from the index; continues across Parts"),
                    title: noteTitle.describe("Full lesson title as written in the index, without its number. Colons are fine"),
                })).min(0)
            })).min(0)
        }
    },
    async handler({ root, parts }) {
        if (!VAULT) return textResult("OBSIDIAN_VAULT is not set", true);
        const vault = path.resolve(VAULT);
        const inVault = p => p.startsWith(vault + path.sep);

        // Work out every path first, so nothing is created if any of them is bad
        const plan = parts.map(part => {
            const dir = path.resolve(vault, root, `${pad(part.number)} - ${part.title}`);
            const notes = part.notes.map(note => ({
                note,
                file: path.join(dir, `${pad(note.number)} - ${toFileName(note.title)}.md`)
            }));
            return { part, dir, notes };
        });

        for (const { dir, notes } of plan) {
            if (!inVault(dir)) return textResult(`Refusing to create folder outside the vault: ${dir}`, true);
            for (const { note, file } of notes) {
                if (path.basename(file) === `${pad(note.number)} - .md`) {
                    return textResult(`Note ${note.number} has no usable characters in its title for a file name`, true);
                }
            }
        }

        const result = { root, parts: [] };
        try {
            for (const { part, dir, notes } of plan) {
                const existed = await fs.stat(dir).then(() => true, () => false);
                await fs.mkdir(dir, { recursive: true });
                const partResult = {
                    number: part.number,
                    name: path.basename(dir),
                    folder: path.relative(vault, dir),
                    status: existed ? "already existed" : "created",
                    notes: []
                };
                for (const { note, file } of notes) {
                    let status = "created";
                    try {
                        // "wx" fails if the file exists, so an existing note is never overwritten
                        await fs.writeFile(file, frontmatter({
                            title: note.title,
                            partNumber: part.number,
                            partTitle: part.title,
                            lessonNumber: note.number
                        }), { flag: "wx" });
                    } catch (err) {
                        if (err.code !== "EEXIST") throw err;
                        status = "already existed";
                    }
                    partResult.notes.push({ number: note.number, file: path.basename(file), path: path.relative(vault, file), status });
                }
                result.parts.push(partResult);
            }
        } catch (err) {
            return textResult(`Failed while creating the learning path: ${err.message}`, true);
        }

        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result
        };
    }
};
