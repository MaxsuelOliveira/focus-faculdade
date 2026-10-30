import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcp, localApi } from './mcp.js';

// Do not import config/dotenv: credentials are owned by the application, not MCP.
const server = createMcp(localApi(Number(process.env.FOCUS_MCP_PORT || 4317)));
await server.connect(new StdioServerTransport());
