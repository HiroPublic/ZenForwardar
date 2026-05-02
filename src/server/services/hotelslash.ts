import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";
import type { CurrentReservationInfo } from "../../shared/types";

export interface HotelSlashOffer {
  pageUrl: string;
  priceCurrency: string;
  priceAmount: number;
  roomType: string;
  conditions: string[];
  currentReservation?: CurrentReservationInfo;
}

let loginContext: BrowserContext | undefined;

export async function extractTopHotelSlashOffer(pageUrl: string): Promise<HotelSlashOffer> {
  if (loginContext) {
    throw new Error("HotelSlash login window is still open. Click ログイン完了 after signing in, then run Gmail sync again.");
  }
  const context = await chromium.launchPersistentContext(getHotelSlashProfileDir(), {
    headless: true,
    viewport: { width: 1440, height: 1100 }
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    return await parseRenderedOffer(page, pageUrl);
  } finally {
    await context.close();
  }
}

export async function startHotelSlashLoginSession() {
  if (loginContext) return getHotelSlashLoginStatus();
  const profileDir = getHotelSlashProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });
  loginContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 }
  });
  const page = loginContext.pages()[0] ?? (await loginContext.newPage());
  await page.goto("https://www.hotelslash.com/Account/LogIn", { waitUntil: "domcontentloaded", timeout: 45_000 });
  return getHotelSlashLoginStatus();
}

export async function finishHotelSlashLoginSession() {
  if (loginContext) {
    await loginContext.close();
    loginContext = undefined;
  }
  return getHotelSlashLoginStatus();
}

export function getHotelSlashLoginStatus() {
  return {
    profileDir: getHotelSlashProfileDir(),
    profileExists: fs.existsSync(getHotelSlashProfileDir()),
    loginWindowOpen: Boolean(loginContext)
  };
}

export function parseTopHotelSlashOffer(text: string, pageUrl = ""): HotelSlashOffer {
  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const topOfferLines = sliceTopOfferLines(normalizedLines);
  const currentReservation = parseCurrentReservation(normalizedLines);
  const price = findPrice(topOfferLines) ?? findPrice(normalizedLines);
  if (!price) throw new Error("HotelSlash price could not be extracted from the rendered rates page.");

  const priceLineIndex = topOfferLines.findIndex((line) => line.includes(price.raw));
  const roomType =
    findRoomType(topOfferLines.slice(0, priceLineIndex >= 0 ? priceLineIndex : topOfferLines.length)) ?? findRoomType(topOfferLines);
  if (!roomType) throw new Error("HotelSlash room type could not be extracted from the rendered rates page.");

  return {
    pageUrl,
    priceCurrency: price.currency,
    priceAmount: price.amount,
    roomType,
    conditions: findConditions(topOfferLines),
    currentReservation
  };
}

function sliceTopOfferLines(lines: string[]) {
  const startMarkers = [/Your HotelSlash Rates/i, /Rebook your .*lower rate/i];
  const startCandidates = startMarkers.map((pattern) => lines.findIndex((line) => pattern.test(line))).filter((index) => index >= 0);
  const start = startCandidates.length ? Math.min(...startCandidates) : 0;
  const afterStart = lines.slice(start);
  const end = afterStart.findIndex((line, index) => index > 0 && /Other deals|Results expire|Photos, Amenities, Description/i.test(line));
  return end >= 0 ? afterStart.slice(0, end) : afterStart.slice(0, 40);
}

function findPrice(lines: string[]) {
  const currencyCode = "JPY|USD|EUR|GBP|AUD|CAD|TRY|AED|SAR|QAR|OMR|BHD|KWD|CHF|SEK|NOK|DKK|ISK|HUF|CZK|PLN|RON|BGN|GEL|INR|IDR|THB|VND|SGD|HKD|TWD|KRW|CNY|MYR|PHP|MXN|BRL|ARS|CLP|COP|ZAR|MAD|EGP";
  const amountPattern = String.raw`\d{1,3}(?:[,.]\d{3})+(?:[,.]\d{2})?|\d+(?:[,.]\d{2})?`;
  const currencyPattern = String.raw`(?<![A-Z])(?:${currencyCode})(?![A-Z])|¥|\$|€|£|₺`;
  for (const line of lines) {
    if (/earn|slashcash/i.test(line) || /^\s*save\b/i.test(line)) continue;
    const searchableLine = line.replace(/\bSave\b.*$/i, "");
    const currencyFirst = searchableLine.match(new RegExp(String.raw`(?<currency>${currencyPattern})\s*(?<amount>${amountPattern})`, "i"));
    const amountFirst = searchableLine.match(new RegExp(String.raw`(?<amount>${amountPattern})\s*(?<currency>${currencyPattern})`, "i"));
    const match = currencyFirst ?? amountFirst;
    if (!match?.groups) continue;
    return {
      raw: match[0],
      currency: normalizeCurrency(match.groups.currency),
      amount: parsePriceAmount(match.groups.amount)
    };
  }
  return undefined;
}

function parseCurrentReservation(lines: string[]): CurrentReservationInfo | undefined {
  const currentLines = sliceCurrentReservationLines(lines);
  if (!currentLines.length) return undefined;
  const price = findPrice(currentLines);
  const priceLineIndex = price ? currentLines.findIndex((line) => line.includes(price.raw)) : -1;
  const roomType = findRoomType(currentLines.slice(0, priceLineIndex >= 0 ? priceLineIndex : currentLines.length)) ?? findRoomType(currentLines);
  const cancellationDeadline = currentLines.find((line) => /cancel before|free cancellation until|cancellation/i.test(line));
  const paymentTerms = currentLines.find((line) => /\bprepaid\b|pay at|pay later|pay deposit/i.test(line));
  const conditions = findCurrentReservationConditions(currentLines);

  if (!price && !roomType && !cancellationDeadline && !paymentTerms && !conditions.length) return undefined;
  return {
    priceCurrency: price?.currency,
    priceAmount: price?.amount,
    roomType,
    conditions,
    cancellationDeadline,
    paymentTerms
  };
}

function sliceCurrentReservationLines(lines: string[]) {
  const start = lines.findIndex((line) => /details of your current reservation/i.test(line));
  const end = lines.findIndex((line) => /Your HotelSlash Rates/i.test(line));
  if (start >= 0 && end > start) {
    const cardLines = lines.slice(start + 1, end);
    const cardEnd = cardLines.findIndex((line) => /^at the$/i.test(line) || /Hotel Overview|Location|Amenities|Address/i.test(line));
    return cardEnd >= 0 ? cardLines.slice(0, cardEnd) : cardLines;
  }
  if (end > 0) return lines.slice(0, end);
  return [];
}

function findCurrentReservationConditions(lines: string[]) {
  const conditions: string[] = [];
  for (const line of lines) {
    if (/room only/i.test(line)) conditions.push("Room Only");
    if (/breakfast/i.test(line)) conditions.push(titleCaseCondition(line));
  }
  return [...new Set(conditions)];
}

function findRoomType(lines: string[]) {
  const ignored = /hello|found|rates|rebook|change|save|earn|slashcash|pay deposit|prepaid|included|refundable|photos|amenities|description/i;
  return lines.find((line) => !ignored.test(line) && /room|suite|king|queen|twin|double|bed|villa|apartment|studio/i.test(line));
}

function findConditions(lines: string[]) {
  const conditions: string[] = [];
  for (const line of lines) {
    if (/breakfast/i.test(line)) conditions.push(titleCaseCondition(line));
    if (/fully refundable|non[- ]?refundable|free cancellation|cancel/i.test(line)) conditions.push(titleCaseCondition(line));
    if (/pay deposit/i.test(line)) conditions.push("Pay Deposit");
    if (/\bprepaid\b/i.test(line)) conditions.push("Prepaid");
  }
  return [...new Set(conditions)];
}

function normalizeCurrency(value: string) {
  const symbolMap: Record<string, string> = { "¥": "JPY", $: "USD", "€": "EUR", "£": "GBP", "₺": "TRY" };
  return symbolMap[value] ?? value.toUpperCase();
}

function parsePriceAmount(value: string) {
  if (value.includes(",") && value.includes(".")) {
    return value.lastIndexOf(",") > value.lastIndexOf(".")
      ? Number(value.replace(/\./g, "").replace(",", "."))
      : Number(value.replace(/,/g, ""));
  }
  if (/\.\d{3}(?:\.|$)/.test(value)) return Number(value.replace(/\./g, "").replace(",", "."));
  if (/,\d{2}$/.test(value)) return Number(value.replace(/\./g, "").replace(",", "."));
  return Number(value.replace(/,/g, ""));
}

function titleCaseCondition(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

async function parseRenderedOffer(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>, originalUrl: string) {
  let lastText = "";
  let lastError: unknown;
  const deadline = Date.now() + 75_000;

  while (Date.now() < deadline) {
    lastText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    if (isHotelSlashLoginPage(page.url(), lastText)) {
      throw new Error(
        [
          "HotelSlash login is required before rates can be extracted.",
          `Requested URL: ${originalUrl}`,
          `Final URL: ${page.url()}`,
          "Please sign in to HotelSlash in a browser session that this automation can use, then run Gmail sync again."
        ].join(" ")
      );
    }
    if (lastText.trim()) {
      try {
        return parseTopHotelSlashOffer(lastText, page.url());
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(2_000);
  }

  const title = await page.title().catch(() => "(title unavailable)");
  const excerpt = lastText.replace(/\s+/g, " ").trim().slice(0, 500);
  const detail = lastError instanceof Error ? lastError.message : "No parse attempt succeeded.";
  throw new Error(
    [
      "HotelSlash rates page loaded, but the top offer could not be extracted.",
      `Requested URL: ${originalUrl}`,
      `Final URL: ${page.url()}`,
      `Title: ${title}`,
      `Parse detail: ${detail}`,
      excerpt ? `Visible text excerpt: ${excerpt}` : "Visible text excerpt: (empty)"
    ].join(" ")
  );
}

function isHotelSlashLoginPage(url: string, text: string) {
  return /\/Account\/LogIn/i.test(url) || /Sign in to your account|Your password|Forgot password/i.test(text);
}

function getHotelSlashProfileDir() {
  return path.resolve(process.cwd(), ".hotelslash-profile");
}
