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
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS tasks (
                        id TEXT PRIMARY KEY,
                        text TEXT NOT NULL,
                        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
                        created_at TEXT NOT NULL
                    )
                """)
        finally:
            connection.close()

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _task(row):
        return {"id": row["id"], "text": row["text"],
                "completed": bool(row["completed"]), "created_at": row["created_at"]}

    def list_tasks(self):
        connection = self._connect()
        try:
            return [self._task(row) for row in connection.execute(
                "SELECT * FROM tasks ORDER BY created_at, id")]
        finally:
            connection.close()

    def add_task(self, text):
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Escreva uma tarefa antes de adicionar.")
        text = text.strip()
        if len(text) > 500:
            raise ValueError("A tarefa deve ter no máximo 500 caracteres.")
        task = {"id": str(uuid4()), "text": text, "completed": False,
                "created_at": datetime.now(timezone.utc).isoformat()}
        connection = self._connect()
        try:
            with connection:
                connection.execute(
                    "INSERT INTO tasks (id, text, completed, created_at) VALUES (?, ?, ?, ?)",
                    (task["id"], text, 0, task["created_at"]))
            return task
        finally:
            connection.close()

    def set_completed(self, task_id, completed):
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Identificador de tarefa inválido.")
        if type(completed) is not bool:
            raise ValueError("O estado de conclusão deve ser verdadeiro ou falso.")
        connection = self._connect()
        try:
            with connection:
                result = connection.execute(
                    "UPDATE tasks SET completed = ? WHERE id = ?", (int(completed), task_id))
                if result.rowcount == 0:
                    raise KeyError(task_id)
                row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return self._task(row)
        finally:
            connection.close()
