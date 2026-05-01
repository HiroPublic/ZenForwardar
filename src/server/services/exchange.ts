import { config } from "../config";

export interface ExchangeQuote {
  rate: number;
  date: string;
  jpyAmount: number;
}

export async function convertToJpy(currency: string | undefined, amount: number | undefined): Promise<ExchangeQuote | undefined> {
  if (!currency || !amount) return undefined;
  if (currency.toUpperCase() === "JPY") {
    return { rate: 1, date: new Date().toISOString().slice(0, 10), jpyAmount: Math.round(amount) };
  }

  if (config.EXCHANGE_RATE_PROVIDER === "exchangerate.host" && config.EXCHANGE_RATE_API_KEY) {
    const url = new URL("https://api.exchangerate.host/convert");
    url.searchParams.set("from", currency);
    url.searchParams.set("to", "JPY");
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("access_key", config.EXCHANGE_RATE_API_KEY);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch exchange rate");
    const data = (await response.json()) as { result?: number; info?: { quote?: number }; date?: string };
    const rate = data.info?.quote ?? (data.result ? data.result / amount : undefined);
    if (!rate || !data.result) throw new Error("Exchange rate response was incomplete");
    return { rate, date: data.date ?? new Date().toISOString().slice(0, 10), jpyAmount: Math.round(data.result) };
  }

  const fallbackRates: Record<string, number> = {
    USD: 155,
    EUR: 166,
    GBP: 194,
    KRW: 0.11,
    TWD: 4.8,
    THB: 4.2,
    SGD: 114
  };
  const rate = fallbackRates[currency.toUpperCase()] ?? 1;
  return { rate, date: new Date().toISOString().slice(0, 10), jpyAmount: Math.round(amount * rate) };
}
