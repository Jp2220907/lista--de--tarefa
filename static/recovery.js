"use strict";
(async () => {
  // Captura uma vez e remove os tokens da barra de endereço antes de fazer rede.
  const fragment = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  const status = document.querySelector("#recovery-status");
  const errorMessage = document.querySelector("#recovery-error");
  const form = document.querySelector("#recovery-form");
  const fields = document.querySelector("#recovery-fields");
  const password = document.querySelector("#new-password");
  const confirmation = document.querySelector("#confirm-password");
  let client;
  let saving = false;
  function showError(text) { errorMessage.textContent = text; errorMessage.hidden = false; }
  function readable(error) {
    const messages = {
      weak_password: "Escolha uma senha mais forte, com pelo menos 8 caracteres.",
      same_password: "Escolha uma senha diferente da anterior.",
      otp_expired: "O link expirou ou já foi utilizado. Volte ao login e solicite um novo link.",
      session_not_found: "Sua sessão de recuperação expirou. Solicite um novo link.",
      refresh_token_not_found: "Sua sessão de recuperação expirou. Solicite um novo link.",
    };
    return messages[error?.code] || "Não foi possível concluir a operação. Confira a conexão. Se o link expirou, solicite um novo pelo login.";
  }
  try {
    if (fragment.has("error") || fragment.get("type") !== "recovery" || !fragment.get("access_token") || !fragment.get("refresh_token")) {
      throw new Error("invalid_link");
    }
    const response = await fetch("/cloud-config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    const config = await response.json();
    if (!config.publishableKey?.startsWith("sb_publishable_") || new URL(config.url).protocol !== "https:") throw new Error("unavailable");
    // Sessão exclusiva em memória: não substitui a conta da lista nem a do MCP.
    client = SupabaseBrowser.createClient(config.url, config.publishableKey, {
      auth: { storageKey: "minha-lista-recovery", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.setSession({ access_token: fragment.get("access_token"), refresh_token: fragment.get("refresh_token") });
    fragment.delete("access_token"); fragment.delete("refresh_token");
    if (error || !data.session?.user) throw error || new Error("invalid_link");
    const user = document.querySelector("#recovery-user");
    user.textContent = `Conta: ${data.session.user.email || "confirmada"}`;
    user.hidden = false;
    status.textContent = "Link validado. Escolha sua nova senha abaixo.";
    form.hidden = false;
    fields.disabled = false;
    password.focus();
  } catch (error) {
    fragment.delete("access_token"); fragment.delete("refresh_token");
    status.textContent = "Não foi possível validar este link.";
    showError(error?.message === "invalid_link" ? "Abra o link recebido no e-mail de recuperação. Se ele expirou ou já foi utilizado, solicite um novo pelo login." : readable(error));
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || form.hidden) return;
    errorMessage.hidden = true;
    if (!form.reportValidity()) return;
    if (password.value !== confirmation.value) { showError("As senhas não coincidem. Digite a mesma senha nos dois campos."); confirmation.focus(); return; }
    saving = true;
    fields.disabled = true;
    status.textContent = "Salvando sua nova senha…";
    try {
      const { error } = await client.auth.updateUser({ password: password.value });
      if (error) throw error;
      password.value = ""; confirmation.value = "";
      form.hidden = true;
      status.textContent = "Senha atualizada! Volte ao login para entrar com sua nova senha.";
      document.querySelector("#back-to-login").classList.add("primary-button");
      // Descartamos somente a sessão temporária desta recuperação.
      try { await client.auth.signOut({ scope: "local" }); } catch { /* A senha já foi atualizada. */ }
      client = null;
    } catch (error) {
      status.textContent = "A senha não foi atualizada. Confira a mensagem abaixo.";
      showError(readable(error));
      fields.disabled = false;
    } finally {
      password.value = ""; confirmation.value = "";
      saving = false;
    }
  });
})();
