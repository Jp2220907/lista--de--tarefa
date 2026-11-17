"use strict";
(() => {
  const api = window.TaskConnection;
  const modal = document.querySelector("#account-dialog");
  const form = document.querySelector("#account-form");
  const email = document.querySelector("#account-email");
  const password = document.querySelector("#account-password");
  const message = document.querySelector("#account-message");
  const importButton = document.querySelector("#import-local");
  let busy = false;

  function showMessage(text, error = false) {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle("is-error", error);
  }
  function display(state) {
    document.querySelector("#account-button").textContent = state.mode === "cloud" ? "Minha conta" : "Entrar para sincronizar";
    document.querySelector("#account-mode").textContent = state.mode === "cloud" ? (state.session_error ? "Sua sessão precisa de login" : `Nuvem · ${state.email}`) : state.desktop ? "Lista local neste notebook · sem sincronização" : "Entre na conta para carregar suas tarefas";
    document.querySelector("#logout-account").hidden = state.mode !== "cloud";
    importButton.hidden = !state.desktop || state.mode !== "cloud" || !state.local_count;
  }
  function open() {
    if (modal.open) return;
    email.value = api.state.email || "";
    password.value = "";
    message.hidden = true;
    modal.showModal();
    email.focus();
  }
  async function action(callback) {
    if (busy) return;
    busy = true;
    modal.querySelectorAll("input, button").forEach((item) => { item.disabled = true; });
    importButton.disabled = true;
    try {
      await window.listActions.run(callback);
    } catch (error) { if (!modal.open) modal.showModal(); showMessage(error.message, true); }
    finally {
      busy = false;
      password.value = "";
      modal.querySelectorAll("input, button").forEach((item) => { item.disabled = false; });
      importButton.disabled = false;
    }
  }
  document.querySelector("#account-button").addEventListener("click", open);
  document.querySelector("#close-account").addEventListener("click", () => modal.close());
  modal.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  window.addEventListener("task-login-needed", () => { open(); showMessage("Entre novamente para acessar as tarefas na nuvem.", true); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const address = email.value.trim(), secret = password.value;
    action(async () => { await api.login(address, secret); modal.close(); });
  });
  document.querySelector("#signup-account").addEventListener("click", () => {
    if (!form.reportValidity()) return;
    const address = email.value.trim(), secret = password.value;
    action(async () => { const result = await api.signup(address, secret); showMessage(result.message); });
  });
  document.querySelector("#forgot-password").addEventListener("click", () => {
    if (!email.reportValidity()) return;
    const address = email.value.trim();
    action(async () => { const result = await api.recoverPassword(address); showMessage(result.message); });
  });
  document.querySelector("#logout-account").addEventListener("click", () => {
    action(async () => { await api.logout(); modal.close(); });
  });
  importButton.addEventListener("click", () => {
    if (busy || !confirm(`Enviar ${api.state.local_count} tarefas locais para ${api.state.email}? Os originais serão mantidos e tarefas já existentes na nuvem não serão substituídas.`)) return;
    action(async () => {
      const result = await api.importLocal();
      open();
      showMessage(`${result.created} tarefas enviadas; ${result.skipped} já existiam e foram preservadas. Seus originais locais continuam salvos.`);
    }).then(() => window.listActions.refresh());
  });
  api.subscribe(display);
  api.ready.then((state) => {
    display(state);
    const url = new URL(location.href);
    const requestedLogin = url.searchParams.get('login') === '1';
    if (requestedLogin) {
      url.searchParams.delete('login');
      history.replaceState(null, '', url.pathname + url.search);
    }
    if (state.mode === "signed-out" || requestedLogin) open();
    if (requestedLogin) {
      email.value = '';
      showMessage('Entre com o e-mail da conta recuperada e sua senha nova.');
      email.focus();
    }
  }).catch((error) => { open(); showMessage(error.message, true); });
})();
