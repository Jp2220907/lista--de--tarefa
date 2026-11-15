"""Armazenamento local compartilhado pela página e pelas ferramentas do Hermes."""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class TaskStore:
    def __init__(self, db_path=None):
        self.path = Path(db_path or os.environ.get("TASKS_DB_PATH") or
                         Path(__file__).resolve().parent / ".data" / "tasks.sqlite3")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        try:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS tasks (
                        id TEXT PRIMARY KEY,
                        text TEXT NOT NULL,
                        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
                        created_at TEXT NOT NULL
                    )
                """)
                columns = {row[1] for row in connection.execute("PRAGMA table_info(tasks)")}
                if "notes" not in columns:
                    connection.execute("ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
                if "due_at" not in columns:
                    connection.execute("ALTER TABLE tasks ADD COLUMN due_at TEXT")
        finally:
            connection.close()

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _task(row):
        return {"id": row["id"], "text": row["text"],
                "completed": bool(row["completed"]), "created_at": row["created_at"],
                "notes": row["notes"], "due_at": row["due_at"]}

    def list_tasks(self):
        connection = self._connect()
        try:
            return [self._task(row) for row in connection.execute(
                "SELECT * FROM tasks ORDER BY created_at, id")]
        finally:
            connection.close()

    @staticmethod
    def _validate(changes):
        if not isinstance(changes, dict) or not changes or set(changes) - {"text", "notes", "due_at", "completed"}:
            raise ValueError("Informe campos válidos para a tarefa.")
        changes = dict(changes)
        if "text" in changes:
            text = changes["text"]
            if not isinstance(text, str) or not text.strip() or len(text.strip()) > 500:
                raise ValueError("Escreva uma tarefa de 1 a 500 caracteres.")
            changes["text"] = text.strip()
        if "notes" in changes:
            notes = changes["notes"]
            if not isinstance(notes, str) or len(notes) > 5000:
                raise ValueError("As anotações devem ter até 5000 caracteres.")
        if "completed" in changes and type(changes["completed"]) is not bool:
            raise ValueError("O estado de conclusão deve ser verdadeiro ou falso.")
        if changes.get("due_at") is not None:
            try:
                date = datetime.fromisoformat(changes["due_at"].replace("Z", "+00:00"))
                if date.tzinfo is None:
                    raise ValueError()
                changes["due_at"] = date.astimezone(timezone.utc).isoformat()
            except (ValueError, TypeError, AttributeError, OverflowError):
                raise ValueError("Informe uma data e hora válidas com fuso horário.") from None
        return changes

    def add_task(self, text, notes="", due_at=None):
        fields = self._validate({"text": text, "notes": notes, "due_at": due_at})
        task = {"id": str(uuid4()), "text": text, "completed": False,
                "created_at": datetime.now(timezone.utc).isoformat(), **fields}
        connection = self._connect()
        try:
            with connection:
                connection.execute(
                    "INSERT INTO tasks (id, text, completed, created_at, notes, due_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (task["id"], task["text"], 0, task["created_at"], task["notes"], task["due_at"]))
            return task
        finally:
            connection.close()

    def set_completed(self, task_id, completed):
        return self.update_task(task_id, {"completed": completed})

    def update_task(self, task_id, changes):
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Identificador de tarefa inválido.")
        changes = self._validate(changes)
        connection = self._connect()
        try:
            with connection:
                result = connection.execute(
                    "UPDATE tasks SET " + ", ".join(f"{key} = ?" for key in changes) + " WHERE id = ?",
                    (*changes.values(), task_id))
                if result.rowcount == 0:
                    raise KeyError(task_id)
                row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return self._task(row)
        finally:
            connection.close()
