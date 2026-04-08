import { useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { TerminalView } from "./components/TerminalView";
import { placeholderProjects } from "./data/placeholder";

interface Tab {
  id: string;
  name: string;
}

function App() {
  const [activeSession, setActiveSession] = useState<string | null>("prod");
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "t1", name: "logs" },
    { id: "t2", name: "deploy" },
  ]);
  const [activeTab, setActiveTab] = useState<string | null>("t1");

  const totalSessions = useMemo(
    () => placeholderProjects.reduce((n, p) => n + p.sessions.length, 0),
    [],
  );

  const handleNewTab = () => {
    const id = `t${tabs.length + 1}-${Date.now()}`;
    setTabs([...tabs, { id, name: `tab ${tabs.length + 1}` }]);
    setActiveTab(id);
  };

  const handleCloseTab = (id: string) => {
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTab === id) setActiveTab(next.at(-1)?.id ?? null);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projects={placeholderProjects}
          activeId={activeSession}
          onSelect={setActiveSession}
          onNew={() => console.log("new session")}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabs}
            activeId={activeTab}
            onSelect={setActiveTab}
            onClose={handleCloseTab}
            onNew={handleNewTab}
          />
          <div className="flex-1 overflow-hidden p-2">
            <div className="h-full w-full rounded border border-divider bg-bg p-2">
              <TerminalView />
            </div>
          </div>
        </main>
      </div>
      <StatusBar sessions={totalSessions} />
    </div>
  );
}

export default App;
