"use strict";

(() => {
  const connection = window.TaskConnection;
  const dialog = document.querySelector("#assistant-dialog");
  const input = document.querySelector("#assistant-command");
  const send = document.querySelector("#send-assistant");
  const confirm = document.querySelector("#confirm-assistant");
  const response = document.querySelector("#assistant-response");
  const previewNotes = document.querySelector("#assistant-preview-notes");
  const results = document.querySelector("#assistant-results");
  const usage = 'Tente “Adicionar pagar a internet amanhã às 9h” ou “Mostrar tarefas de hoje”.';
  let draft = null;
  let busy = false;

  const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const weekdayPattern = "domingo|(?:segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?|s[áa]bado";
  const dayPattern = `hoje|amanh[ãa]|depois de amanh[ãa]|${weekdayPattern}|\\d{1,2}/\\d{1,2}(?:/\\d{4})?`;
  const scheduledDate = new RegExp(`\\s+(?:(?:para\\s+)?(?:o\\s+)?dia\\s+|(?:para|no dia|na|no)\\s+)?(${dayPattern})(?:\\s+[àa]s?\\s+(.+))?$`, "i");
  const relativeDate = /\s+(?:para )?daqui a (\d{1,4})\s+(minutos?|horas?)[.!]?$/i;
  const normalize = (text) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");

  function resolveDate(dateText, timeText, now) {
    const time = /^(\d{1,2})(?:h(\d{2})?|:(\d{2}))?[.!]?$/i.exec(timeText || "");
    if (!time || Number(time[1]) > 23 || Number(time[2] || time[3] || 0) > 59) {
      throw new Error('Informe um horário válido, como “amanhã às 9h30” ou “dia 25/11 às 14:00”.');
    }
    const hours = Number(time[1]);
    const minutes = Number(time[2] || time[3] || 0);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const day = normalize(dateText).replace(/-feira$/, "");
    const [dayOfMonth, month, year = now.getFullYear()] = day.split("/").map(Number);
    if (day.includes("/")) {
      date.setFullYear(year, month - 1, dayOfMonth);
      if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== dayOfMonth) {
        throw new Error("Essa data não existe. Confira o dia, o mês e o ano.");
      }
    } else {
      const weekday = weekdays.indexOf(day);
      const offset = weekday >= 0 ? (weekday - now.getDay() + 7) % 7 || 7
        : day === "depois de amanha" ? 2 : day === "amanha" ? 1 : 0;
      date.setDate(date.getDate() + offset);
    }
    date.setHours(hours, minutes, 0, 0);
    if (date.getHours() !== hours || date.getMinutes() !== minutes) throw new Error("Esse horário não existe no fuso deste aparelho.");
    return date.toISOString();
  }

  function parse(command, now = new Date()) {
    const value = command.trim().replace(/\s+/g, " ");
    const normalized = normalize(value).replace(/[?.!]$/, "");
    const listing = /^(?:mostrar|listar|ver) (?:as |minhas )?tarefas(?: (?:de )?(hoje|amanha|pendentes|concluidas|todas))?$/.exec(normalized);
    if (listing) return { view: listing[1] || "todas" };

    const creation = /^(?:adicionar|adicione|adiciona|criar|crie|cria|agendar|agende|anotar|anote)(?:\s*:\s*|\s+)(.*)$/i.exec(value);
    if (!creation) throw new Error(usage);
    const content = creation[1].replace(/^(?:uma\s+)?tarefa(?:\s*:\s*|\s+|$)/i, "");
    const notesMarker = /;\s*(?:nota(?:s)?|anota(?:ç[ãa]o|ç[õo]es|cao|coes))\s*:\s*/i.exec(content);
    const title = (notesMarker ? content.slice(0, notesMarker.index) : content).trim();
    const notes = notesMarker ? content.slice(notesMarker.index + notesMarker[0].length).trim() : "";
    if (notesMarker && !notes) throw new Error('Escreva a anotação depois de “; nota:”.');

    const relative = relativeDate.exec(title);
    const schedule = relative ? null : scheduledDate.exec(title);
    let due_at = null;
    let text = title;
    if (relative) {
      const amount = Number(relative[1]);
      if (!amount) throw new Error("Informe pelo menos um minuto ou uma hora.");
      const minutes = normalize(relative[2]).startsWith("hora") ? amount * 60 : amount;
      due_at = new Date(now.getTime() + minutes * 60_000).toISOString();
      text = title.slice(0, relative.index).trim();
    } else if (schedule) {
      due_at = resolveDate(schedule[1], schedule[2], now);
      text = title.slice(0, schedule.index).trim();
    } else if (/\bdaqui a\b|\s+[àa]s?\s+\d/i.test(title)) {
      throw new Error('Use um dia e um horário, como “sexta às 14h”, ou um prazo como “daqui a 15 minutos”.');
    }
    if (!text || text.length > 500) throw new Error("Use um nome de tarefa com até 500 caracteres.");
    return { task: { text, due_at, notes } };
  }

  function clearResult() {
    draft = null;
    confirm.hidden = true;
    response.textContent = "";
    previewNotes.textContent = "";
    previewNotes.hidden = true;
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
        if (draft.task.notes) {
          previewNotes.textContent = `Anotação: ${draft.task.notes}`;
          previewNotes.hidden = false;
        }
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
