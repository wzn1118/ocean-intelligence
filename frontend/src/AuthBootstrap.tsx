import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiRequestError, authApi } from "./api";
import { AuthBootScreen, AuthGate } from "./components/AuthExperience";
import type { AuthenticatedSession } from "./types";

const loadAuthenticatedApp = () => import("./App");
const AuthenticatedApp = lazy(loadAuthenticatedApp);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "未知数据服务错误";

export default function AuthBootstrap() {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setCheckingSession(true);
    setSessionError(null);
    try {
      const current = await authApi.session(signal);
      setSession(current.user && current.csrf_token ? current as AuthenticatedSession : null);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setSession(null);
      setSessionError(
        error instanceof ApiRequestError && error.status === 401
          ? null
          : errorMessage(error),
      );
    } finally {
      if (!signal?.aborted) setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  if (checkingSession) return <AuthBootScreen />;
  if (!session) {
    return (
      <AuthGate
        connectionError={sessionError}
        onRetryConnection={() => void checkSession()}
        onAuthenticated={(authenticatedSession) => {
          setSessionError(null);
          setSession(authenticatedSession);
        }}
      />
    );
  }

  return (
    <Suspense fallback={<AuthBootScreen />}>
      <AuthenticatedApp initialSession={session} />
    </Suspense>
  );
}
