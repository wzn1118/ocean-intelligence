import {
  ArrowRight,
  Check,
  CircleUserRound,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { authApi } from "../api";
import type {
  ApiProviderName,
  AuthenticatedSession,
  ProviderApiMode,
  ProviderConnectionTestResult,
  ProviderModelDiscoveryRequest,
  ProviderPreset,
  UserApiConfig,
  UserApiConfigUpdate,
  UserPublic,
} from "../types";

type AuthMode = "login" | "register";

const FALLBACK_PRESETS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1/responses", api_mode: "responses" },
  { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/chat/completions", api_mode: "chat_completions" },
  { id: "custom", label: "自定义中转站", base_url: null, api_mode: "responses" },
];

const messageFrom = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const credentialScope = (value: string) => value
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/(?:responses|chat\/completions)$/i, "")
  .toLowerCase();

const initials = (name: string) => {
  const normalized = name.trim();
  if (!normalized) return "OI";
  const parts = normalized.split(/\s+/);
  return parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : normalized.slice(0, 2).toUpperCase();
};

interface AuthGateProps {
  connectionError?: string | null;
  onAuthenticated: (session: AuthenticatedSession) => void;
  onRetryConnection?: () => void;
}

export function AuthGate({ connectionError, onAuthenticated, onRetryConnection }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setPasswordAgain("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "register" && password !== passwordAgain) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const session = mode === "login"
        ? await authApi.login({ email: email.trim(), password })
        : await authApi.register({
            email: email.trim(),
            password,
            display_name: displayName.trim(),
          });
      setPassword("");
      setPasswordAgain("");
      onAuthenticated(session);
    } catch (submitError) {
      setError(messageFrom(submitError, mode === "login" ? "登录失败，请重试" : "注册失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-gate">
      <div className="auth-gate-scrim" />
      <section className="auth-gate-context" aria-label="海洋智能分析工作台">
        <div className="auth-brand-lockup">
          <span className="auth-brand-mark"><img src="/favicon.svg" alt="" /></span>
          <div><strong>海洋智能分析</strong><span>OCEAN INTELLIGENCE</span></div>
        </div>
        <div className="auth-context-copy">
          <span className="auth-kicker"><i /> SECURE RESEARCH ACCESS</span>
          <h1>进入海洋观测工作台</h1>
          <p>区域观测、事件证据与数据 Agent 共用同一受保护会话。</p>
        </div>
        <div className="auth-context-status" aria-label="安全状态">
          <span><ShieldCheck size={15} /> HttpOnly 会话</span>
          <span><Waves size={15} /> 数据源隔离</span>
          <span><KeyRound size={15} /> 密钥加密保存</span>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-heading">
        <header>
          <div>
            <span>ACCOUNT ACCESS / 账户入口</span>
            <h2 id="auth-heading">{mode === "login" ? "欢迎回来" : "创建研究账户"}</h2>
          </div>
          <CircleUserRound size={27} aria-hidden="true" />
        </header>

        <div className="auth-mode-switch" role="tablist" aria-label="账户操作">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>登录</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>注册</button>
        </div>

        {connectionError && (
          <div className="auth-connection-error" role="status">
            <span>{connectionError}</span>
            {onRetryConnection && (
              <button type="button" onClick={onRetryConnection} title="重新连接" aria-label="重新连接"><RefreshCw size={15} /></button>
            )}
          </div>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label>
              <span>显示名称</span>
              <div><UserRound size={17} /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" autoCapitalize="words" autoCorrect="off" spellCheck={false} maxLength={80} placeholder="你的姓名或团队称呼" required /></div>
            </label>
          )}
          <label>
            <span>邮箱</span>
            <div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" placeholder="name@example.com" required /></div>
          </label>
          <label>
            <span>密码</span>
            <div>
              <LockKeyhole size={17} />
              <input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={mode === "register" ? 8 : 1} placeholder={mode === "register" ? "至少 8 个字符" : "输入账户密码"} required />
              <button type="button" className="auth-field-action" onClick={() => setPasswordVisible((visible) => !visible)} title={passwordVisible ? "隐藏密码" : "显示密码"} aria-label={passwordVisible ? "隐藏密码" : "显示密码"}>
                {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {mode === "register" && (
            <label>
              <span>确认密码</span>
              <div><LockKeyhole size={17} /><input type={passwordVisible ? "text" : "password"} value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} autoComplete="new-password" minLength={8} placeholder="再次输入密码" required /></div>
            </label>
          )}

          {error && <div className="auth-form-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spinning" size={18} /> : <ArrowRight size={18} />}
            <span>{submitting ? "正在验证" : mode === "login" ? "进入工作台" : "创建并进入"}</span>
          </button>
        </form>

        <footer><ShieldCheck size={14} /><span>会话与 API 密钥不会写入浏览器本地存储</span></footer>
      </section>
    </main>
  );
}

export function AuthBootScreen() {
  return (
    <main className="auth-gate auth-boot-screen" aria-label="正在验证会话">
      <div className="auth-gate-scrim" />
      <div className="auth-boot-status">
        <span className="auth-brand-mark"><img src="/favicon.svg" alt="" /></span>
        <LoaderCircle className="spinning" size={20} />
        <strong>正在验证安全会话</strong>
      </div>
    </main>
  );
}

interface AccountSettingsProps {
  open: boolean;
  user: UserPublic;
  onClose: () => void;
  onSignedOut: () => void;
}

export function AccountSettings({ open, user, onClose, onSignedOut }: AccountSettingsProps) {
  const [presets, setPresets] = useState<ProviderPreset[]>(FALLBACK_PRESETS);
  const [config, setConfig] = useState<UserApiConfig | null>(null);
  const [provider, setProvider] = useState<ApiProviderName>("openai");
  const [apiMode, setApiMode] = useState<ProviderApiMode>("responses");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelDiscoveryMessage, setModelDiscoveryMessage] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === provider),
    [presets, provider],
  );
  const savedKeyApplies = Boolean(
    config?.has_api_key
    && credentialScope(config.base_url) === credentialScope(baseUrl),
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    setAvailableModels([]);
    setModelDiscoveryMessage(null);
    setConfirmDelete(false);
    setApiKey("");
    Promise.all([authApi.providerPresets(controller.signal), authApi.apiConfig(controller.signal)])
      .then(([nextPresets, nextConfig]) => {
        const availablePresets = nextPresets.length ? nextPresets : FALLBACK_PRESETS;
        setPresets(availablePresets);
        setConfig(nextConfig);
        if (nextConfig) {
          setProvider(nextConfig.provider);
          setApiMode(nextConfig.api_mode);
          setBaseUrl(nextConfig.base_url);
          setModel(nextConfig.model);
        } else {
          setProvider("openai");
          const openAiPreset = availablePresets.find((preset) => preset.id === "openai");
          setApiMode(openAiPreset?.api_mode ?? "responses");
          setBaseUrl(openAiPreset?.base_url ?? "");
          setModel("");
        }
      })
      .catch((loadError) => {
        if ((loadError as Error).name !== "AbortError") setError(messageFrom(loadError, "无法读取账户设置"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const clearModelDiscovery = () => {
    setAvailableModels([]);
    setModelDiscoveryMessage(null);
  };

  const selectProvider = (nextProvider: ApiProviderName) => {
    const nextPreset = presets.find((preset) => preset.id === nextProvider);
    setProvider(nextProvider);
    if (nextProvider !== provider) {
      setBaseUrl(nextPreset?.base_url ?? "");
      setApiMode(nextPreset?.api_mode ?? "responses");
    }
    setSaved(false);
    setTestResult(null);
    clearModelDiscovery();
    setError(null);
  };

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    if (/\/responses\/?$/i.test(value)) setApiMode("responses");
    if (/\/chat\/completions\/?$/i.test(value)) setApiMode("chat_completions");
    setSaved(false);
    setTestResult(null);
    clearModelDiscovery();
  };

  const updateApiMode = (nextMode: ProviderApiMode) => {
    setApiMode(nextMode);
    setBaseUrl((currentUrl) => {
      if (!/\/(?:responses|chat\/completions)\/?$/i.test(currentUrl)) return currentUrl;
      const root = currentUrl.replace(/\/(?:responses|chat\/completions)\/?$/i, "");
      return `${root}${nextMode === "responses" ? "/responses" : "/chat/completions"}`;
    });
    setSaved(false);
    setTestResult(null);
    clearModelDiscovery();
  };

  const formPayload = (): UserApiConfigUpdate => ({
    provider,
    model: model.trim(),
    base_url: baseUrl.trim() || null,
    api_mode: apiMode,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  });

  const discoveryPayload = (): ProviderModelDiscoveryRequest => ({
    provider,
    base_url: baseUrl.trim() || null,
    api_mode: apiMode,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  });

  const discoverModels = async () => {
    if (provider === "custom" && !baseUrl.trim()) {
      setError("请填写中转站 Base URL");
      return;
    }
    if (!apiKey.trim() && !savedKeyApplies) {
      setError("请填写 API 密钥后再检测模型");
      return;
    }
    setDiscovering(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    setModelDiscoveryMessage(null);
    try {
      const result = await authApi.discoverModels(discoveryPayload());
      setAvailableModels(result.models);
      if (!result.models.includes(model.trim())) setModel(result.models[0] ?? "");
      setModelDiscoveryMessage(result.message);
    } catch (discoveryError) {
      setAvailableModels([]);
      setError(messageFrom(discoveryError, "模型检测失败，请检查 Base URL 和 API 密钥"));
    } finally {
      setDiscovering(false);
    }
  };

  const testConnection = async () => {
    if (provider === "custom" && !baseUrl.trim()) {
      setError("请填写中转站地址");
      return;
    }
    if (!model.trim()) {
      setError("请填写模型 ID");
      return;
    }
    if (!apiKey.trim() && !savedKeyApplies) {
      setError("请填写 API 密钥后再测试连接");
      return;
    }
    setTesting(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    try {
      const result = await authApi.testApiConfig(formPayload());
      setTestResult(result);
    } catch (testError) {
      setError(messageFrom(testError, "连接测试失败，请检查地址、密钥和模型 ID"));
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (provider === "custom" && !baseUrl.trim()) {
      setError("自定义服务需要填写完整接口地址");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const nextConfig = await authApi.updateApiConfig({
        ...formPayload(),
      });
      setConfig(nextConfig);
      setApiMode(nextConfig.api_mode);
      setBaseUrl(nextConfig.base_url);
      setApiKey("");
      setKeyVisible(false);
      setSaved(true);
      setTestResult(null);
    } catch (saveError) {
      setError(messageFrom(saveError, "保存失败，请检查服务地址和模型名称"));
    } finally {
      setSaving(false);
    }
  };

  const removeConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      await authApi.deleteApiConfig();
      setConfig(null);
      setModel("");
      setApiKey("");
      setConfirmDelete(false);
      setSaved(false);
      setTestResult(null);
      clearModelDiscovery();
      const openAiPreset = presets.find((preset) => preset.id === "openai");
      setProvider("openai");
      setApiMode(openAiPreset?.api_mode ?? "responses");
      setBaseUrl(openAiPreset?.base_url ?? "");
    } catch (deleteError) {
      setError(messageFrom(deleteError, "无法移除 API 配置"));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await authApi.logout();
      onSignedOut();
    } catch (logoutError) {
      setError(messageFrom(logoutError, "退出失败，请重试"));
      setSigningOut(false);
    }
  };

  return (
    <div className="account-settings-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="account-settings" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
        <header className="account-settings-header">
          <div className="account-identity-mark">{initials(user.display_name)}</div>
          <div>
            <span>ACCOUNT / 账户</span>
            <h2 id="account-settings-title">{user.display_name}</h2>
            <p>{user.email}</p>
          </div>
          <button type="button" className="account-close" onClick={onClose} title="关闭账户设置" aria-label="关闭账户设置"><X size={19} /></button>
        </header>

        <div className="account-settings-body">
          <section className="account-settings-section" aria-labelledby="api-connection-heading">
            <header>
              <span><Server size={17} /></span>
              <div><h3 id="api-connection-heading">模型与中转站</h3><p>为数据 Agent 选择推理服务</p></div>
              {config?.has_api_key && <em><Check size={12} /> 密钥已配置</em>}
            </header>

            {loading ? (
              <div className="account-loading"><LoaderCircle className="spinning" size={19} /> 正在读取安全配置</div>
            ) : (
              <form className="account-api-form" onSubmit={save}>
                <fieldset>
                  <legend>Model Provider / 模型提供方</legend>
                  <div className="provider-options">
                    {presets.map((preset) => (
                      <button type="button" key={preset.id} className={provider === preset.id ? "active" : ""} aria-pressed={provider === preset.id} onClick={() => selectProvider(preset.id)}>
                        <span>{preset.label}</span>{provider === preset.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {provider === "custom" && (
                  <fieldset>
                    <legend>接口模式</legend>
                    <div className="api-mode-options" role="group" aria-label="中转站接口模式">
                      <button type="button" className={apiMode === "responses" ? "active" : ""} aria-pressed={apiMode === "responses"} onClick={() => updateApiMode("responses")}>Responses API</button>
                      <button type="button" className={apiMode === "chat_completions" ? "active" : ""} aria-pressed={apiMode === "chat_completions"} onClick={() => updateApiMode("chat_completions")}>Chat Completions</button>
                    </div>
                  </fieldset>
                )}

                <label>
                  <span>Base URL / {provider === "custom" ? "中转站地址" : "接口地址"} <small>{provider === "custom" ? "/v1 或完整地址" : "可使用默认值"}</small></span>
                  <div className="account-field"><Server size={16} /><input type="url" value={baseUrl} onChange={(event) => updateBaseUrl(event.target.value)} placeholder={selectedPreset?.base_url ?? "https://relay.example.com/v1"} required={provider === "custom"} spellCheck={false} /></div>
                </label>
                <label>
                  <span>API Key / API 密钥 <small>{savedKeyApplies ? "留空则使用已保存密钥" : config?.has_api_key ? "Base URL 已更改，请重新填写" : "仅提交至服务器"}</small></span>
                  <div className="account-field">
                    <KeyRound size={16} />
                    <input type={keyVisible ? "text" : "password"} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setSaved(false); setTestResult(null); clearModelDiscovery(); }} placeholder={savedKeyApplies ? "已安全保存" : "输入 API 密钥"} autoComplete="off" spellCheck={false} />
                    <button type="button" onClick={() => setKeyVisible((visible) => !visible)} title={keyVisible ? "隐藏密钥" : "显示密钥"} aria-label={keyVisible ? "隐藏密钥" : "显示密钥"}>{keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                </label>
                <div className="account-model-control">
                  <label>
                    <span>Model / 模型 ID <small>{availableModels.length ? `${availableModels.length} 个可用模型，可继续手动输入` : "支持自动检测"}</small></span>
                    <div className="account-field"><Waves size={16} /><input list="provider-model-options" value={model} onChange={(event) => { setModel(event.target.value); setSaved(false); setTestResult(null); }} placeholder="输入或检测服务商提供的模型 ID" maxLength={160} required spellCheck={false} /></div>
                    <datalist id="provider-model-options">
                      {availableModels.map((availableModel) => <option key={availableModel} value={availableModel} />)}
                    </datalist>
                  </label>
                  <button type="button" className="account-model-detect" onClick={() => void discoverModels()} disabled={saving || testing || discovering}>
                    {discovering ? <LoaderCircle className="spinning" size={16} /> : <RefreshCw size={16} />}
                    {discovering ? "正在检测" : "检测模型"}
                  </button>
                </div>

                {error && <div className="account-form-error" role="alert">{error}</div>}
                {modelDiscoveryMessage && <div className="account-model-success" role="status"><Check size={15} /> {modelDiscoveryMessage}，已选择 {model}</div>}
                {testResult && <div className="account-test-success" role="status"><Check size={15} /> 连接可用 · {testResult.api_mode === "responses" ? "Responses API" : "Chat Completions"} · {testResult.latency_ms} ms</div>}
                {saved && <div className="account-save-success" role="status"><Check size={15} /> API 配置已更新</div>}

                <footer className="account-form-actions">
                  {config && !confirmDelete && <button type="button" className="account-danger-button" onClick={() => setConfirmDelete(true)} disabled={saving}><Trash2 size={15} /> 移除配置</button>}
                  {config && confirmDelete && (
                    <div className="account-delete-confirm">
                      <span>确定移除？</span>
                      <button type="button" onClick={() => void removeConfig()} disabled={saving}>移除</button>
                      <button type="button" onClick={() => setConfirmDelete(false)} disabled={saving}>取消</button>
                    </div>
                  )}
                  <button type="button" className="account-test-button" onClick={() => void testConnection()} disabled={saving || testing || discovering}>
                    {testing ? <LoaderCircle className="spinning" size={16} /> : <RefreshCw size={16} />}
                    {testing ? "正在测试" : "测试连接"}
                  </button>
                  <button type="submit" className="account-save-button" disabled={saving || testing || discovering}>
                    {saving ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
                    {saving ? "正在保存" : "保存配置"}
                  </button>
                </footer>
              </form>
            )}
          </section>

          <section className="account-session-row">
            <div><LockKeyhole size={16} /><span><b>当前会话</b><small>退出后将清除安全会话 Cookie</small></span></div>
            <button type="button" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? <LoaderCircle className="spinning" size={16} /> : <LogOut size={16} />}
              退出登录
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
