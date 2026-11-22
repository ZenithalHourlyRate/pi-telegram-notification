import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A Telegram message and the Pi session it belongs to. Replying to the message talks to the session. */
export interface MessageLink {
  message: number;
  session: string;
  file?: string;
  cwd?: string;
}

/** Append links. Pi sessions and the daemon both append; short appends do not interleave. */
export async function appendLinks(path: string, links: MessageLink[]): Promise<void> {
  if (!links.length) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const time = Date.now();
  await appendFile(path, links.map((link) => `${JSON.stringify({ ...link, time })}\n`).join(""), { mode: 0o600 });
}

/** The daemon's view of the links file, read again when a message is not found. */
export class LinkIndex {
  readonly path: string;
  private links = new Map<number, MessageLink>();
  private readSize = -1;

  constructor(path: string) {
    this.path = path;
  }

  async lookup(message: number): Promise<MessageLink | undefined> {
    if (!this.links.has(message)) await this.load();
    return this.links.get(message);
  }

  async add(links: MessageLink[]): Promise<void> {
    for (const link of links) this.links.set(link.message, link);
    await appendLinks(this.path, links);
  }

  /** Keep the newest links when the file grows large. */
  async prune(keep = 20_000): Promise<void> {
    const lines = await this.lines();
    if (lines.length <= keep * 1.5) return;
    await writeFile(this.path, `${lines.slice(-keep).join("\n")}\n`, { mode: 0o600 });
    this.readSize = -1;
  }

  private async load(): Promise<void> {
    const size = await stat(this.path).then((info) => info.size, () => 0);
    if (size === this.readSize) return;
    this.readSize = size;
    for (const line of await this.lines()) {
      try {
        const link = JSON.parse(line) as MessageLink;
        if (typeof link.message === "number" && typeof link.session === "string") this.links.set(link.message, link);
      } catch {
        // A line cut short by a crash.
      }
    }
  }

  private async lines(): Promise<string[]> {
    const text = await readFile(this.path, "utf8").catch(() => "");
    return text.split("\n").filter(Boolean);
  }
}
