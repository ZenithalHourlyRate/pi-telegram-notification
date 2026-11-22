/** The parts of Telegram's Bot API types that the daemon reads. */

export interface TgUser {
  id: number;
  is_bot?: boolean;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface TgFile {
  file_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TgPhotoSize extends TgFile {
  width: number;
  height: number;
}

export interface TgDocument extends TgFile {
  file_name?: string;
  mime_type?: string;
}

export interface TgAudio extends TgFile {
  duration: number;
  file_name?: string;
  mime_type?: string;
  title?: string;
  performer?: string;
}

export interface TgVoice extends TgFile {
  duration: number;
  mime_type?: string;
}

export interface TgVideo extends TgFile {
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
}

export interface TgVideoNote extends TgFile {
  length: number;
  duration: number;
}

export interface TgSticker extends TgFile {
  width: number;
  height: number;
  is_animated?: boolean;
  is_video?: boolean;
  emoji?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  /** Set when the message was sent on behalf of a chat. */
  sender_chat?: TgChat;
  /** Set for messages of a connected business account. */
  business_connection_id?: string;
  /** Set for messages to the bot as a guest in another chat. */
  guest_query_id?: string;
  text?: string;
  caption?: string;
  media_group_id?: string;
  reply_to_message?: TgMessage;
  quote?: { text: string };
  photo?: TgPhotoSize[];
  document?: TgDocument;
  audio?: TgAudio;
  voice?: TgVoice;
  video?: TgVideo;
  video_note?: TgVideoNote;
  /** Telegram also sets document for an animation. */
  animation?: TgVideo;
  sticker?: TgSticker;
  /** The other messages of an album. Set by the daemon, not by Telegram. */
  album?: TgMessage[];
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  /** Missing for buttons of inline-mode messages, which belong to no chat of the bot. */
  message?: TgMessage;
  inline_message_id?: string;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgButton {
  text: string;
  callback_data: string;
}
