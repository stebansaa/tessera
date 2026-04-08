import type { Project } from "../types";

export const placeholderProjects: Project[] = [
  {
    id: "infra",
    name: "INFRA",
    sessions: [
      { id: "prod", name: "prod-server", kind: "ssh", active: true, connected: true },
      { id: "stg", name: "staging-db", kind: "ssh", connected: true },
      { id: "loc", name: "local dev", kind: "local", connected: false },
    ],
  },
  {
    id: "ai",
    name: "AI TOOLS",
    sessions: [
      { id: "chat", name: "debug chat", kind: "llm", connected: true },
      { id: "graf", name: "grafana", kind: "web", connected: true },
    ],
  },
];
