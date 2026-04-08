export type SessionKind = "ssh" | "local" | "llm" | "web";

export interface Session {
  id: string;
  name: string;
  kind: SessionKind;
  active?: boolean;
  connected?: boolean;
}

export interface Project {
  id: string;
  name: string;
  sessions: Session[];
}
