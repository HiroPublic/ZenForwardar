import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, KeyRound, Loader2, MailSearch, Power, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import type { PendingForward } from "../shared/types";
import "./styles.css";

type ApiState = "idle" | "loading" | "error";
type ShutdownState = "idle" | "closing";

interface AuthStatus {
  gmailConfigured: boolean;
  gmailAuthenticated: boolean;
  account: string;
}

function App() {
  const [items, setItems] = useState<PendingForward[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editedBody, setEditedBody] = useState("");
  const [apiState, setApiState] = useState<ApiState>("idle");
  const [shutdownState, setShutdownState] = useState<ShutdownState>("idle");
  const [authStatus, setAuthStatus] = useState<AuthStatus>();
  const [message, setMessage] = useState("未処理メールを同期してください。");
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0], [items, selectedId]);

  useEffect(() => {
    void loadAuthStatus();
    void loadPending();
  }, []);

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setEditedBody(selected.generatedBody);
    }
  }, [selected?.id]);

  async function loadPending() {
    const response = await fetch("/api/pending");
    const data = (await response.json()) as { items: PendingForward[] };
    setItems(data.items);
  }

  async function loadAuthStatus() {
    const response = await fetch("/api/auth/status");
    const data = (await response.json()) as AuthStatus;
    setAuthStatus(data);
    if (data.gmailConfigured && !data.gmailAuthenticated) {
      setMessage("Gmail連携が未完了です。先にGmail連携を実行してください。");
    }
  }

  async function sync() {
    if (authStatus?.gmailConfigured && !authStatus.gmailAuthenticated) {
      setApiState("error");
      setMessage("Gmail連携が未完了です。先にGmail連携を実行してください。");
      return;
    }
    setApiState("loading");
    setMessage("Gmail からホテル予約メールを確認しています。");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const data = (await response.json()) as { items?: PendingForward[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "同期に失敗しました。");
      setItems(data.items ?? []);
      setMessage(data.items?.length ? "承認待ちメールを生成しました。" : "新しい承認待ちメールはありません。");
      setApiState("idle");
    } catch (error) {
      setApiState("error");
      setMessage(error instanceof Error ? error.message : "同期に失敗しました。");
    }
  }

  async function approve() {
    if (!selected) return;
    setApiState("loading");
    setMessage("TripIt と HotelSlash へ転送しています。");
    try {
      const response = await fetch(`/api/forward/${selected.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedBody })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "転送に失敗しました。");
      const remaining = items.filter((item) => item.id !== selected.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id);
      setMessage("転送、Notion登録、Gmailラベル付与が完了しました。");
      setApiState("idle");
    } catch (error) {
      setApiState("error");
      setMessage(error instanceof Error ? error.message : "転送に失敗しました。");
    }
  }

  async function dismissAndReload() {
    if (!selected) return;
    setApiState("loading");
    setMessage("この候補を外して、次の候補を読み込んでいます。");
    try {
      const response = await fetch(`/api/forward/${selected.id}/dismiss-and-reload`, {
        method: "POST"
      });
      const data = (await response.json()) as { items?: PendingForward[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "候補の再読み込みに失敗しました。");
      setItems(data.items ?? []);
      setSelectedId(data.items?.[0]?.id);
      setMessage(data.items?.length ? "候補を外して再読み込みしました。" : "候補を外しました。新しい承認待ちメールはありません。");
      setApiState("idle");
    } catch (error) {
      setApiState("error");
      setMessage(error instanceof Error ? error.message : "候補の再読み込みに失敗しました。");
    }
  }

  async function shutdown() {
    setShutdownState("closing");
    setMessage("アプリを終了しています。");
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      // The server may close the connection while shutting down.
    }
  }

  return (
    <main className="app-shell">
      <section className="sidebar">
        <div className="brand">
          <ShieldCheck size={28} />
          <div>
            <h1>ZenForwarder</h1>
            <p>予約翻訳転送</p>
          </div>
        </div>

        {authStatus?.gmailConfigured ? (
          <a className={`auth-action ${authStatus.gmailAuthenticated ? "connected" : ""}`} href="/auth/google">
            <KeyRound size={17} />
            {authStatus.gmailAuthenticated ? "Gmail連携済み" : "Gmail連携"}
          </a>
        ) : null}

        <button className="primary-action" onClick={sync} disabled={apiState === "loading"}>
          {apiState === "loading" ? <Loader2 className="spin" size={18} /> : <MailSearch size={18} />}
          Gmail同期
        </button>

        <button className="shutdown-action" onClick={shutdown} disabled={shutdownState === "closing"}>
          {shutdownState === "closing" ? <Loader2 className="spin" size={18} /> : <Power size={18} />}
          終了
        </button>

        <div className={`status ${apiState}`}>
          <span>{message}</span>
          {authStatus ? <small>{authStatus.account}</small> : null}
        </div>

        <div className="queue-heading">
          <span>メール承認</span>
          <strong>{items.length}</strong>
        </div>

        <div className="queue">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.button
                layout
                key={item.id}
                className={`queue-item ${selected?.id === item.id ? "active" : ""}`}
                onClick={() => setSelectedId(item.id)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <span className="queue-title">{item.metadata.hotelName}</span>
                <span className="queue-meta">{item.metadata.emailType}</span>
                <span className="queue-date">
                  {item.metadata.checkIn ?? "TBD"} - {item.metadata.checkOut ?? "TBD"}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </section>

      <section className="workspace">
        {selected ? (
          <>
            <header className="review-header">
              <div>
                <p className="eyebrow">{selected.metadata.status}</p>
                <h2>{selected.generatedSubject}</h2>
                <p className="source">
                  {selected.from} / {new Date(selected.receivedAt).toLocaleString("ja-JP")}
                </p>
              </div>
              <div className="review-actions">
                <button className="secondary-button" onClick={dismissAndReload} disabled={apiState === "loading"}>
                  {apiState === "loading" ? <Loader2 className="spin" size={18} /> : <XCircle size={18} />}
                  候補から外し再読み込み
                </button>
                <button className="approve-button" onClick={approve} disabled={apiState === "loading"}>
                  {apiState === "loading" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                  承認して転送
                </button>
              </div>
            </header>

            <div className="review-grid">
              <section className="metadata-panel">
                <h3>予約メタデータ</h3>
                <Metadata label="ホテル" value={selected.metadata.hotelName} />
                <Metadata label="予約サイト" value={selected.metadata.bookingSite} />
                <Metadata label="予約番号" value={selected.metadata.reservationNumber} />
                <Metadata label="宿泊者人数" value={guestCountLabel(selected)} />
                <Metadata label="確認書URL" value={selected.metadata.reservationConfirmationUrl} />
                <Metadata label="宿泊日" value={`${selected.metadata.checkIn ?? "TBD"} - ${selected.metadata.checkOut ?? "TBD"}`} />
                <Metadata label="泊数" value={selected.metadata.nights?.toString()} />
                <Metadata label="料金" value={priceLabel(selected)} />
                <Metadata label="住所" value={selected.metadata.hotelAddress} />
                <Metadata label="電話" value={selected.metadata.hotelPhone} />
              </section>

              <section className="editor-panel">
                <div className="editor-toolbar">
                  <h3>転送本文</h3>
                  <button onClick={() => setEditedBody(selected.generatedBody)}>
                    <RefreshCw size={16} />
                    元に戻す
                  </button>
                </div>
                <textarea value={editedBody} onChange={(event) => setEditedBody(event.target.value)} spellCheck={false} />
              </section>
            </div>

            <section className="audit-strip">
              {selected.auditLog.map((event) => (
                <span key={`${event.at}-${event.step}`}>
                  <Check size={14} />
                  {event.step}
                </span>
              ))}
            </section>
          </>
        ) : (
          <section className="empty-state">
            <MailSearch size={42} />
            <h2>承認待ちメールはありません</h2>
            <p>Gmail同期を実行すると、過去1週間のホテル予約メールを確認します。</p>
          </section>
        )}
      </section>
    </main>
  );
}

function Metadata({ label, value }: { label: string; value?: string }) {
  return (
    <div className="metadata-row">
      <span>{label}</span>
      <strong>{value || "未取得"}</strong>
    </div>
  );
}

function priceLabel(item: PendingForward) {
  const source = item.metadata.originalAmount
    ? `${item.metadata.originalCurrency ?? ""} ${item.metadata.originalAmount}`.trim()
    : "未取得";
  const jpy = item.metadata.jpyAmount ? ` / 約 ${item.metadata.jpyAmount.toLocaleString("ja-JP")}円` : "";
  return `${source}${jpy}`;
}

function guestCountLabel(item: PendingForward) {
  const parts = [];
  if (typeof item.metadata.adultCount === "number") parts.push(`大人 ${item.metadata.adultCount}`);
  if (typeof item.metadata.childCount === "number") parts.push(`子ども ${item.metadata.childCount}`);
  return parts.join(" / ") || undefined;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
