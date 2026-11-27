import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import createNotesPath from "./tools/create-notes-path.js";
import saveNote from "./tools/save-notes.js";

const server = new McpServer({
	name: "learning-path",
	version: "1.0.0"
});

// Add new tools here: each module exports { name, config, handler }
const tools = [createNotesPath, saveNote];

for (const { name, config, handler } of tools) {
	server.registerTool(name, config, handler);
}

const transport = new StdioServerTransport();
await server.connect(transport);
