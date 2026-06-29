import { env } from "cloudflare:workers";

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};

// Notify the admin via a Telegram bot. Needs two Worker secrets:
//   TELEGRAM_BOT_TOKEN  - the bot token from @BotFather
//   TELEGRAM_CHAT_ID    - the chat/user id to send to (your own id, or a group)
// No-op (and never throws) when either is missing.
export async function notifyTelegram(text: string): Promise<void> {
  const token = v("TELEGRAM_BOT_TOKEN");
  const chatId = v("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {}
}

// Escape user text for Telegram HTML parse mode.
export function tgEscape(s: string): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
