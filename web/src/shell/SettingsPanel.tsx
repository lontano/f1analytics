import { useMemo, useState, type ReactNode } from "react";
import type { User } from "../api";
import { applyTheme, currentTheme } from "./storage";

type Category = "General" | "Appearance";

const CATEGORIES: Category[] = ["General", "Appearance"];

type Row = {
  category: Category;
  label: string;
  description?: string;
  control: ReactNode;
};

type Props = {
  user: User;
  saveError: string | null;
  onSignOut: () => void;
};

export function SettingsPanel({ user, saveError, onSignOut }: Props) {
  const [category, setCategory] = useState<Category>("Appearance");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(currentTheme);
  const [themeError, setThemeError] = useState<string | null>(null);

  const rows = useMemo<Row[]>(
    () => [
      {
        category: "General",
        label: "Signed in",
        description: user.email,
        control: <span className="pill">{user.role}</span>,
      },
      {
        category: "General",
        label: "Sign out",
        description: "Clears the opaque session cookie.",
        control: (
          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        ),
      },
      {
        category: "Appearance",
        label: "Theme",
        description: "Stored in this browser. Light is the default.",
        control: (
          <div className="theme-picker">
            {(["light", "dark"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`theme-option${theme === option ? " active" : ""}`}
                onClick={() => {
                  const ok = applyTheme(option);
                  setTheme(option);
                  setThemeError(ok ? null : "Could not save: settings storage is unavailable.");
                }}
              >
                <span className={`theme-swatch ${option}`} />
                {option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        ),
      },
    ],
    [onSignOut, theme, user.email, user.role],
  );

  const q = query.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (!q) return row.category === category;
    return `${row.category} ${row.label} ${row.description ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div className="settings">
      <div className="settings-nav">
        <h2 style={{ margin: "0 0.5rem 1rem", fontSize: "1.1rem" }}>Settings</h2>
        {CATEGORIES.map((item) => (
          <button key={item} type="button" className={`nav-row${item === category && !q ? " active" : ""}`} onClick={() => { setCategory(item); setQuery(""); }}>
            <span>{item}</span>
          </button>
        ))}
      </div>
      <div className="settings-main">
        <select className="settings-jump" value={category} onChange={(event) => { setCategory(event.target.value as Category); setQuery(""); }}>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <div className="search">
          <span aria-hidden="true">⌕</span>
          <input value={query} placeholder="Search settings" onChange={(event) => setQuery(event.target.value)} />
        </div>
        {visible.length === 0 && <div className="empty">No settings match “{query.trim()}”.</div>}
        {visible.map((row) => (
          <div key={`${row.category}-${row.label}`}>
            {q && <h3>{row.category}</h3>}
            <div className="setting">
              <div>
                {row.label}
                {row.description && <small>{row.description}</small>}
              </div>
              {row.control}
            </div>
          </div>
        ))}
        {(themeError || saveError) && <div className="error">{themeError || saveError}</div>}
      </div>
    </div>
  );
}
