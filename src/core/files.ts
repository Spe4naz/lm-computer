import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { PathGuard } from "./paths";

const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_VISITED = 10_000;
const MAX_SEARCH_MS = 5_000;

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  modified: number;
  symlink: boolean;
}

export interface ReadResult {
  path: string;
  size: number;
  content: string;
}

export interface WriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

export class FileTools {
  constructor(private readonly guard: PathGuard) {}

  get root(): string {
    return this.guard.root;
  }

  resolve(input?: string | null): Promise<string> {
    return this.guard.resolve(input);
  }

  async list(input?: string): Promise<FileEntry[]> {
    const absolute = await this.guard.resolve(input);
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw new Error("Path is not a directory");
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries.slice(0, MAX_LIST_ENTRIES)) {
      const full = path.join(absolute, entry.name);
      let st: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        // lstat, not stat: listing must not follow a symlink and expose the
        // size/mtime of a target outside the workspace.
        st = await fs.lstat(full);
      } catch {
        continue;
      }
      const link = entry.isSymbolicLink();
      const type: FileEntry["type"] = entry.isDirectory()
        ? "dir"
        : entry.isFile()
          ? "file"
          : link
            ? "symlink"
            : "other";
      result.push({
        name: entry.name,
        path: this.guard.relative(full),
        type,
        size: type === "file" ? st.size : 0,
        modified: st.mtimeMs,
        symlink: link,
      });
    }
    result.sort((a, b) => {
      if (a.type === "dir" && b.type !== "dir") return -1;
      if (a.type !== "dir" && b.type === "dir") return 1;
      return a.name.localeCompare(b.name, "ru");
    });
    return result;
  }

  async read(input: string, maxBytes?: number): Promise<ReadResult> {
    const absolute = await this.guard.resolve(input);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("Path is not a file");
    const limit = Math.max(1, Math.min(MAX_READ_BYTES, maxBytes ?? MAX_READ_BYTES));
    if (stat.size > limit) {
      throw new Error(
        `File is larger than the read limit (${stat.size} > ${limit} bytes). Use a shell command or raise max_bytes.`,
      );
    }
    const buffer = await fs.readFile(absolute);
    if (buffer.includes(0)) {
      throw new Error("Refusing to read a binary file as text");
    }
    return {
      path: this.guard.relative(absolute),
      size: buffer.length,
      content: buffer.toString("utf8"),
    };
  }

  async write(
    input: string,
    content: string,
    mode: "create" | "overwrite" | "append" = "overwrite",
  ): Promise<WriteResult> {
    const buffer = Buffer.from(content, "utf8");
    return this.writeBuffer(input, buffer, mode);
  }

  async writeBuffer(
    input: string,
    buffer: Buffer,
    mode: "create" | "overwrite" | "append" = "overwrite",
  ): Promise<WriteResult> {
    if (buffer.length > MAX_WRITE_BYTES) {
      throw new Error(`Content is larger than ${MAX_WRITE_BYTES} bytes`);
    }
    const absolute = await this.guard.resolve(input);
    if (absolute === this.guard.root) throw new Error("Cannot write to the workspace root");
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    if (mode === "append") {
      const existed = await exists(absolute);
      if (process.platform !== "win32") {
        // O_NOFOLLOW closes the race between PathGuard.resolve() and a symlink
        // created at the final component.
        const handle = await fs.open(
          absolute,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_APPEND |
            constants.O_NOFOLLOW,
          0o644,
        );
        try {
          await handle.writeFile(buffer);
        } finally {
          await handle.close();
        }
      } else {
        await fs.appendFile(absolute, buffer, { mode: 0o644 });
      }
      return { path: this.guard.relative(absolute), bytes: buffer.length, created: !existed };
    }

    if (mode === "create") {
      await fs.writeFile(absolute, buffer, { flag: "wx", mode: 0o644 });
      return { path: this.guard.relative(absolute), bytes: buffer.length, created: true };
    }

    const existed = await exists(absolute);
    const tmp = path.join(
      path.dirname(absolute),
      `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`,
    );
    await fs.writeFile(tmp, buffer, { mode: 0o644 });
    await fs.rename(tmp, absolute);
    return { path: this.guard.relative(absolute), bytes: buffer.length, created: !existed };
  }

  async mkdir(input: string): Promise<{ path: string }> {
    const absolute = await this.guard.resolve(input);
    await fs.mkdir(absolute, { recursive: true });
    return { path: this.guard.relative(absolute) };
  }

  async move(from: string, to: string, overwrite = false): Promise<{ from: string; to: string }> {
    const source = await this.guard.resolve(from);
    const target = await this.guard.resolve(to);
    if (!overwrite && (await exists(target))) {
      throw new Error("Destination already exists. Pass overwrite=true to replace it.");
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // rename() cannot cross filesystems (e.g. workspace on another mount).
      if (overwrite && (await exists(target))) {
        await fs.rm(target, { recursive: true, force: true });
      }
      await fs.cp(source, target, { recursive: true, force: overwrite });
      await fs.rm(source, { recursive: true, force: true });
    }
    return {
      from: this.guard.relative(source),
      to: this.guard.relative(target),
    };
  }

  async deleteToTrash(input: string, homeDir: string): Promise<{ from: string; trash: string }> {
    const absolute = await this.guard.resolve(input);
    if (absolute === this.guard.root) throw new Error("Refusing to delete the workspace root");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashRoot = path.join(homeDir, "trash");
    await fs.mkdir(trashRoot, { recursive: true });
    let destination = path.join(trashRoot, `${stamp}-${path.basename(absolute)}`);
    let counter = 1;
    while (await exists(destination)) {
      destination = path.join(trashRoot, `${stamp}-${counter}-${path.basename(absolute)}`);
      counter += 1;
    }
    try {
      await fs.rename(absolute, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await fs.cp(absolute, destination, { recursive: true });
      await fs.rm(absolute, { recursive: true, force: true });
    }
    return { from: this.guard.relative(absolute), trash: destination };
  }

  async search(
    query: string,
    glob?: string,
    maxResults = 50,
  ): Promise<Array<{ path: string; matches?: Array<{ line: number; text: string }> }>> {
    const text = query.trim();
    if (text.length === 0 && !glob) throw new Error("Provide a query or a glob");
    const limit = Math.max(1, Math.min(200, maxResults));
    const matcher = glob ? globToRegExp(glob) : null;
    const results: Array<{ path: string; matches?: Array<{ line: number; text: string }> }> = [];
    const deadline = Date.now() + MAX_SEARCH_MS;
    let visited = 0;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (results.length >= limit || depth > 8) return;
      if (visited >= MAX_SEARCH_VISITED || Date.now() > deadline) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= limit) return;
        if (visited >= MAX_SEARCH_VISITED || Date.now() > deadline) return;
        visited += 1;
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        const rel = this.guard.relative(full);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (matcher && !matcher.test(rel)) continue;
        const nameMatches = text.length > 0 && entry.name.toLowerCase().includes(text.toLowerCase());
        const lineMatches: Array<{ line: number; text: string }> = [];
        if (text.length > 0) {
          try {
            const stat = await fs.stat(full);
            if (stat.size <= 512 * 1024) {
              const buffer = await fs.readFile(full);
              if (!buffer.includes(0)) {
                const lines = buffer.toString("utf8").split(/\r?\n/);
                for (let index = 0; index < lines.length; index += 1) {
                  if (lines[index].toLowerCase().includes(text.toLowerCase())) {
                    lineMatches.push({
                      line: index + 1,
                      text: lines[index].slice(0, 300),
                    });
                    if (lineMatches.length >= 3) break;
                  }
                }
              }
            }
          } catch {
            // Skip unreadable files.
          }
        }
        if (nameMatches || lineMatches.length > 0) {
          results.push(lineMatches.length > 0 ? { path: rel, matches: lineMatches } : { path: rel });
        }
      }
    };

    await walk(this.guard.root, 0);
    return results;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}
