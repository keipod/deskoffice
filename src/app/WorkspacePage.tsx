import { useMemo, useState } from "react";
import type { Agent } from "../shared/types";
import { api } from "./api";

export default function WorkspacePage({
  agent,
  onBack
}: {
  agent: Agent;
  onBack: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const description = useMemo(() => {
    const map: Record<string, string> = {
      "content-editor": "원고 검토, 편집 지시, 콘텐츠 품질 판단",
      researcher: "자료 조사, 트렌드 요약, 의사결정 브리프",
      marketer: "캠페인 기획, 배포 전략, 성과 해석",
      "browser-operator": "Bside 프로필을 사용한 실제 브라우저 업무",
      developer: "코드 분석, 설계, 테스트, 구현 계획",
      executive: "목표, 우선순위, 승인, 회의 의사결정"
    };
    return map[agent.specialty] ?? agent.specialty;
  }, [agent.specialty]);

  async function run() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setResult("");
    try {
      const path =
        agent.specialty === "browser-operator"
          ? `/api/agents/${agent.id}/browser`
          : `/api/agents/${agent.id}/run`;
      const key = agent.specialty === "browser-operator" ? "task" : "prompt";
      const response = await api<{ ok: boolean; result: unknown }>(path, {
        method: "POST",
        body: JSON.stringify({ [key]: prompt })
      });
      setResult(JSON.stringify(response.result, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace-page">
      <button className="ghost-button" onClick={onBack}>← Office</button>
      <div className="workspace-hero">
        <span className="eyebrow">SPECIALIST WORKSPACE</span>
        <h1>{agent.name} · {agent.title}</h1>
        <p>{description}</p>
        <div className="chips">
          <span className="chip">{agent.executor}</span>
          <span className="chip">{agent.specialty}</span>
          <span className={"chip status-" + agent.status}>{agent.status}</span>
        </div>
      </div>
      <section className="workspace-runner">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            agent.specialty === "browser-operator"
              ? "예: https://youtube.com 을 열고 현재 화면을 확인해줘"
              : "이 직원에게 실제 업무를 지시하세요."
          }
        />
        <button className="primary-button" disabled={busy || !prompt.trim()} onClick={() => void run()}>
          {busy ? "실행 중…" : "업무 실행"}
        </button>
        {result && <pre className="result-box">{result}</pre>}
      </section>
    </main>
  );
}
