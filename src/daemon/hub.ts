import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import {
  encode,
  lineReader,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DaemonMessage,
  type Request,
  type Result,
  type SessionInfo,
  type SessionState,
} from "../remote/protocol.ts";

/** A running Pi session connected to the daemon. */
export interface LiveSession {
  pid: number;
  host: string;
  pane?: string;
  session: SessionInfo;
  state: SessionState;
  notify: boolean;
  /** When it connected, for a stable order. */
  since: number;
  socket: Socket;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type RequestBody = WithoutId<Request>;

/** The daemon's Unix socket, which every interactive Pi session connects to. */
export class SessionHub {
  private readonly events = new EventEmitter();
  private readonly live = new Map<Socket, LiveSession>();
  private readonly sockets = new Set<Socket>();
  private readonly waiting = new Map<string, { socket: Socket; resolve: (result: Result) => void; timer: NodeJS.Timeout }>();
  private server: Server | undefined;
  private path: string | undefined;
  private away = false;

  async listen(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (await isListening(path)) throw new Error(`Another daemon is listening on ${path}.`);
    // A daemon that crashed leaves its socket file behind.
    await rm(path, { force: true });
    const server = createServer((socket) => this.accept(socket));
    // Create the socket as mode 600, so no other user can connect in any directory.
    const umask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } finally {
      process.umask(umask);
    }
    await chmod(path, 0o600);
    this.server = server;
    this.path = path;
  }

  /** Connected sessions, oldest first. */
  sessions(): LiveSession[] {
    return [...this.live.values()].sort((a, b) => a.since - b.since);
  }

  /** The process that has the session open, the newest if several do. */
  find(sessionId: string): LiveSession | undefined {
    return this.sessions().filter((live) => live.session.id === sessionId).at(-1);
  }

  /** Wait until a matching session connects. */
  waitFor(match: (live: LiveSession) => boolean, timeout: number): Promise<LiveSession> {
    const found = this.sessions().find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const onHello = (live: LiveSession) => {
        if (!match(live)) return;
        clearTimeout(timer);
        this.events.off("hello", onHello);
        resolve(live);
      };
      const timer = setTimeout(() => {
        this.events.off("hello", onHello);
        reject(new Error(`Pi did not connect within ${Math.round(timeout / 1000)} s. ` +
          "Check that the pi-telegram-notification extension is installed."));
      }, timeout);
      this.events.on("hello", onHello);
    });
  }

  /** Send a request and wait for the session's result. */
  request(target: LiveSession, body: RequestBody, timeout = 15_000): Promise<Result> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({ type: "result", id, ok: false, message: "Pi did not answer." });
      }, timeout);
      this.waiting.set(id, { socket: target.socket, resolve, timer });
      this.write(target.socket, { ...body, id } as Request);
    });
  }

  setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    for (const socket of this.live.keys()) this.write(socket, { type: "away", away });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    if (this.path) await rm(this.path, { force: true });
  }

  private write(socket: Socket, message: DaemonMessage): void {
    if (!socket.destroyed) socket.write(encode(message));
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("data", lineReader((value) => this.receive(socket, value as ClientMessage)));
    socket.on("error", () => {});
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.live.delete(socket);
      for (const [id, waiting] of this.waiting) {
        if (waiting.socket !== socket) continue;
        clearTimeout(waiting.timer);
        this.waiting.delete(id);
        waiting.resolve({ type: "result", id, ok: false, message: "The session closed." });
      }
    });
  }

  private receive(socket: Socket, message: ClientMessage): void {
    switch (message?.type) {
      case "hello": {
        if (message.version !== PROTOCOL_VERSION) {
          socket.destroy();
          return;
        }
        const live: LiveSession = {
          pid: message.pid,
          host: message.host,
          pane: message.pane,
          session: message.session,
          state: message.state,
          notify: message.notify,
          since: Date.now(),
          socket,
        };
        this.live.set(socket, live);
        this.write(socket, { type: "away", away: this.away });
        this.events.emit("hello", live);
        return;
      }
      case "update": {
        const live = this.live.get(socket);
        if (!live) return;
        if (message.session) live.session = message.session;
        if (message.state) live.state = message.state;
        if (message.notify !== undefined) live.notify = message.notify;
        return;
      }
      case "result": {
        const waiting = this.waiting.get(message.id);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        this.waiting.delete(message.id);
        waiting.resolve(message);
        return;
      }
    }
  }
}

function isListening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
