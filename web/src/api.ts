export type User = { id: string; email: string; name: string; role: string };

export type AuthConfig = {
  google_enabled: boolean;
  redirect_enabled: boolean;
  google_client_id: string | null;
  auth_required: boolean;
  dev_bypass: boolean;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(typeof body.detail === "string" ? body.detail : res.statusText);
    throw error;
  }
  return res.json() as Promise<T>;
}

export function me() {
  return api<User>("/v1/me");
}

export function authConfig() {
  return api<AuthConfig>("/v1/auth/config");
}

export function devSignIn() {
  return api<User>("/v1/auth/dev", { method: "POST", body: JSON.stringify({}) });
}

export function googleSignIn(idToken: string) {
  return api<User>("/v1/auth/google", { method: "POST", body: JSON.stringify({ id_token: idToken }) });
}

export function logout() {
  return api<{ ok: boolean }>("/v1/auth/logout", { method: "POST", body: "{}" });
}
