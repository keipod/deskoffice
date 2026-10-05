import type {
  Agent,
  ExpertRecommendation,
  ExpertiseSkill,
  Seniority,
  Specialty
} from "../src/shared/types.js";

export const SPECIALTY_CATALOG: Record<
  Specialty,
  {
    label: string;
    department: string;
    profession: string;
    responsibilities: string[];
    expertise: ExpertiseSkill[];
  }
> = {
  executive: {
    label: "Executive",
    department: "Strategy",
    profession: "Business Operator",
    responsibilities: ["우선순위 결정", "의사결정", "조직 조정", "승인"],
    expertise: [
      { skill: "strategy", level: 5 },
      { skill: "decision-making", level: 5 },
      { skill: "operations", level: 4 }
    ]
  },
  "content-editor": {
    label: "Content Editor",
    department: "Content",
    profession: "Content Editor",
    responsibilities: ["원고 편집", "콘텐츠 품질 검수", "구성 개선", "브랜드 톤 유지"],
    expertise: [
      { skill: "editing", level: 5 },
      { skill: "storytelling", level: 4 },
      { skill: "copywriting", level: 4 }
    ]
  },
  researcher: {
    label: "Researcher",
    department: "Research",
    profession: "Research Analyst",
    responsibilities: ["자료 조사", "팩트 정리", "트렌드 분석", "브리프 작성"],
    expertise: [
      { skill: "research", level: 5 },
      { skill: "analysis", level: 4 },
      { skill: "synthesis", level: 4 }
    ]
  },
  marketer: {
    label: "Marketer",
    department: "Growth",
    profession: "Growth Marketer",
    responsibilities: ["캠페인 기획", "채널 전략", "성과 분석", "실험 설계"],
    expertise: [
      { skill: "marketing", level: 5 },
      { skill: "analytics", level: 4 },
      { skill: "distribution", level: 4 }
    ]
  },
  "browser-operator": {
    label: "Browser Operator",
    department: "Operations",
    profession: "Browser Operations Specialist",
    responsibilities: ["웹 운영", "계정별 세션 작업", "반복 브라우저 업무", "승인 요청 준수"],
    expertise: [
      { skill: "browser-automation", level: 5 },
      { skill: "operations", level: 4 },
      { skill: "web-research", level: 3 }
    ]
  },
  developer: {
    label: "Developer",
    department: "Engineering",
    profession: "Software Engineer",
    responsibilities: ["설계", "구현", "디버깅", "테스트"],
    expertise: [
      { skill: "software-engineering", level: 5 },
      { skill: "debugging", level: 5 },
      { skill: "testing", level: 4 }
    ]
  },
  analyst: {
    label: "Analyst",
    department: "Strategy",
    profession: "Business Analyst",
    responsibilities: ["지표 분석", "문제 구조화", "의사결정 자료 작성"],
    expertise: [
      { skill: "analytics", level: 5 },
      { skill: "modeling", level: 4 },
      { skill: "reporting", level: 4 }
    ]
  },
  sales: {
    label: "Sales",
    department: "Revenue",
    profession: "Sales Specialist",
    responsibilities: ["리드 분석", "제안", "후속 대응", "파이프라인 관리"],
    expertise: [
      { skill: "sales", level: 5 },
      { skill: "negotiation", level: 4 },
      { skill: "crm", level: 4 }
    ]
  },
  operations: {
    label: "Operations",
    department: "Operations",
    profession: "Operations Manager",
    responsibilities: ["업무 조율", "프로세스 관리", "일정 추적", "운영 이슈 처리"],
    expertise: [
      { skill: "operations", level: 5 },
      { skill: "project-management", level: 4 },
      { skill: "coordination", level: 4 }
    ]
  }
};

const SENIORITY_SCORE: Record<Seniority, number> = {
  lead: 24,
  senior: 16,
  mid: 8,
  junior: 2
};

export function defaultsForSpecialty(specialty: Specialty) {
  return SPECIALTY_CATALOG[specialty];
}

export function buildExpertInstructions(agent: Agent, task: string, context?: string) {
  const expertise = agent.expertise
    .slice()
    .sort((a, b) => b.level - a.level)
    .map((item) => `${item.skill}(L${item.level})`)
    .join(", ");

  return [
    `You are ${agent.name}, a DeskOffice employee.`,
    `Department: ${agent.department}`,
    `Profession: ${agent.profession}`,
    `Title: ${agent.title || agent.profession}`,
    `Specialty: ${agent.specialty}`,
    `Seniority: ${agent.seniority}`,
    expertise ? `Expertise: ${expertise}` : "",
    agent.responsibilities.length
      ? `Responsibilities: ${agent.responsibilities.join("; ")}`
      : "",
    agent.instructions ? `Personal operating instructions: ${agent.instructions}` : "",
    "",
    "Work as a domain specialist. Produce a concrete work product, not generic advice.",
    "State uncertainty explicitly. Do not pretend an external action succeeded unless the executor confirms it.",
    context ? `Context:\n${context}` : "",
    "",
    `Task:\n${task}`
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizedSkills(agent: Agent) {
  return new Map(agent.expertise.map((item) => [item.skill.trim().toLowerCase(), item.level]));
}

export function scoreAgentForTask(
  agent: Agent,
  requiredSpecialty?: Specialty | null,
  requiredExpertise: string[] = []
): ExpertRecommendation {
  let score = 0;
  const reasons: string[] = [];

  if (agent.status === "offline") return { agent, score: -1000, reasons: ["offline"] };
  if (agent.status === "blocked") score -= 80;
  if (agent.status === "working") score -= 20;
  if (agent.status === "meeting") score -= 15;
  if (agent.status === "idle") {
    score += 12;
    reasons.push("즉시 가용");
  }

  if (requiredSpecialty && agent.specialty === requiredSpecialty) {
    score += 90;
    reasons.push(`전문분야 일치: ${requiredSpecialty}`);
  } else if (requiredSpecialty) {
    score -= 10;
  }

  const skills = normalizedSkills(agent);
  for (const required of requiredExpertise) {
    const level = skills.get(required.trim().toLowerCase());
    if (level) {
      score += 12 * level;
      reasons.push(`${required} L${level}`);
    } else {
      score -= 8;
    }
  }

  score += SENIORITY_SCORE[agent.seniority];
  if (agent.seniority === "lead" || agent.seniority === "senior") {
    reasons.push(`${agent.seniority} 레벨`);
  }

  return { agent, score, reasons };
}

export function recommendExperts(
  agents: Agent[],
  requiredSpecialty?: Specialty | null,
  requiredExpertise: string[] = [],
  limit = 5
) {
  return agents
    .map((agent) => scoreAgentForTask(agent, requiredSpecialty, requiredExpertise))
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name))
    .slice(0, limit);
}

export function parseExpertiseText(input: string): ExpertiseSkill[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)(?::|@|\sL)([1-5])$/i);
      return match
        ? { skill: match[1].trim(), level: Number(match[2]) }
        : { skill: part, level: 3 };
    });
}
