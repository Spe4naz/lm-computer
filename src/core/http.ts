import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ComputerService } from "./service";
import { ToolInputError } from "./service";
import { VERSION } from "../version";

const MAX_JSON_BODY = 8 * 1024 * 1024;
const MAX_UPLOAD_BODY = 8 * 1024 * 1024;

export class HttpApi {
  private server: ReturnType<typeof createServer> | undefined;

  constructor(private readonly service: ComputerService) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.sendJson(res, 500, { ok: false, error: errorMessage(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.service.config.port, this.service.config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.service.events.add("http_started", {
      host: this.service.config.host,
      port: this.service.config.port,
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    // Long-poll /api/events and open MCP streams must not keep the process up.
    server.closeAllConnections();
    await closed;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    this.setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/mcp") {
      if (!this.authorized(req)) {
        this.sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      this.service.markAppSeen();
      await this.handleMcp(req, res);
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      if (!this.authorized(req)) {
        this.sendJson(res, 200, { ok: true, name: "lm-computer", version: VERSION });
        return;
      }
      this.service.markAppSeen();
      this.sendJson(res, 200, this.service.status());
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      this.sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (!this.authorized(req)) {
      this.sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    this.service.markAppSeen();

    try {
      await this.routeApi(req, res, url);
    } catch (error) {
      const status = error instanceof ToolInputError ? 400 : 500;
      this.sendJson(res, status, { ok: false, error: errorMessage(error) });
    }
  }

  private async routeApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/status") {
      this.sendJson(res, 200, this.service.status());
      return;
    }

    if (method === "POST" && pathname === "/api/shutdown") {
      this.sendJson(res, 200, { ok: true, message: "shutting down" });
      this.service.cancelAll();
      setTimeout(() => {
        void this.service.stopHttp();
      }, 50);
      return;
    }

    if (pathname === "/api/config") {
      if (method === "GET") {
        this.sendJson(res, 200, { ok: true, config: this.service.publicConfig() });
        return;
      }
      if (method === "PUT") {
        const body = await this.readJson(req);
        const patch = body as Record<string, unknown>;
        if (patch.host !== undefined || patch.port !== undefined) {
          this.sendJson(res, 400, {
            ok: false,
            error: "host/port changes require a plugin restart",
          });
          return;
        }
        const updated = await this.service.updateConfig({
          workspace: typeof patch.workspace === "string" ? patch.workspace : undefined,
          shellEnabled:
            typeof patch.shellEnabled === "boolean" ? patch.shellEnabled : undefined,
          approvalTimeoutSec:
            typeof patch.approvalTimeoutSec === "number"
              ? patch.approvalTimeoutSec
              : undefined,
          shellTimeoutSec:
            typeof patch.shellTimeoutSec === "number" ? patch.shellTimeoutSec : undefined,
          maxOutputBytes:
            typeof patch.maxOutputBytes === "number" ? patch.maxOutputBytes : undefined,
          zenityFallback:
            typeof patch.zenityFallback === "boolean" ? patch.zenityFallback : undefined,
          autoAcceptMaxSec:
            typeof patch.autoAcceptMaxSec === "number" ? patch.autoAcceptMaxSec : undefined,
        });
        this.sendJson(res, 200, { ok: true, config: updated });
        return;
      }
    }

    if (method === "GET" && pathname === "/api/files") {
      const entries = await this.service.files.list(url.searchParams.get("path") ?? undefined);
      this.sendJson(res, 200, { ok: true, entries });
      return;
    }

    if (pathname === "/api/file") {
      const relative = url.searchParams.get("path") ?? "";
      if (method === "GET") {
        const absolute = await this.service.files.resolve(relative);
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) {
          this.sendJson(res, 400, { ok: false, error: "Path is not a file" });
          return;
        }
        const inline = url.searchParams.get("inline") === "1";
        const name = path.basename(absolute);
        res.writeHead(200, {
          "Content-Type": inline ? "text/plain; charset=utf-8" : "application/octet-stream",
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        });
        createReadStream(absolute).pipe(res);
        return;
      }
      if (method === "PUT") {
        const buffer = await this.readBuffer(req, MAX_UPLOAD_BODY);
        const result = await this.service.files.writeBuffer(relative, buffer, "overwrite");
        this.service.events.add("file_changed", {
          tool: "api_upload",
          path: result.path,
          to: "",
        });
        this.sendJson(res, 200, { ok: true, result });
        return;
      }
    }

    if (method === "GET" && pathname === "/api/audit") {
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
      this.sendJson(res, 200, { ok: true, entries: this.service.audit.tail(limit) });
      return;
    }

    if (method === "GET" && pathname === "/api/events") {
      const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
      const wait = Math.max(
        0,
        Math.min(25, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0),
      );
      const page = await this.service.events.wait(since, wait);
      this.sendJson(res, 200, { ok: true, ...page });
      return;
    }

    if (pathname === "/api/approvals") {
      if (method === "GET") {
        this.sendJson(res, 200, {
          ok: true,
          approvals: this.service.approvals.list(),
          autoAcceptUntil: this.service.approvals.autoAcceptDeadline,
        });
        return;
      }
    }

    if (method === "POST" && pathname.startsWith("/api/approvals/")) {
      const id = pathname.slice("/api/approvals/".length);
      const body = (await this.readJson(req)) as { allow?: unknown };
      const resolved = this.service.approvals.resolve(id, body.allow === true);
      if (!resolved) {
        this.sendJson(res, 404, { ok: false, error: "Approval not found or expired" });
        return;
      }
      this.sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/auto-accept") {
      const body = (await this.readJson(req)) as { seconds?: unknown };
      const seconds = Math.max(0, Math.trunc(Number(body.seconds ?? 0)));
      const until = this.service.setAutoAccept(seconds);
      this.sendJson(res, 200, {
        ok: true,
        until,
        remaining: this.service.autoAcceptRemainingSec(),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/cancel") {
      this.service.cancelAll();
      this.sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/tools") {
      this.sendJson(res, 200, {
        ok: true,
        tools: this.service.toolSpecs.map((spec) => ({
          name: spec.name,
          description: spec.description,
          risk: spec.risk,
          approval: spec.approval,
        })),
      });
      return;
    }

    this.sendJson(res, 404, { ok: false, error: "Not found" });
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    if (req.method === "POST") {
      body = await this.readJson(req, MAX_JSON_BODY);
    }
    const server = new McpServer({ name: "lm-computer", version: VERSION });
    this.registerMcpTools(server);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private registerMcpTools(server: McpServer): void {
    // The SDK's generic inference over a dynamic Zod shape is extremely deep.
    // The shapes are validated by the MCP SDK at runtime, so the dynamic call
    // is intentionally untyped here.
    const registerTool = server.registerTool.bind(server) as (
      name: string,
      config: { description: string; inputSchema: Record<string, unknown> },
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => unknown;
    for (const spec of this.service.toolSpecs) {
      registerTool(
        spec.name,
        {
          description: spec.description,
          inputSchema: spec.parameters,
        },
        async (args: Record<string, unknown>) => {
          try {
            const result = await this.service.executeTool(spec.name, args, { origin: "mcp" });
            return { content: [{ type: "text" as const, text: result.text }] };
          } catch (error) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Error: ${errorMessage(error)}` }],
            };
          }
        },
      );
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const expected = `Bearer ${this.service.config.token}`;
    const header = String(req.headers.authorization ?? "");
    if (header.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private async readJson(req: IncomingMessage, limit = MAX_JSON_BODY): Promise<unknown> {
    const buffer = await this.readBuffer(req, limit);
    if (buffer.length === 0) return {};
    try {
      return JSON.parse(buffer.toString("utf8")) as unknown;
    } catch {
      throw new ToolInputError("Invalid JSON body");
    }
  }

  private readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          reject(new ToolInputError(`Request body is larger than ${limit} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  private setCors(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return;
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
