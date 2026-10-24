const token = new URLSearchParams(location.search).get("token") ?? "";

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; project?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "x-token": token, ...(opts.project ? { "x-project": opts.project } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

// One WebSocket shared by chat and terminals; sends made before it opens are queued.
let socket: WebSocket | undefined;
const listeners = new Set<(m: any) => void>();
const queue: string[] = [];

function shared() {
  if (!socket) {
    socket = new WebSocket(`ws://${location.host}/ws?token=${token}`);
    socket.onopen = () => queue.splice(0).forEach((m) => socket!.send(m));
    socket.onmessage = (e) => { const m = JSON.parse(e.data); listeners.forEach((l) => l(m)); };
    socket.onclose = () => {
      socket = undefined;
      // The server stops every run of a closed connection and can't tell us, so tell the listeners ourselves.
      listeners.forEach((l) => l({ type: "socket-closed" }));
      setTimeout(shared, 1000); // and reconnect
    };
  }
  return socket;
}

export function send(m: unknown) {
  const s = shared();
  const text = JSON.stringify(m);
  if (s.readyState === 1) s.send(text); else queue.push(text);
}

export function connect(onMessage: (m: any) => void) {
  shared();
  listeners.add(onMessage);
  return { send, close: () => listeners.delete(onMessage) };
}

export const localImageUrl = (path: string, project: string) => `/api/localimg?path=${encodeURIComponent(path)}&project=${encodeURIComponent(project)}&token=${token}`;
export const imageUrl = (id: string) => `/api/images/${id}?token=${token}`;

// Stores an image on the server (raw bytes, content-type = mime) and returns its id.
export async function uploadImage(blob: Blob): Promise<string> {
  const res = await fetch("/api/images", { method: "POST", headers: { "x-token": token, "content-type": blob.type }, body: blob });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data.id;
}
