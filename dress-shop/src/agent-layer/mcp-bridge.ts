/**
 * THE MCP BRIDGE — drive the shop session over a real Model Context Protocol
 * connection, not an in-process function call.
 *
 * `mcpServer(session)` (from hcifootprint/mcp) exposes the live session as an
 * MCP server; an MCP `Client` connects to it. Here both sides run in the same
 * Node process, linked by the SDK's in-memory transport — the SAME protocol
 * messages, no network. Swap `InMemoryTransport` for stdio or HTTP/SSE and the
 * agent could live in a different process or machine; nothing else changes.
 *
 * This is the proof that the library is framework-agnostic: the assistant talks
 * to the app only through `tools/list` + `tools/call`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpServer } from 'hcifootprint/mcp';
import type { InteractionSession } from 'hcifootprint';

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** The app's tool surface, reached over MCP. */
export interface AppMcp {
  /** The fixed tool list from tools/list. */
  tools: McpToolDef[];
  /** Route a tool call over MCP; returns the parsed result JSON. */
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** Wire the session behind a real MCP server and connect an MCP client to it. */
export async function connectOverMcp(session: InteractionSession): Promise<AppMcp> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = mcpServer(session, { source: 'agent' });
  await server.connect(serverTransport);

  const client = new Client({ name: 'dress-shop-assistant', version: '0.1.0' });
  await client.connect(clientTransport);

  const listed = await client.listTools();
  const tools = listed.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  return {
    tools,
    call: async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      const content = res.content as { type: string; text?: string }[];
      const text = content[0]?.text;
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
