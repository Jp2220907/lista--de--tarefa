"use strict";
window.TaskCalendar = (() => {
  const panel = document.querySelector('#calendar-panel');
  const grid = document.querySelector('#calendar-days');
  const agenda = document.querySelector('#calendar-agenda');
  const pad = (n) => String(n).padStart(2, '0');
  const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromKey = (value) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  let selected = key(new Date());
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let activeDate = null;
  let tasks = [];
  let gridMonth = '';
  let agendaSignature = '';
  const buttons = new Map();

  function text(selector, value) {
    const node = document.querySelector(selector);
    if (node.textContent !== value) node.textContent = value;
  }
  function select(value, filter = true) {
    const date = fromKey(value);
    if (Number.isNaN(date.getTime())) return;
    selected = key(date);
    month = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    activeDate = filter ? selected : null;
    update(tasks);
    window.dispatchEvent(new CustomEvent('calendar-date-selected', { detail: { date: activeDate } }));
  }
  function moveMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1, 12);
    select(key(month), false);
  }
  function update(nextTasks) {
    tasks = nextTasks;
    const byDate = new Map();
    for (const task of tasks) {
      if (!task.due_at) continue;
      const day = key(new Date(task.due_at));
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day).push(task);
    }
    const title = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    text('#calendar-month', title.charAt(0).toUpperCase() + title.slice(1));
    const signature = `${month.getFullYear()}-${month.getMonth()}`;
    if (signature !== gridMonth) {
      gridMonth = signature;
      buttons.clear(); grid.replaceChildren();
      const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay(), 12);
      for (let i = 0; i < 42; i++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12);
        const dateKey = key(date);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'calendar-day'; button.dataset.date = dateKey;
        const number = document.createElement('span'); number.textContent = date.getDate();
        const count = document.createElement('span'); count.className = 'calendar-day-count';
        button.append(number, count);
        button.addEventListener('click', () => select(dateKey));
        button.addEventListener('keydown', (event) => {
          const jumps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() };
          if (!(event.key in jumps)) return;
          event.preventDefault();
          const target = new Date(date.getFullYear(), date.getMonth(), date.getDate() + jumps[event.key], 12);
          select(key(target)); buttons.get(key(target))?.focus();
        });
        buttons.set(dateKey, button); grid.append(button);
      }
    }
    const today = key(new Date());
    for (const [day, button] of buttons) {
      const date = fromKey(day);
      const count = byDate.get(day)?.length || 0;
      const countNode = button.querySelector('.calendar-day-count');
      countNode.textContent = count ? `${count}` : '';
      countNode.hidden = !count;
      button.classList.toggle('outside-month', date.getMonth() !== month.getMonth());
      button.classList.toggle('has-tasks', count > 0);
      button.setAttribute('aria-pressed', String(day === selected));
      if (day === today) button.setAttribute('aria-current', 'date'); else button.removeAttribute('aria-current');
      button.tabIndex = day === selected ? 0 : -1;
      button.setAttribute('aria-label', `${date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${count} ${count === 1 ? 'tarefa' : 'tarefas'}`);
    }
    text('#calendar-selected-title', fromKey(selected).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
    document.querySelector('#clear-calendar-date').hidden = !activeDate;
    const scheduled = [...(byDate.get(selected) || [])].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const newAgenda = JSON.stringify(scheduled);
    if (newAgenda !== agendaSignature) {
      agendaSignature = newAgenda; agenda.replaceChildren();
      for (const task of scheduled) {
        const li = document.createElement('li');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-task';
        const time = document.createElement('time'); time.dateTime = task.due_at;
        time.textContent = new Date(task.due_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const title = document.createElement('span'); title.textContent = task.text;
        const state = document.createElement('small'); state.textContent = task.completed ? 'Concluída' : 'Pendente';
        button.classList.toggle('completed', task.completed);
        button.setAttribute('aria-label', `Editar compromisso: ${task.text}`);
        button.append(time, title, state);
        button.addEventListener('click', () => window.listActions.edit(task.id));
        li.append(button); agenda.append(li);
      }
    }
    document.querySelector('#calendar-no-tasks').hidden = scheduled.length > 0;
  }
  document.querySelector('#calendar-prev').addEventListener('click', () => moveMonth(-1));
  document.querySelector('#calendar-next').addEventListener('click', () => moveMonth(1));
  document.querySelector('#calendar-today').addEventListener('click', () => select(key(new Date())));
  document.querySelector('#clear-calendar-date').addEventListener('click', () => select(selected, false));
  document.querySelector('#calendar-add').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('calendar-create-task', { detail: { date: selected } }));
  });
  update([]);
  return { update, select, key, get activeDate() { return activeDate; },
    clearFilter() { activeDate = null; document.querySelector('#clear-calendar-date').hidden = true; },
    reset() { select(key(new Date()), false); },
  };
})();
