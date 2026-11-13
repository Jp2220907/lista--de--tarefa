"use strict";

const form = document.querySelector("#task-form");
const input = document.querySelector("#new-task");
const addButton = document.querySelector("#add-task");
const list = document.querySelector("#task-list");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyDescription = document.querySelector("#empty-description");
const errorMessage = document.querySelector("#error-message");
const syncStatus = document.querySelector("#sync-status");
const announcement = document.querySelector("#announcement");

let tasks = [];
let loaded = false;
let refreshPending = false;
let requestQueue = Promise.resolve();
const rows = new Map();
const saving = new Set();

// Serialize reads and writes so an older poll cannot overwrite a new action.
function enqueue(operation) {
  const result = requestQueue.then(operation);
  requestQueue = result.catch(() => {});
  return result;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Não foi possível ler a resposta. Tente novamente.");
    }
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar a alteração.");
    return data;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw new Error("Não foi possível conectar. Confira se o aplicativo está aberto e tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function showError(error) {
  errorMessage.textContent = error.message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function render() {
  const activeIds = new Set(tasks.map((task) => task.id));
  for (const [id, row] of rows) {
    if (!activeIds.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }

  tasks.forEach((task, index) => {
    let row = rows.get(task.id);
    if (!row) {
      row = document.createElement("li");
      row.className = "task-item";
      const label = document.createElement("label");
      label.className = "task-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.addEventListener("change", () => changeCompletion(task.id, checkbox.checked));
      const text = document.createElement("span");
      text.className = "task-text";
      label.append(checkbox, text);
      row.append(label);
      rows.set(task.id, row);
    }
    const checkbox = row.querySelector("input");
    const text = row.querySelector(".task-text");
    if (text.textContent !== task.text) text.textContent = task.text;
    if (!saving.has(task.id)) checkbox.checked = task.completed;
    checkbox.disabled = saving.has(task.id);
    row.classList.toggle("is-completed", task.completed);
    row.classList.toggle("is-saving", saving.has(task.id));
    // Leave existing nodes in place on unchanged polls, preserving keyboard focus.
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
  });

  const completed = tasks.filter((task) => task.completed).length;
  const pending = tasks.length - completed;
  document.querySelector("#pending-count").textContent = `${pending} ${pending === 1 ? "pendente" : "pendentes"}`;
  document.querySelector("#completed-count").textContent = `${completed} ${completed === 1 ? "concluída" : "concluídas"}`;
  emptyState.hidden = tasks.length > 0;
  if (loaded && tasks.length === 0) {
    emptyTitle.textContent = "Um espaço livre para começar";
    emptyDescription.textContent = "Adicione sua primeira tarefa no campo acima.";
  }
  list.setAttribute("aria-busy", String(!loaded));
}

async function refresh() {
  if (refreshPending) return;
  refreshPending = true;
  try {
    await enqueue(async () => {
      const data = await request("/api/tasks");
      if (!Array.isArray(data.tasks)) throw new Error("A lista recebida não é válida. Tente novamente.");
      tasks = data.tasks;
      loaded = true;
      if (syncStatus.textContent !== "Lista atualizada") syncStatus.textContent = "Lista atualizada";
      syncStatus.classList.remove("is-offline");
      render();
    });
  } catch (error) {
    if (syncStatus.textContent !== "Sem conexão") syncStatus.textContent = "Sem conexão";
    syncStatus.classList.add("is-offline");
    if (!loaded) {
      emptyTitle.textContent = "Não foi possível carregar a lista";
      emptyDescription.textContent = "Vamos tentar conectar novamente em instantes.";
      list.setAttribute("aria-busy", "false");
    }
  } finally {
    refreshPending = false;
  }
}

async function changeCompletion(id, completed) {
  if (saving.has(id)) return;
  saving.add(id);
  render();
  clearError();
  try {
    await enqueue(async () => {
      const data = await request(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      });
      tasks = tasks.map((task) => task.id === id ? data.task : task);
      announcement.textContent = completed ? "Tarefa concluída." : "Tarefa marcada como pendente.";
    });
  } catch (error) {
    showError(error);
    announcement.textContent = "A alteração não foi salva.";
  } finally {
    saving.delete(id);
    render();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (addButton.disabled) return;
  if (!text) {
    showError(new Error("Escreva uma tarefa antes de adicionar."));
    input.focus();
    return;
  }
  addButton.disabled = true;
  input.readOnly = true;
  clearError();
  try {
    await enqueue(async () => {
      const data = await request("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      tasks.push(data.task);
      loaded = true;
      input.value = "";
      render();
      announcement.textContent = "Tarefa adicionada.";
    });
  } catch (error) {
    showError(error);
  } finally {
    addButton.disabled = false;
    input.readOnly = false;
    input.focus();
  }
});

refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
