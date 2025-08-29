import { useEffect, useRef, useState } from "react";

interface Citation { title?: string; url?: string; page?: number; }
interface AskResponse { answer: string; sources?: Citation[]; }
interface UploadResponse { filename: string; processed: boolean; }
interface Settings { apiBase: string; }

const DEFAULT_SETTINGS: Settings = { apiBase: "http://localhost:8000" };

function useLocalStorage<T>(key: string, initialValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T : initialValue; } catch { return initialValue; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}

const Tabs: React.FC<{ tab: string; setTab: (t: string) => void; ready: boolean }> = ({ tab, setTab, ready }) => {
  const tabs = ready ? [
    { id: "chat", label: "Chat" }, { id: "upload", label: "Upload" }
  ] : [{ id: "upload", label: "Upload" }];
  return (
    <div className="p-2">
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)}
          className={`m-1 px-4 py-2 rounded ${tab===t.id? "bg-indigo-600 text-white":"bg-gray-200"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
};

const ChatPanel: React.FC<{ apiBase: string }> = ({ apiBase }) => {
  const [messages, setMessages] = useState<any[]>([
    { role: "assistant", text: "Hi! Ask a question about your uploaded PDFs." },
  ]);
  const [q, setQ] = useState(""); const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const ask = async () => {
    const question = q.trim(); if (!question || loading) return;
    setQ(""); setMessages(prev => [...prev, { role: "user", text: question }]); setLoading(true);
    try {
      const url = `${apiBase.replace(/\/$/, "")}/ask`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: 5 }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: AskResponse = await res.json();
      const citations = data.sources ?? [];
      setMessages(prev => [...prev, { role: "assistant", text: data.answer, citations }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", text: `Error: ${e.message}` }]);
    } finally { setLoading(false); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } };

  return (
    <div className="max-w-2xl mx-auto px-4 mt-6">
      <div ref={listRef} className="h-[60vh] overflow-y-auto border rounded-xl p-4 space-y-3 bg-white">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`px-4 py-2 rounded-xl max-w-[70%] text-sm shadow ${m.role === "user" ? "bg-blue-100 text-gray-900" : "bg-gray-100"}`}>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.citations && <div className="mt-2 text-xs opacity-70">Sources: {m.citations.map((c: any, idx: number) => <span key={idx} className="mr-2">{c.title || c.page}</span>)}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <textarea value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} rows={2}
          placeholder="Ask anything..." className="flex-1 border rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500" />
        <button onClick={ask} disabled={loading} className="px-4 py-2 rounded-2xl bg-indigo-600 text-white disabled:opacity-40 min-w-[96px]">
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
    </div>
  );
};

const UploadPanel: React.FC<{ apiBase: string; onReady: () => void }> = ({ apiBase, onReady }) => {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (msg: string) => setLog(prev => [msg, ...prev]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setFiles(prev => [...prev, ...picked.map(f => ({ file: f, status: "queued", id: crypto.randomUUID() }))]);
  };

  const uploadOne = async (entry: any): Promise<UploadResponse> => {
    const form = new FormData();
    form.append("file", entry.file);
    const url = `${apiBase.replace(/\/$/, "")}/upload`;
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return await res.json();
  };

  const start = async () => {
    if (!files.length) return;
    setBusy(true);
    let signaled = false;
    for (const f of files) {
      try {
        pushLog(`⬆️ Uploading ${f.file.name} ...`);
        f.status = "uploading"; setFiles([...files]);
        const up = await uploadOne(f);
        f.status = up.processed ? "ready" : "uploaded"; setFiles([...files]);
        pushLog(`✅ Processed ${up.filename}`);
        if (up.processed && !signaled) { signaled = true; onReady(); }
      } catch (err: any) {
        f.status = "error"; setFiles([...files]);
        pushLog(`❌ ${f.file.name}: ${err.message}`);
      }
    }
    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 mt-6 grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white border rounded-2xl p-4">
        <h2 className="text-lg font-semibold mb-2">Upload PDFs</h2>
        <p className="text-sm text-gray-600 mb-4">Choose PDFs to upload. The backend will extract & index automatically.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" multiple accept="application/pdf" onChange={onPick} className="block w-full text-sm md:w-auto" />
          <button disabled={!files.length || busy} onClick={start} className="px-4 py-2 rounded-xl bg-gray-900 text-white disabled:opacity-40">
            {busy? "Working..." : "Start"}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between border rounded-xl px-3 py-2">
              <div className="truncate text-sm">{f.file.name}</div>
              <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-50">{f.status}</span>
            </div>
          ))}
          {!files.length && <div className="text-sm text-gray-500 border rounded-xl p-3">No files yet. Pick some PDFs above.</div>}
        </div>
      </div>
      <div className="bg-white border rounded-2xl p-4">
        <h3 className="font-semibold mb-2">Activity</h3>
        <div className="h-64 overflow-auto text-sm space-y-2">
          {log.map((l, i) => (<div key={i} className="border rounded-lg p-2">{l}</div>))}
          {!log.length && <div className="text-gray-500">No activity yet.</div>}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [tab, setTab] = useState("upload");
  const [settings, setSettings] = useLocalStorage<Settings>("gl_settings", DEFAULT_SETTINGS);
  const [ready, setReady] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem("gl_ready") || "false"); } catch { return false; }
  });
  useEffect(() => { localStorage.setItem("gl_ready", JSON.stringify(ready)); }, [ready]);
  useEffect(() => { if (!ready && tab !== "upload") setTab("upload"); }, [ready, tab]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold m-4">GraphELens UI</h1>
      <Tabs tab={tab} setTab={setTab} ready={ready} />
      {tab==="upload" && <UploadPanel apiBase={settings.apiBase} onReady={() => setReady(true)} />}
      {ready && tab==="chat" && <ChatPanel apiBase={settings.apiBase} />}
    </div>
  );
}
