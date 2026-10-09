import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, HermesProfile } from "../shared/types";
import { api } from "./api";

type ScreenState = "running" | "stopped" | "missing_packages" | "unavailable" | "unknown";
type Screen = {
  profileId: string;
  profileName: string;
  displayName: string;
  boundAgentId: string | null;
  connected: boolean;
  state: ScreenState;
  detail: string;
  ok: boolean;
};

const labels: Record<ScreenState, string> = {
  running: "화면 가동 중",
  stopped: "화면 정지",
  missing_packages: "데스크톱 패키지 부족",
  unavailable: "화면 상태 확인 불가",
  unknown: "상태 미확인"
};

export default function BotScreensPage({ agents, profiles, selectedAgentId }: {
  agents: Agent[];
  profiles: HermesProfile[];
  selectedAgentId: string | null;
}) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ screens: Screen[] }>("/api/hermes/screens");
      setScreens(data.screens);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const target = profiles.find((profile) => profile.boundAgentId === selectedAgentId);
    if (target) setActiveId(target.id);
  }, [selectedAgentId, profiles]);

  const active = useMemo(() =>
    screens.find((screen) => screen.profileId === activeId) ?? screens[0] ?? null,
    [screens, activeId]
  );
  const employeeFor = (screen: Screen) =>
    agents.find((agent) => agent.id === screen.boundAgentId) ??
    agents.find((agent) => agent.name.toLowerCase() === screen.profileName.toLowerCase()) ?? null;

  async function control(screen: Screen, operation: "start" | "stop") {
    const label = operation === "start" ? "시작" : "중지";
    if (!window.confirm(`${screen.displayName} 직원의 실제 Hermes Bot Screen을 ${label}할까요?`)) return;
    setPending(screen.profileId);
    setMessage("");
    try {
      const response = await api<{ ok: boolean; state: ScreenState; detail: string }>(
        `/api/hermes/screens/${screen.profileId}/control`,
        { method: "POST", body: JSON.stringify({ operation }) }
      );
      setMessage(response.ok ? `${screen.displayName}: ${labels[response.state]}` : response.detail);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setPending(null); await refresh(); }
  }

  const running = screens.filter((screen) => screen.state === "running").length;
  const connected = screens.filter((screen) => screen.connected).length;
  return (
    <section className="screens-page">
      <div className="screen-head">
        <div>
          <span className="eyebrow">HERMES BOT SCREEN · NATIVE DESKTOPS</span>
          <h1>직원 PC 관제실</h1>
          <p>게임형 사무실의 각 직원과 실제 Hermes 가상 데스크톱을 연결합니다. 상태는 Hermes CLI에서 직접 확인합니다.</p>
        </div>
        <div className="screen-kpis">
          <div><strong>{profiles.length}</strong><span>등록 직원</span></div>
          <div><strong>{connected}</strong><span>Gateway 연결</span></div>
          <div><strong>{running}</strong><span>가동 화면</span></div>
          <button className="secondary-button" onClick={() => void refresh()}>새로고침</button>
        </div>
      </div>
      {error && <p role="alert" className="screen-alert">상태 조회 실패: {error}</p>}
      {message && <p role="status" className="screen-alert">{message}</p>}
      <div className="screen-layout">
        <div className="screen-wall">
          {screens.map((screen) => {
            const agent = employeeFor(screen);
            return <button key={screen.profileId} className={`screen-tile ${active?.profileId === screen.profileId ? "selected" : ""}`}
              onClick={() => setActiveId(screen.profileId)}>
              <div className="screen-tile-top"><b>{agent?.name ?? screen.displayName}</b><span className={`screen-lamp ${screen.state}`} /></div>
              <div className="screen-glass">
                <span className="screen-terminal-prompt">☤ {screen.profileName}@hermes</span>
                <span className="screen-terminal-state">{labels[screen.state]}</span>
                <small>{screen.connected ? "GATEWAY CONNECTED" : "GATEWAY NOT VERIFIED"}</small>
              </div>
              <div className="screen-tile-bottom"><span>{agent?.title || agent?.profession || "Hermes Profile"}</span><span>{screen.state === "running" ? "LIVE" : "OFFLINE"}</span></div>
            </button>;
          })}
          {screens.length === 0 && <div className="screen-alert">등록된 Hermes 프로필이 없습니다. 직원 관리 화면에서 Hermes 프로필을 연결하세요.</div>}
        </div>
        <aside className="screen-inspector">
          {active ? <>
            <span className="eyebrow">SELECTED EMPLOYEE</span>
            <h2>{employeeFor(active)?.name ?? active.displayName}</h2>
            <p>{active.profileName} · {labels[active.state]}</p>
            <div className="screen-diagnostic"><span>GATEWAY</span><strong>{active.connected ? "VALIDATED" : "NOT VERIFIED"}</strong></div>
            <div className="screen-diagnostic"><span>BOT SCREEN</span><strong>{labels[active.state]}</strong></div>
            <div className="screen-diagnostic"><span>실행 엔진</span><strong>Hermes Agent (native)</strong></div>
            <div className="screen-action-group">
              <button className="primary-button" disabled={pending !== null || active.state === "missing_packages" || active.state === "running"}
                onClick={() => void control(active,"start")}>{pending === active.profileId ? "실행 중…" : "Bot Screen 시작"}</button>
              <button className="secondary-button" disabled={pending !== null || active.state !== "running"}
                onClick={() => void control(active,"stop")}>화면 중지</button>
            </div>
            <span className="eyebrow">HERMES DIAGNOSTICS</span>
            <pre className="screen-log">{active.detail || "진단 내용이 없습니다."}</pre>
            <p className="screen-help">화면 관찰·인간의 직접 조작·제어권 반환은 Hermes Desktop의 Bot Screen에서 수행합니다. 이 웹 화면은 현재 실제 화면 상태와 시작·중지만 제공하며, 라이브 화면 스트리밍은 아직 연결되지 않았습니다.</p>
            <div className="screen-help"><b>Bot Screen 설치 조건</b><p>Linux: TigerVNC + Xfce 필요. 현재 계정에 sudo 권한이 없다면 시스템 관리자가 설치해야 합니다.</p></div>
          </> : <p>직원을 선택하세요.</p>}
        </aside>
      </div>
    </section>
  );
}
