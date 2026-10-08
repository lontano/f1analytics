import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logout, type User } from "../api";
import { DashPage } from "../views/DashPages";
import { SECTIONS, SETTINGS_ICON, findItem, findSection, kindForPath, type ViewKind } from "./nav";
import { setPathOpener } from "./openPath";
import { PropertiesRail } from "./PropertiesRail";
import { SettingsPanel } from "./SettingsPanel";
import { readJson, writeJson } from "./storage";
import { TimingPane, TimingSession } from "./TimingSession";
import { TransportBar } from "./TransportBar";

type Tab = { id: string; kind: ViewKind; title: string; unread: number };
type PropsTab = "session" | "feed" | "log";

type Props = { user: User; onSignedOut: () => void };

export function Workbench({ user, onSignedOut }: Props) {
  const [sectionId, setSectionId] = useState(readJson("f1a.section", "timing"));
  const [settings, setSettings] = useState(false);
  const [collapsed, setCollapsed] = useState(readJson("f1a.aside", false));
  const [tabs, setTabs] = useState<Tab[]>(() => readJson<Tab[]>("f1a.tabs", []));
  const [activeId, setActiveId] = useState<string | null>(() => readJson<string | null>("f1a.active", null));
  const [wizard, setWizard] = useState(false);
  const [propsOpen, setPropsOpen] = useState(readJson("f1a.props.open", false));
  const [propsWidth, setPropsWidth] = useState(readJson("f1a.props.width", 240));
  const [propsTab, setPropsTab] = useState<PropsTab>("session");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [seen, setSeen] = useState<ViewKind[]>(() => readJson<ViewKind[]>("f1a.seen", []));

  const section = SECTIONS.find((item) => item.id === sectionId) ?? SECTIONS[0];
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  const openRef = useRef(openKind);
  openRef.current = openKind;
  useEffect(() => {
    setPathOpener((href) => {
      const kind = kindForPath(href);
      if (kind) openRef.current(kind);
    });
    return () => setPathOpener(null);
  }, []);

  useEffect(() => {
    writeJson("f1a.tabs", tabs);
    writeJson("f1a.active", activeId);
    writeJson("f1a.seen", seen);
  }, [tabs, activeId, seen]);

  const unreadFor = useCallback(
    (kind: ViewKind) => {
      const open = tabs.find((tab) => tab.kind === kind);
      if (open) return open.unread;
      if (seen.includes(kind)) return 0;
      return kind === "weather" ? 1 : 0;
    },
    [seen, tabs],
  );

  function openKind(kind: ViewKind) {
    const item = findItem(kind);
    if (!item) return;
    const owner = findSection(kind);
    if (owner) setSectionId(owner.id);
    setSettings(false);
    setWizard(false);
    setSeen((current) => (current.includes(kind) ? current : [...current, kind]));
    setTabs((current) => {
      if (current.some((tab) => tab.kind === kind)) {
        return current.map((tab) => (tab.kind === kind ? { ...tab, unread: 0 } : tab));
      }
      return [...current, { id: kind, kind, title: item.label, unread: 0 }];
    });
    setActiveId(kind);
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      setActiveId((currentId) => {
        if (currentId !== id) return currentId;
        return next[index]?.id ?? next[index - 1]?.id ?? null;
      });
      return next;
    });
  }

  function moveTab(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setTabs((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const sectionUnread = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of SECTIONS) {
      counts.set(
        group.id,
        group.items.reduce((sum, item) => sum + unreadFor(item.kind), 0),
      );
    }
    return counts;
  }, [unreadFor]);

  async function signOut() {
    await logout();
    onSignedOut();
  }

  return (
    <div className="app-shell">
      <aside className={`aside${collapsed ? " collapsed" : ""}`}>
        <div className="aside-header">
          <button type="button" className="ghost" aria-label="Collapse navigation" onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeJson("f1a.aside", next);
          }}>
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
          <span className="aside-title label">F1 Analytics</span>
        </div>
        <nav className="nav">
          {SECTIONS.map((item) => {
            const count = sectionUnread.get(item.id) ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                className={`nav-row${!settings && section.id === item.id ? " active" : ""}`}
                onClick={() => {
                  setSectionId(item.id);
                  setSettings(false);
                  writeJson("f1a.section", item.id);
                }}
              >
                <Icon d={item.icon} />
                <span className="label">{item.label}</span>
                {count > 0 && <span className="badge label">{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="aside-foot">
          <button type="button" title="Settings" className={`nav-row${settings ? " active" : ""}`} onClick={() => setSettings(true)}>
            <Icon d={SETTINGS_ICON} />
            <span className="label">Settings</span>
          </button>
          <div className="aside-user muted">{user.email}</div>
        </div>
      </aside>

      {!settings && (
        <div className="subnav">
          <h2>{section.label}</h2>
          <div className="group">Views</div>
          {section.items.map((item) => {
            const unread = unreadFor(item.kind);
            const selected = active?.kind === item.kind;
            return (
              <button key={item.kind} type="button" className={`nav-row${selected ? " active" : ""}`} onClick={() => openKind(item.kind)}>
                <Icon d="M6 4h12v16H6z" />
                <span>{item.label}</span>
                {unread > 0 && <span className="badge">{unread}</span>}
              </button>
            );
          })}
        </div>
      )}

      <main className="workspace">
        <TransportBar />
        {settings && (
          <SettingsPanel user={user} saveError={null} onSignOut={() => void signOut()} />
        )}
        <div className={settings ? "workspace-body hidden" : "workspace-body"}>
            <div className="tabbar">
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  draggable
                  className={`tab${tab.id === activeId ? " active" : ""}`}
                  onClick={() => openKind(tab.kind)}
                  onDragStart={() => setDragFrom(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragFrom != null) moveTab(dragFrom, index);
                    setDragFrom(null);
                  }}
                >
                  <span>{tab.title}</span>
                  {tab.unread > 0 && <span className="badge">{tab.unread}</span>}
                  <span
                    className="x"
                    role="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    ✕
                  </span>
                </button>
              ))}
              <button type="button" className="tab add" aria-label="Open a view" onClick={() => setWizard(true)}>
                ＋
              </button>
            </div>
            <div className="content">
              <TimingSession>
                {tabs.length === 0 && (
                  <div className="empty">No tabs open — use the + button to open a timing, analysis, or data view.</div>
                )}
                {tabs.map((tab) => (
                  <div key={tab.id} className={tab.id === activeId ? "tab-view" : "tab-view hidden"}>
                    <TimingPane path={findItem(tab.kind)?.path ?? "/dashboard"}>
                      <DashPage kind={tab.kind} />
                    </TimingPane>
                  </div>
                ))}
              </TimingSession>
            </div>
        </div>
      </main>

      {!settings && (
        <PropertiesRail
          open={propsOpen}
          width={propsWidth}
          tab={propsTab}
          kind={active?.kind ?? null}
          onTab={setPropsTab}
          onOpen={(open) => {
            setPropsOpen(open);
            writeJson("f1a.props.open", open);
          }}
          onWidth={(width) => {
            setPropsWidth(width);
            writeJson("f1a.props.width", width);
          }}
        />
      )}

      {wizard && (
        <div className="modal-back" onClick={() => setWizard(false)}>
          <div className="modal" role="dialog" aria-label="Open a view" onClick={(event) => event.stopPropagation()}>
            <h2>Open a view</h2>
            {SECTIONS.map((group) => (
              <div key={group.id}>
                <div className="group">{group.label}</div>
                {group.items.map((item) => (
                  <button key={item.kind} type="button" className="nav-row" onClick={() => openKind(item.kind)}>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
