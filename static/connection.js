"use strict";
// A página hospedada usa o SDK oficial; no notebook o servidor compartilha a
// sessão com o MCP. Em ambos os casos, a chave administrativa não é utilizada.
window.TaskConnection = (() => {
  const desktop = ["localhost", "127.0.0.1"].includes(location.hostname);
  const fields = "id,text,notes,completed,due_at,created_at";
  let state = { mode: desktop ? "local" : "signed-out", context: desktop ? "local" : "signed-out", email: "", local_count: 0, desktop };
  let client;
  const listeners = new Set();

  function publish(next, deferred = false) {
    const oldContext = state.context;
    state = { ...next, desktop };
    const notify = () => {
      listeners.forEach((callback) => callback(state));
      if (oldContext !== state.context) window.dispatchEvent(new Event("task-account-changed"));
    };
    if (deferred) setTimeout(notify, 0); else notify();
    return state;
  }

  function sdkError(error) {
    const messages = {
      invalid_credentials: "E-mail ou senha incorretos.", email_not_confirmed: "Confirme seu e-mail antes de entrar.",
      weak_password: "Escolha uma senha mais forte.", over_email_send_rate_limit: "O envio de e-mails atingiu o limite. Aguarde antes de tentar novamente.",
      signup_disabled: "O cadastro está desativado neste projeto.",
    };
    return new Error(messages[error.code] || "Não foi possível concluir a operação na nuvem. Confira a conexão e tente novamente.");
  }

  async function raw(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path.endsWith("/import") ? 600000 : 45000);
    try {
      const response = await fetch(path, { ...options, signal: controller.signal, cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Task-Context": state.context, ...options.headers } });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || "Não foi possível concluir a operação.");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError" || error instanceof TypeError) throw new Error("Não foi possível conectar. Verifique sua conexão e o servidor da lista.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  function sessionState(session) {
    return { mode: session ? "cloud" : "signed-out", context: session ? `cloud:${session.user.id}` : "signed-out",
      email: session?.user.email || "", user_id: session?.user.id || null, local_count: 0 };
  }

  async function refreshAccount() {
    if (desktop) return publish(await raw("/api/account"));
    const { data, error } = await client.auth.getSession();
    if (error) throw sdkError(error);
    return publish(sessionState(data.session));
  }

  const ready = (async () => {
    // A confirmação é seguida de login por senha. Não retemos tokens no fragmento.
    if (location.hash.includes("access_token=")) history.replaceState(null, "", location.pathname + location.search);
    if (desktop) return refreshAccount();
    if (location.protocol !== "https:" || location.hostname === "") throw new Error("Abra a versão hospedada por HTTPS para entrar na conta.");
    const response = await fetch("/cloud-config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Configuração pública indisponível.");
    const config = await response.json();
    if (!config.publishableKey?.startsWith("sb_publishable_") || new URL(config.url).protocol !== "https:") throw new Error("Configuração pública inválida.");
    client = SupabaseBrowser.createClient(config.url, config.publishableKey, {
      auth: { detectSessionInUrl: false, storageKey: "minha-lista-supabase", autoRefreshToken: true, persistSession: true },
    });
    client.auth.onAuthStateChange((_event, session) => { publish(sessionState(session), true); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return refreshAccount();
  })();

  async function request(path, options = {}) {
    await ready;
    if (desktop) {
      try { return await raw(path, options); }
      catch (error) {
        if (error.status === 409) await refreshAccount();
        if (error.status === 401) window.dispatchEvent(new Event("task-login-needed"));
        throw error;
      }
    }
    if (state.mode !== "cloud") throw new Error("Entre na sua conta para carregar as tarefas.");
    const expected = state.context;
    const method = options.method || "GET";
    let result;
    if (method === "GET" && path === "/api/tasks") {
      const tasks = [];
      for (let offset = 0; ; offset += 1000) {
        result = await client.from("tasks").select(fields).order("created_at").order("id").range(offset, offset + 999);
        if (result.error) throw sdkError(result.error);
        tasks.push(...result.data);
        if (result.data.length < 1000) break;
      }
      if (expected !== state.context) throw new Error("A conta mudou. A lista será recarregada.");
      return { tasks };
    }
    const data = JSON.parse(options.body || "{}");
    if (method === "POST" && path === "/api/tasks") result = await client.from("tasks").insert(data).select(fields).single();
    else if (method === "PATCH" && path.startsWith("/api/tasks/")) result = await client.from("tasks").update(data).eq("id", decodeURIComponent(path.slice(11))).select(fields).single();
    else throw new Error("Operação indisponível.");
    if (result.error) throw sdkError(result.error);
    if (expected !== state.context) throw new Error("A conta mudou. Confira o resultado antes de repetir a ação.");
    return { task: result.data };
  }

  async function login(email, password) {
    await ready;
    if (desktop) return publish(await raw("/api/account/login", { method: "POST", body: JSON.stringify({ email, password }) }));
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw sdkError(error);
    return publish(sessionState(data.session));
  }

  async function signup(email, password) {
    await ready;
    if (desktop) return raw("/api/account/signup", { method: "POST", body: JSON.stringify({ email, password }) });
    const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + "/" } });
    if (error) throw sdkError(error);
    return { message: "Verifique sua caixa de entrada e confirme o e-mail. Depois volte à lista e entre com sua senha." };
  }

  async function logout() {
    await ready;
    if (desktop) return publish(await raw("/api/account/logout", { method: "POST", body: "{}" }));
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw sdkError(error);
    return publish(sessionState(null));
  }

  async function importLocal() {
    if (!desktop || state.mode !== "cloud") throw new Error("Entre na conta pelo notebook para importar as tarefas locais.");
    return raw("/api/account/import", { method: "POST", body: "{}" });
  }

  return { ready, request, login, signup, logout, importLocal, refreshAccount,
    get state() { return state; }, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
})();
