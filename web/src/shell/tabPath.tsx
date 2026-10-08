import { createContext, useContext, type ReactNode } from "react";

const TabPathContext = createContext("/");

export function TabPathProvider({ path, children }: { path: string; children: ReactNode }) {
  return <TabPathContext.Provider value={path}>{children}</TabPathContext.Provider>;
}

export function useTabPath() {
  return useContext(TabPathContext);
}
