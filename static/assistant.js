"use strict";

(() => {
  const connection = window.TaskConnection;
  const dialog = document.querySelector("#assistant-dialog");
  const input = document.querySelector("#assistant-command");
  const send = document.querySelector("#send-assistant");
  const confirm = document.querySelector("#confirm-assistant");
  const response = document.querySelector("#assistant-response");
  const results = document.querySelector("#assistant-results");
  const usage = 'Tente “Adicionar pagar a internet amanhã às 9h” ou “Mostrar tarefas de hoje”.';
  let draft = null;
  let busy = false;

  function parse(command, now = new Date()) {
    const value = command.trim().replace(/\s+/g, " ");
    const normalized = value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "").replace(/[?.!]$/, "");
    const listing = /^(?:mostrar|listar|ver) (?:as |minhas )?tarefas(?: (?:de )?(hoje|amanha|pendentes|concluidas|todas))?$/.exec(normalized);
    if (listing) return { view: listing[1] || "todas" };

    const creation = /^(?:adicionar|adicione|criar|crie)(?:\s+(?:uma\s+)?tarefa(?:\s*:\s*|\s+)|\s+|:\s*)(.+)$/i.exec(value);
    if (!creation) throw new Error(usage);

    const title = creation[1].trim();
    const schedule = /\s+(hoje|amanh[ãa])(?:\s+[àa]s\s+(.+))?$/i.exec(title);
    let due_at = null;
    let text = title;
    if (schedule) {
      const time = /^(\d{1,2})(?:(?:h(?:(\d{2}))?)|:(\d{2}))?$/i.exec(schedule[2]?.trim() || "");
      if (!time || Number(time[1]) > 23 || Number(time[2] || time[3] || 0) > 59) {
        throw new Error('Informe um horário válido, como “amanhã às 9h30”.');
      }
      const hours = Number(time[1]);
      const minutes = Number(time[2] || time[3] || 0);
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (schedule[1].toLowerCase() === "hoje" ? 0 : 1), 12);
      day.setHours(hours, minutes, 0, 0);
      if (day.getHours() !== hours || day.getMinutes() !== minutes) throw new Error("Esse horário não existe no fuso deste aparelho.");
      due_at = day.toISOString();
      text = title.slice(0, schedule.index).trim();
    } else if (/^(?:hoje|amanh[ãa])(?:\s|$)/i.test(title) || /\s+[àa]s\s+\d/i.test(title)) {
      throw new Error('Escreva o nome da tarefa seguido de “hoje” ou “amanhã” e do horário.');
    }
    if (!text || text.length > 500) throw new Error("Use um nome de tarefa com até 500 caracteres.");
    return { task: { text, due_at } };
  }

  function clearResult() {
    draft = null;
    confirm.hidden = true;
    response.textContent = "";
    results.replaceChildren();
    results.hidden = true;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    confirm.disabled = value;
    input.readOnly = value;
  }

  const formatDate = (value) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  function showTasks(tasks, view) {
    const date = new Date();
    if (view === "amanha") date.setDate(date.getDate() + 1);
    const dueDay = date.toDateString();
    const matching = tasks.filter((task) => {
      if (view === "pendentes") return !task.completed;
      if (view === "concluidas") return task.completed;
      if (view === "hoje" || view === "amanha") return task.due_at && new Date(task.due_at).toDateString() === dueDay;
      return true;
    });
    response.textContent = matching.length
      ? `${matching.length} ${matching.length === 1 ? "tarefa encontrada" : "tarefas encontradas"}.${matching.length > 10 ? " Mostrando as primeiras 10." : ""}`
      : "Nenhuma tarefa encontrada.";
    matching.slice(0, 10).forEach((task) => {
      const item = document.createElement("li");
      item.textContent = `${task.text} · ${task.completed ? "Concluída" : "Pendente"}${task.due_at ? ` · ${formatDate(task.due_at)}` : ""}`;
      results.append(item);
    });
    results.hidden = !matching.length;
  }

  document.querySelector("#assistant-button").addEventListener("click", () => dialog.showModal());
  document.querySelector("#close-assistant").addEventListener("click", () => dialog.close());
  input.addEventListener("input", clearResult);

  window.addEventListener("task-account-changed", () => {
    input.value = "";
    clearResult();
    if (dialog.open) dialog.close();
  });

  document.querySelector("#assistant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    clearResult();
    setBusy(true);
    try {
      const command = parse(input.value);
      await connection.ready;
      const { mode, context } = connection.state;
      if (mode === "signed-out") throw new Error("Entre na sua conta para usar o assistente.");
      if (command.task) {
        draft = { task: command.task, context };
        response.textContent = `Criar “${draft.task.text}” ${draft.task.due_at ? `para ${formatDate(draft.task.due_at)}` : "sem data marcada"}?`;
        confirm.hidden = false;
        return;
      }
      const data = await window.listActions.run(() => connection.request("/api/tasks", { expectedContext: context }));
      if (context === connection.state.context) showTasks(data.tasks, command.view);
    } catch (error) {
      response.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });

  confirm.addEventListener("click", async () => {
    if (!draft || busy) return;
    const { task, context } = draft;
    clearResult();
    setBusy(true);
    try {
      await window.listActions.run(() => connection.request("/api/tasks", {
        method: "POST", body: JSON.stringify(task), expectedContext: context,
      }));
      if (context === connection.state.context) {
        input.value = "";
        response.textContent = `Tarefa “${task.text}” criada.`;
        window.listActions.refresh();
      }
    } catch (error) {
      if (context === connection.state.context) response.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
})();
