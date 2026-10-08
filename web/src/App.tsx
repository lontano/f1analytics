import { useEffect, useState } from "react";
import { me, type User } from "./api";
import { SignIn } from "./SignIn";
import { Workbench } from "./shell/Workbench";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return (
      <div className="signin">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!user) return <SignIn onSignedIn={setUser} />;
  return <Workbench user={user} onSignedOut={() => setUser(null)} />;
}
