import { promises as fs } from "node:fs";
import path from "node:path";

export class PathOutsideWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathOutsideWorkspaceError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Resolves user-supplied paths and guarantees they stay inside the workspace,
 * including through symlinks and non-existing intermediate directories.
 */
export class PathGuard {
  private constructor(
    readonly root: string,
    private readonly rootReal: string,
  ) {}

  static async create(root: string): Promise<PathGuard> {
    const absolute = path.resolve(root);
    await fs.mkdir(absolute, { recursive: true });
    const real = await fs.realpath(absolute);
    return new PathGuard(absolute, real);
  }

  async resolve(input: string | undefined | null): Promise<string> {
    const raw = (input ?? "").trim();
    if (raw.includes("\0")) {
      throw new PathOutsideWorkspaceError("Path contains a NUL byte");
    }
    const candidate =
      raw.length === 0
        ? this.root
        : path.isAbsolute(raw)
          ? path.normalize(raw)
          : path.resolve(this.root, raw);

    const real = await realpathNearest(candidate);
    if (!this.isWithinRoot(real)) {
      throw new PathOutsideWorkspaceError(
        `Path is outside the workspace: ${raw || "."}`,
      );
    }
    return candidate;
  }

  relative(absolute: string): string {
    const rel = path.relative(this.root, absolute);
    return rel.split(path.sep).join("/");
  }

  private isWithinRoot(candidate: string): boolean {
    if (process.platform === "win32") {
      return isInside(this.rootReal.toLowerCase(), candidate.toLowerCase());
    }
    return isInside(this.rootReal, candidate);
  }
}

/**
 * Follows symlinks of the deepest existing ancestor. This catches a symlinked
 * parent directory even when the final file does not exist yet.
 */
async function realpathNearest(input: string): Promise<string> {
  let current = input;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}
