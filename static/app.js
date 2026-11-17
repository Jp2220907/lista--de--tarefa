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
const dueInput = document.querySelector("#new-due");
const notesInput = document.querySelector("#new-notes");
const search = document.querySelector("#search");
const dialog = document.querySelector("#edit-dialog");
const editText = document.querySelector("#edit-text");
const editDue = document.querySelector("#edit-due");
const editNotes = document.querySelector("#edit-notes");
const editError = document.querySelector("#edit-error");
let filter = "all";
let editingId = null;
let editSaving = false;
const notificationTaskPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let notificationTask = new URL(location.href).searchParams.get('task');
if (!notificationTaskPattern.test(notificationTask || '')) notificationTask = null;
function revealNotificationTask() {
  if (!notificationTask || !loaded) return;
  const id = notificationTask;
  notificationTask = null;
  const url = new URL(location.href); url.searchParams.delete('task');
  history.replaceState(null, '', url.pathname + url.search);
  const task = tasks.find((item) => item.id === id);
  if (!task) { showError(new Error('A tarefa deste aviso não está disponível na conta atual.')); return; }
  search.value = ''; filter = 'all'; updateFilters();
  if (task.due_at) window.TaskCalendar.select(window.TaskCalendar.key(new Date(task.due_at)));
  render(); openEdit(task.id);
}
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type !== 'OPEN_TASK' || !notificationTaskPattern.test(event.data.taskId || '')) return;
  notificationTask = event.data.taskId;
  refresh();
});

function toISO(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Confira a data e a hora informadas.");
  return date.toISOString();
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function visibleTask(task) {
  if (window.TaskCalendar.activeDate && (!task.due_at || window.TaskCalendar.key(new Date(task.due_at)) !== window.TaskCalendar.activeDate)) return false;
  const query = search.value.trim().toLocaleLowerCase("pt-BR");
  if (!`${task.text} ${task.notes || ""}`.toLocaleLowerCase("pt-BR").includes(query)) return false;
  if (filter === "pending") return !task.completed;
  if (filter === "completed") return task.completed;
  if (filter === "today") return task.due_at && new Date(task.due_at).toDateString() === new Date().toDateString();
  return true;
}

let tasks = [];
let loaded = false;
let refreshPending = false;
let requestQueue = Promise.resolve();
const rows = new Map();
const saving = new Set();
let agendaSignature = "";

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element.textContent !== String(value)) element.textContent = value;
}

function updateOverview() {
  const now = new Date();
  const completed = tasks.filter((task) => task.completed).length;
  const today = tasks.filter((task) => task.due_at && new Date(task.due_at).toDateString() === now.toDateString()).length;
  const counts = { all: tasks.length, today, pending: tasks.length - completed, completed };
  document.querySelectorAll("[data-count]").forEach((element) => {
    element.textContent = counts[element.dataset.count];
  });
  setText("#stat-pending", counts.pending);
  setText("#stat-today", today);
  setText("#stat-completed", completed);
  setText("#visible-count", tasks.filter(visibleTask).length);
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  setText("#progress-value", `${percent}%`);
  document.querySelector("#progress-ring").setAttribute("stroke-dashoffset", String(320.442 * (1 - percent / 100)));
  setText("#progress-description", tasks.length ? `${completed} de ${tasks.length} ${tasks.length === 1 ? "tarefa concluída" : "tarefas concluídas"}.` : "Adicione uma tarefa para começar.");
  const date = document.querySelector("#current-date");
  date.textContent = now.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "long" });
  date.dateTime = toLocalInput(now.toISOString()).split("T")[0];
  const upcoming = tasks.filter((task) => !task.completed && task.due_at && new Date(task.due_at) >= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 3);
  const signature = JSON.stringify(upcoming);
  document.querySelector("#upcoming-empty").hidden = upcoming.length > 0;
  if (signature !== agendaSignature) {
    agendaSignature = signature;
    const agenda = document.querySelector("#upcoming-list");
    agenda.replaceChildren();
    upcoming.forEach((task) => {
      const date = new Date(task.due_at);
      const item = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = "agenda-date";
      const month = document.createElement("span");
      month.textContent = date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      const day = document.createElement("strong");
      day.textContent = date.getDate();
      badge.append(month, day);
      const copy = document.createElement("div");
      copy.className = "agenda-copy";
      const title = document.createElement("p");
      title.textContent = task.text;
      const time = document.createElement("time");
      time.dateTime = task.due_at;
      time.textContent = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      time.title = date.toLocaleString("pt-BR");
      copy.append(title, time);
      item.append(badge, copy);
      agenda.append(item);
    });
  }
}

// Serialize reads and writes so an older poll cannot overwrite a new action.
function enqueue(operation) {
  const result = requestQueue.then(operation);
  requestQueue = result.catch(() => {});
  return result;
}

async function request(path, options = {}) {
  return window.TaskConnection.request(path, options);
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
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-button";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => openEdit(task.id));
      const meta = document.createElement("div");
      meta.className = "task-meta";
      const due = document.createElement("p");
      due.className = "task-due";
      const notes = document.createElement("p");
      notes.className = "task-notes";
      meta.append(due, notes);
      row.append(label, edit, meta);
      rows.set(task.id, row);
    }
    const checkbox = row.querySelector("input");
    const text = row.querySelector(".task-text");
    if (text.textContent !== task.text) text.textContent = task.text;
    if (!saving.has(task.id)) checkbox.checked = task.completed;
    checkbox.disabled = saving.has(task.id);
    row.classList.toggle("is-completed", task.completed);
    row.classList.toggle("is-saving", saving.has(task.id));
    row.hidden = !visibleTask(task);
    row.querySelector(".edit-button").setAttribute("aria-label", `Editar: ${task.text}`);
    const due = row.querySelector(".task-due");
    const overdue = task.due_at && !task.completed && new Date(task.due_at) < new Date();
    due.hidden = !task.due_at;
    due.textContent = task.due_at ? `${overdue ? "Atrasada · " : ""}${new Date(task.due_at).toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"})}` : "";
    due.classList.toggle("overdue", Boolean(overdue));
    const notes = row.querySelector(".task-notes");
    notes.hidden = !task.notes;
    notes.textContent = task.notes || "";
    // Leave existing nodes in place on unchanged polls, preserving keyboard focus.
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
  });

  const completed = tasks.filter((task) => task.completed).length;
  const pending = tasks.length - completed;
  document.querySelector("#pending-count").textContent = `${pending} ${pending === 1 ? "pendente" : "pendentes"}`;
  document.querySelector("#completed-count").textContent = `${completed} ${completed === 1 ? "concluída" : "concluídas"}`;
  emptyState.hidden = tasks.some(visibleTask);
  if (loaded && tasks.length > 0 && !tasks.some(visibleTask)) {
    emptyTitle.textContent = "Nenhuma tarefa por aqui";
    emptyDescription.textContent = "Experimente outra busca ou escolha outro filtro.";
  }
  if (loaded && tasks.length === 0) {
    emptyTitle.textContent = "Um espaço livre para começar";
    emptyDescription.textContent = "Adicione sua primeira tarefa no campo acima.";
  }
  list.setAttribute("aria-busy", String(!loaded));
  updateOverview();
  window.TaskCalendar.update(tasks);
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
      revealNotificationTask();
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
  dueInput.disabled = true;
  notesInput.readOnly = true;
  clearError();
  try {
    await enqueue(async () => {
      const data = await request("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ text, notes: notesInput.value, due_at: toISO(dueInput.value) }),
      });
      tasks.push(data.task);
      loaded = true;
      input.value = "";
      dueInput.value = "";
      notesInput.value = "";
      filter = "all";
      search.value = "";
      updateFilters();
      render();
      announcement.textContent = "Tarefa adicionada.";
    });
  } catch (error) {
    showError(error);
  } finally {
    addButton.disabled = false;
    input.readOnly = false;
    dueInput.disabled = false;
    notesInput.readOnly = false;
    input.focus();
  }
});

function updateFilters() {
  window.TaskCalendar.clearFilter();
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  });
  const views = {
    all: ["Minhas tarefas", "Todas as tarefas", "Um lugar para organizar o dia e tirar as ideias do papel."],
    today: ["Meu dia", "Hoje", "Tudo o que tem data marcada para hoje, em um só lugar."],
    pending: ["Para fazer", "Pendentes", "Uma tarefa de cada vez. Você escolhe o próximo passo."],
    completed: ["Concluídas", "Concluídas", "Olhe para tudo o que você já tirou do caminho."],
  };
  const [title, breadcrumb, subtitle] = views[filter];
  const heading = document.querySelector("#page-title");
  heading.textContent = title;
  const dot = document.createElement("span");
  dot.textContent = ".";
  heading.append(dot);
  setText("#view-name", breadcrumb);
  setText("#page-subtitle", subtitle);
}

document.querySelector("#focus-composer").addEventListener("click", () => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelector(".composer").scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
  input.focus({ preventScroll: true });
});

search.addEventListener("input", render);
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    updateFilters();
    render();
  });
});

function openEdit(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  editingId = id;
  editText.value = task.text;
  editNotes.value = task.notes || "";
  editDue.value = toLocalInput(task.due_at);
  editError.hidden = true;
  dialog.showModal();
  editText.focus();
}

document.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", (event) => { if (editSaving) event.preventDefault(); });
document.querySelector("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (editSaving) return;
  editSaving = true;
  const controls = [...dialog.querySelectorAll("input, textarea, button")];
  controls.forEach((control) => { control.disabled = true; });
  editError.hidden = true;
  try {
    const body = { text: editText.value.trim(), notes: editNotes.value, due_at: toISO(editDue.value) };
    await enqueue(async () => {
      const data = await request(`/api/tasks/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(body) });
      tasks = tasks.map((task) => task.id === editingId ? data.task : task);
      render();
    });
    dialog.close();
    announcement.textContent = "Alterações salvas.";
  } catch (error) {
    editError.textContent = error.message;
    editError.hidden = false;
  } finally {
    editSaving = false;
    controls.forEach((control) => { control.disabled = false; });
  }
});

window.addEventListener('calendar-date-selected', () => render());
window.addEventListener('calendar-create-task', (event) => {
  const time = dueInput.value.slice(11) || '09:00';
  dueInput.value = `${event.detail.date}T${time}`;
  document.querySelector('.task-details').open = true;
  document.querySelector('.composer').scrollIntoView({ block: 'center' });
  input.focus({ preventScroll: true });
});

window.listActions = {
  edit: openEdit,
  run: enqueue,
  refresh,
};
window.addEventListener("task-account-changed", () => {
  // Limpa a lista anterior antes de carregar dados de outra conta/fonte.
  tasks = [];
  window.TaskCalendar.reset();
  loaded = false;
  search.value = "";
  filter = "all";
  updateFilters();
  emptyTitle.textContent = "Carregando suas tarefas…";
  emptyDescription.textContent = "Só um instante.";
  clearError();
  if (dialog.open) dialog.close();
  render();
  enqueue(async () => {}).then(refresh);
});
window.TaskConnection.ready.then(refresh).catch(showError);
setInterval(() => {
  if (!document.hidden) refresh();
}, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
