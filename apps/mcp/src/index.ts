import { createExponentialMcpServer } from "@exponential/mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const token = process.env.EXPONENTIAL_TOKEN;

if (!token) {
  console.error("EXPONENTIAL_TOKEN is required for exponential-mcp.");
  process.exit(1);
}

const server = createExponentialMcpServer({
  token,
  baseUrl: process.env.EXPONENTIAL_API_URL,
});

await server.connect(new StdioServerTransport());
