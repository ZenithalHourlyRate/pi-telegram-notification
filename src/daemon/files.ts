import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { TgFile, TgMessage } from "./types.ts";

/** Bots can download files of up to 20 MB from Telegram's servers. */
const DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export interface Attachment {
  messageId: number;
  file: TgFile;
  /** Name for the saved file. */
  name: string;
  /** What Pi is told about the file, such as "voice message, audio/ogg, 0:12". */
  description: string;
}

export interface SavedFile {
  path: string;
  description: string;
}

export type Download = (fileId: string) => Promise<{ data: Uint8Array; filePath?: string }>;

/** Everything attached to a message or album. Pi gets each one as a file. */
export function attachmentsOf(message: TgMessage): Attachment[] {
  return (message.album ?? [message]).flatMap(attachmentsOfOne);
}

function attachmentsOfOne(message: TgMessage): Attachment[] {
  const found: Array<Omit<Attachment, "messageId">> = [];
  const photo = message.photo?.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  if (photo) {
    found.push({ file: photo, name: "photo.jpg", description: describe("photo", `${photo.width}×${photo.height}`, photo) });
  }
  if (message.animation) {
    const { animation } = message;
    found.push({
      file: animation,
      name: animation.file_name ?? "animation.mp4",
      description: describe("animation", animation.mime_type, duration(animation.duration), animation),
    });
  } else if (message.document) {
    const { document } = message;
    found.push({ file: document, name: document.file_name ?? "file", description: describe("file", document.mime_type, document) });
  }
  if (message.audio) {
    const { audio } = message;
    const title = [audio.performer, audio.title].filter(Boolean).join(" – ");
    found.push({
      file: audio,
      name: audio.file_name ?? "audio",
      description: describe("audio", title, audio.mime_type, duration(audio.duration), audio),
    });
  }
  if (message.voice) {
    const { voice } = message;
    found.push({
      file: voice,
      name: "voice.ogg",
      description: describe("voice message", voice.mime_type ?? "audio/ogg", duration(voice.duration), voice),
    });
  }
  if (message.video) {
    const { video } = message;
    found.push({
      file: video,
      name: video.file_name ?? "video.mp4",
      description: describe("video", video.mime_type, `${video.width}×${video.height}`, duration(video.duration), video),
    });
  }
  if (message.video_note) {
    const note = message.video_note;
    found.push({ file: note, name: "video-message.mp4", description: describe("video message", duration(note.duration), note) });
  }
  if (message.sticker) {
    const { sticker } = message;
    const name = sticker.is_video ? "sticker.webm" : sticker.is_animated ? "sticker.tgs" : "sticker.webp";
    found.push({ file: sticker, name, description: describe("sticker", sticker.emoji, sticker) });
  }
  return found.map((attachment) => ({ ...attachment, messageId: message.message_id }));
}

function describe(kind: string, ...details: Array<string | TgFile | undefined>): string {
  return [kind, ...details.map((detail) => (typeof detail === "object" ? size(detail.file_size) : detail))]
    .filter(Boolean)
    .join(", ");
}

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function size(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Keep letters, digits, dots and dashes, so the path needs no quoting. */
function safeName(name: string): string {
  const extension = extname(name).replace(/[^\w.-]+/g, "").slice(0, 16);
  const base = name.slice(0, name.length - extname(name).length).replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `${base || "file"}${extension}`;
}

/** Save attachments under dir/YYYY-MM-DD/. Failures are described instead of thrown. */
export async function saveAttachments(
  dir: string,
  attachments: Attachment[],
  download: Download,
): Promise<{ saved: SavedFile[]; failed: string[] }> {
  const saved: SavedFile[] = [];
  const failed: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const target = join(dir, day);
  for (const [index, attachment] of attachments.entries()) {
    if ((attachment.file.file_size ?? 0) > DOWNLOAD_LIMIT) {
      failed.push(`${attachment.name} (${attachment.description}): larger than the 20 MB that bots can download`);
      continue;
    }
    try {
      const { data, filePath } = await download(attachment.file.file_id);
      // Telegram's own path has the real extension, such as .oga for voice messages.
      let name = attachment.name;
      if (!extname(name) && filePath && extname(filePath)) name += extname(filePath);
      await mkdir(target, { recursive: true, mode: 0o700 });
      const path = join(target, `${attachment.messageId}-${index + 1}-${safeName(name)}`);
      await writeFile(path, data, { mode: 0o600 });
      saved.push({ path, description: attachment.description });
    } catch (error) {
      failed.push(`${attachment.name} (${attachment.description}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { saved, failed };
}

/** The prompt for Pi: the quoted part of the replied message, the text, then the files. */
export function composePrompt(text: string, quote: string | undefined, saved: SavedFile[], failed: string[]): string {
  const parts: string[] = [];
  if (quote?.trim()) parts.push(quote.trim().split("\n").map((line) => `> ${line}`).join("\n"));
  if (text.trim()) parts.push(text.trim());
  if (saved.length) {
    parts.push(["Files sent from Telegram:", ...saved.map((file) => `- ${file.path} (${file.description})`)].join("\n"));
  }
  if (failed.length) {
    parts.push(["Files from Telegram that could not be saved:", ...failed.map((line) => `- ${line}`)].join("\n"));
  }
  return parts.join("\n\n");
}
