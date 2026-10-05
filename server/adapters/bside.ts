const baseUrl = (process.env.BSIDE_API_URL ?? "http://127.0.0.1:27433").replace(/\/$/, "");
const token = process.env.BSIDE_API_TOKEN?.trim();

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(baseUrl + path, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`bside_http_${response.status}: ${typeof data === "object" ? JSON.stringify(data) : text}`);
  }
  return data;
}

export async function bsideStatus() {
  try {
    const health = await request("/health");
    return { available: true, baseUrl, health };
  } catch (error) {
    return { available: false, baseUrl, error: error instanceof Error ? error.message : String(error) };
  }
}

export const bside = {
  profiles: () => request("/profiles"),
  state: () => request("/state"),
  activateProfile: (profileId: string) =>
    request(`/profiles/${encodeURIComponent(profileId)}/activate`, { method: "POST" }),
  tabs: (profileId?: string) =>
    request("/tabs" + (profileId ? `?profileId=${encodeURIComponent(profileId)}` : "")),
  createTab: (profileId: string | undefined, url: string) =>
    request("/tabs", {
      method: "POST",
      body: JSON.stringify({ profileId, url, activate: true })
    }),
  navigate: (tabId: string, url: string) =>
    request(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
      method: "POST",
      body: JSON.stringify({ url })
    }),
  snapshot: (tabId: string) => request(`/tabs/${encodeURIComponent(tabId)}/snapshot`),
  click: (tabId: string, target: string) =>
    request(`/tabs/${encodeURIComponent(tabId)}/click`, {
      method: "POST",
      body: JSON.stringify({ target, human: true })
    }),
  type: (tabId: string, target: string, text: string) =>
    request(`/tabs/${encodeURIComponent(tabId)}/type`, {
      method: "POST",
      body: JSON.stringify({ target, text, human: true, clear: true })
    }),
  key: (tabId: string, keyCode: string) =>
    request(`/tabs/${encodeURIComponent(tabId)}/cua/key`, {
      method: "POST",
      body: JSON.stringify({ keyCode })
    })
};
