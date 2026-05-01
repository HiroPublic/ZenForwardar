import { markProcessed } from "./gmail";
import { listReservationPagesWithGmailMessageIds } from "./notion";

export async function archiveRecordedReservationEmails(tokens: unknown) {
  const pages = await listReservationPagesWithGmailMessageIds();
  const results: Array<{ pageId: string; title: string; messageId?: string; status: "archived" | "skipped" | "error"; error?: string }> = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const messageId = page.originalGmailMessageId;
    if (!messageId || seen.has(messageId)) {
      results.push({ pageId: page.pageId, title: page.title, messageId, status: "skipped" });
      continue;
    }
    seen.add(messageId);
    try {
      await markProcessed(tokens, messageId);
      results.push({ pageId: page.pageId, title: page.title, messageId, status: "archived" });
    } catch (error) {
      results.push({
        pageId: page.pageId,
        title: page.title,
        messageId,
        status: "error",
        error: error instanceof Error ? error.message : "Unexpected error"
      });
    }
  }

  return {
    archived: results.filter((result) => result.status === "archived").length,
    results
  };
}
