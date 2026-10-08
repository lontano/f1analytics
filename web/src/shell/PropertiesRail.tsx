import { useEffect, useRef, useState } from "react";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { ViewKind } from "./nav";

type PropsTab = "session" | "feed" | "log";

type Props = {
  open: boolean;
  width: number;
  tab: PropsTab;
  kind: ViewKind | null;
  onTab: (tab: PropsTab) => void;
  onOpen: (open: boolean) => void;
  onWidth: (width: number) => void;
};

export function PropertiesRail(props: Props) {
  const [dragging, setDragging] = useState(false);
  const onWidth = useRef(props.onWidth);
  onWidth.current = props.onWidth;
  const session = useDataStore((state) => state.state?.SessionInfo);
  const status = useDataStore((state) => state.state?.SessionStatus?.Status);
  const lap = useDataStore((state) => state.state?.LapCount);
  const messages = useDataStore((state) => state.state?.RaceControlMessages?.Messages);
  const radios = useDataStore((state) => state.state?.TeamRadio?.Captures);
  const delay = useSettingsStore((state) => state.delay);
  const setDelay = useSettingsStore((state) => state.setDelay);

  useEffect(() => {
    if (!dragging) return;
    function move(event: PointerEvent) {
      const next = window.innerWidth - event.clientX;
      onWidth.current(Math.min(560, Math.max(220, next)));
    }
    function up() {
      setDragging(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  if (!props.open) {
    return (
      <aside className="props collapsed">
        <button type="button" className="ghost rail-label" onClick={() => props.onOpen(true)}>
          Properties
        </button>
      </aside>
    );
  }

  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const radioCount = Array.isArray(radios) ? radios.length : 0;

  return (
    <aside className="props" style={{ width: props.width }}>
      <div className="props-resize" onPointerDown={() => setDragging(true)} role="separator" aria-orientation="vertical" aria-label="Resize properties" />
      <div className="props-tabs">
        {(["session", "feed", "log"] as PropsTab[]).map((tab) => (
          <button key={tab} type="button" className={`nav-row${props.tab === tab ? " active" : ""}`} onClick={() => props.onTab(tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div className="props-body">
        <div className="row">
          <span>View</span>
          <span className="muted">{props.kind ?? "—"}</span>
        </div>
        {props.tab === "session" && (
          <>
            <div className="row"><span>Meeting</span><span>{session?.Meeting?.Name ?? "—"}</span></div>
            <div className="row"><span>Session</span><span>{session?.Name ?? "—"}</span></div>
            <div className="row"><span>Type</span><span>{session?.Type ?? "—"}</span></div>
            <div className="row"><span>Circuit</span><span>{session?.Meeting?.Circuit?.ShortName ?? "—"}</span></div>
            <div className="row"><span>Status</span><span className="pill">{status ?? "—"}</span></div>
            <div className="row"><span>Lap</span><span>{lap ? `${lap.CurrentLap ?? "—"}/${lap.TotalLaps ?? "—"}` : "—"}</span></div>
            <div className="row">
              <span>Delay</span>
              <input type="number" min={0} max={120} value={delay} onChange={(event) => setDelay(Number(event.target.value))} style={{ width: 72 }} />
            </div>
          </>
        )}
        {props.tab === "feed" && (
          <>
            <div className="row"><span>Source</span><span>live timing</span></div>
            <div className="row"><span>Delay</span><span>{delay}s</span></div>
          </>
        )}
        {props.tab === "log" && (
          <>
            <div className="row"><span>Race control</span><span>{messageCount}</span></div>
            <div className="row"><span>Radios</span><span>{radioCount}</span></div>
            <p className="muted">Counts only. Messages stay in the open tab.</p>
          </>
        )}
        <button type="button" className="ghost" onClick={() => props.onOpen(false)}>
          Hide
        </button>
      </div>
    </aside>
  );
}
