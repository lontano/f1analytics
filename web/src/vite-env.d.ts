/// <reference types="vite/client" />

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_LIVE_URL?: string;
  readonly VITE_SCHEDULE_URL?: string;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (cfg: Record<string, unknown>) => void;
        renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
      };
    };
  };
  __f1aGis?: boolean;
  __f1aOnCredential?: (credential: string) => void;
}
