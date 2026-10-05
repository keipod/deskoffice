import type { Agent, Meeting } from "../shared/types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchAgents(): Promise<Agent[]> {
  return (await api<{ agents: Agent[] }>("/api/agents")).agents;
}

export async function fetchMeetings(): Promise<Meeting[]> {
  return (await api<{ meetings: Meeting[] }>("/api/meetings")).meetings;
}
