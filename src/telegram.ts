import { callTelegram, RejectedError } from "./api.ts";
import type { TelegramConfig } from "./config.ts";
import { MESSAGE_LIMIT, truncate } from "./format.ts";
import type { RichFile, RichMessage } from "./rich.ts";

export interface TelegramMessage {
  rich: RichMessage;
  /** Telegram HTML for sendMessage, sent if Telegram rejects the rich message. */
  html: string;
  /** Plain text, sent if Telegram rejects the HTML. */
  text: string;
}

export interface Delivery {
  /** "rich message", "rich message without images", "HTML" or "plain text". */
  format: string;
  /** Telegram's reason for rejecting the rich message, when another format was sent. */
  rejection?: string;
  /** The sent message, which a reply in Telegram refers to. */
  messageId: number;
}

/** Send the rich message, or the next format each time Telegram rejects one. */
export async function sendTelegram(
  config: TelegramConfig,
  message: TelegramMessage,
  /** The Telegram message this one answers. */
  replyTo?: number,
): Promise<Delivery> {
  const { rich } = message;
  const extra: Record<string, unknown> = { link_preview_options: { is_disabled: true } };
  if (replyTo !== undefined) extra.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  const attempts: Array<[string, () => Promise<number>]> = [
    ["rich message", () => postRich(config, rich.markdown, rich.files, rich.withoutImages !== undefined, replyTo)],
  ];
  if (rich.withoutImages !== undefined) {
    const markdown = rich.withoutImages;
    attempts.push(["rich message without images", () => postRich(config, markdown, [], false, replyTo)]);
  }
  attempts.push(
    ["HTML", () => post(config, "sendMessage", { text: message.html, parse_mode: "HTML", ...extra })],
    ["plain text", () => post(config, "sendMessage", { text: truncate(message.text, MESSAGE_LIMIT), ...extra })],
  );

  let rejection: string | undefined;
  for (const [index, [format, send]] of attempts.entries()) {
    try {
      const messageId = await send();
      return { format, rejection, messageId };
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "Unknown Telegram error")
        .split(config.botToken).join("[redacted]");
      if (!(error instanceof RejectedError) || index === attempts.length - 1) throw new Error(reason);
      rejection ??= reason;
    }
  }
  throw new Error("No message format left to send.");
}

async function postRich(
  config: TelegramConfig,
  markdown: string,
  files: RichFile[],
  images: boolean,
  replyTo: number | undefined,
): Promise<number> {
  const media = files.map((file) => ({ id: file.id, media: { type: file.kind, media: `attach://${file.id}` } }));
  const richMessage = files.length ? { markdown, media } : { markdown };
  const reply = replyTo === undefined ? undefined : { message_id: replyTo, allow_sending_without_reply: true };
  let body: Record<string, unknown> | FormData = { rich_message: richMessage, ...(reply ? { reply_parameters: reply } : {}) };
  if (files.length) {
    body = new FormData();
    body.append("chat_id", config.chatId);
    body.append("rich_message", JSON.stringify(richMessage));
    if (reply) body.append("reply_parameters", JSON.stringify(reply));
    for (const file of files) body.append(file.id, new Blob([file.data], { type: file.type }), file.name);
  }
  // Telegram downloads or receives the images before it answers.
  return post(config, "sendRichMessage", body, images ? 60_000 : 15_000);
}

/** Send to the configured chat and return the sent message's ID. */
async function post(
  config: TelegramConfig,
  method: string,
  body: Record<string, unknown> | FormData,
  timeout = 15_000,
): Promise<number> {
  // The agent's own signal is aborted on Escape. Notifications must still send.
  const sent = await callTelegram<{ message_id: number }>(
    config.botToken,
    method,
    body instanceof FormData ? body : { chat_id: config.chatId, ...body },
    { timeout },
  );
  return sent.message_id;
}
