import { useEffect, useState } from "react";
import { authConfig, devSignIn, googleSignIn, type AuthConfig, type User } from "./api";
import { googlePopupAuthIsBroken } from "./googlePopup";

const COPY: Record<string, string> = {
  not_invited: "This Google account is not on the allowlist.",
  rejected: "Sign-in was rejected.",
  failed: "Sign-in failed. Try again.",
  access_denied: "Google sign-in was cancelled.",
  expired: "The Google credential expired. Try again.",
  "clock-early": "Sign-in failed because this computer’s clock is out of sync.",
  audience: "This app’s Google client does not match the credential.",
  issuer: "Sign-in was rejected.",
  certs: "Sign-in failed.",
  other: "Sign-in failed.",
  unauthorized: "Sign-in failed.",
};

type Props = { onSignedIn: (user: User) => void };

export function SignIn({ onSignedIn }: Props) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const popupBroken = googlePopupAuthIsBroken();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("signin_error");
    if (reason) {
      setError(COPY[reason] ?? COPY.failed);
      params.delete("signin_error");
      const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
    authConfig().then(setCfg).catch(() => setError(COPY.failed));
  }, []);

  useEffect(() => {
    window.__f1aOnCredential = async (credential: string) => {
      try {
        setBusy(true);
        setError(null);
        onSignedIn(await googleSignIn(credential));
      } catch (err) {
        const kind = err instanceof Error ? err.message : "failed";
        setError(COPY[kind] ?? COPY.failed);
      } finally {
        setBusy(false);
      }
    };
  }, [onSignedIn]);

  useEffect(() => {
    if (popupBroken || !cfg?.google_enabled || !cfg.google_client_id) return;
    let alive = true;
    const render = () => {
      if (!alive || !window.google) return;
      if (!window.__f1aGis) {
        window.google.accounts.id.initialize({
          client_id: cfg.google_client_id,
          callback: (resp: { credential?: string }) => {
            if (resp.credential) void window.__f1aOnCredential?.(resp.credential);
          },
        });
        window.__f1aGis = true;
      }
      const el = document.getElementById("gis-btn");
      if (el) {
        el.replaceChildren();
        window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", width: 320 });
      }
    };
    if (window.google) {
      render();
      return () => {
        alive = false;
      };
    }
    let script = document.querySelector<HTMLScriptElement>("script[data-gis]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.gis = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => {
      alive = false;
      script?.removeEventListener("load", render);
    };
  }, [cfg, popupBroken]);

  async function onDev() {
    try {
      setBusy(true);
      setError(null);
      onSignedIn(await devSignIn());
    } catch (err) {
      setError(err instanceof Error ? COPY[err.message] ?? COPY.failed : COPY.failed);
    } finally {
      setBusy(false);
    }
  }

  const redirectHref = `/v1/auth/google/start?next=${encodeURIComponent(window.location.origin)}`;
  const showRedirect = popupBroken && cfg?.redirect_enabled;
  const showGis = !popupBroken && cfg?.google_enabled;

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="aside-title">F1 Analytics</div>
        <h1>Sign in</h1>
        <p className="muted">Google sign-in keeps the session in an httpOnly cookie. Nothing is stored in the browser as a token.</p>
        <div className="stack">
          {showGis && <div id="gis-btn" />}
          {showRedirect && (
            <a className="btn-outline" href={redirectHref}>
              Continue with Google
            </a>
          )}
          {popupBroken && cfg?.google_enabled && !cfg.redirect_enabled && (
            <p className="error">Set GOOGLE_CLIENT_SECRET so this browser can use the redirect sign-in.</p>
          )}
          {cfg?.dev_bypass && (
            <button type="button" className="ghost" onClick={() => void onDev()} disabled={busy}>
              Continue as Dev
            </button>
          )}
          {cfg && !cfg.google_enabled && !cfg.dev_bypass && <p className="error">Set GOOGLE_CLIENT_ID or AUTH_REQUIRED=0.</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
