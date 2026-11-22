import { lstatSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { encode, lineReader, type ClientMessage, type DaemonMessage, type Hello } from "./protocol.ts";

export interface RemoteClientOptions {
  path: string;
  /** Called on each connection, so a restarted daemon learns the current state. */
  hello: () => Hello;
  onMessage: (message: DaemonMessage) => void;
  retryMs?: number;
}

/** A Pi session's connection to the daemon. Reconnects until closed; never keeps Pi running. */
export class RemoteClient {
  private readonly options: RemoteClientOptions;
  private socket: Socket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private connected = false;
  private closed = false;

  constructor(options: RemoteClientOptions) {
    this.options = options;
  }

  start(): void {
    this.connect();
  }

  send(message: ClientMessage): void {
    if (this.connected) this.socket?.write(encode(message));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    // end() sends what is still buffered, such as the answer to a /reload, before closing.
    this.socket?.end();
    this.socket = undefined;
    this.connected = false;
  }

  private connect(): void {
    if (this.closed) return;
    // The daemon sends prompts that Pi runs, so only accept a socket that this user created.
    if (!ownedByMe(this.options.path)) {
      this.retry();
      return;
    }
    const socket = createConnection(this.options.path);
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.unref();
    socket.on("connect", () => {
      let hello: string;
      try {
        hello = encode(this.options.hello());
      } catch {
        // The session is gone.
        this.close();
        return;
      }
      this.connected = true;
      socket.write(hello);
    });
    socket.on("data", lineReader((value) => {
      if (typeof value === "object" && value !== null && "type" in value) this.options.onMessage(value as DaemonMessage);
    }));
    // A missing daemon is normal. "close" follows and schedules the next attempt.
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.connected = false;
      this.retry();
    });
  }

  private retry(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => this.connect(), this.options.retryMs ?? 5_000);
    this.timer.unref();
  }
}

function ownedByMe(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isSocket() && info.uid === process.getuid?.();
  } catch {
    return false;
  }
}
