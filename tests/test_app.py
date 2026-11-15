import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

from server import make_server
from store import TaskStore


class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temp.name) / "tasks.sqlite3"
        cls.server = make_server(0, cls.path)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        raw = json.dumps(body) if body is not None else None
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        connection.request(method, path, raw, request_headers)
        response = connection.getresponse()
        data = response.read()
        result = (response.status, json.loads(data))
        connection.close()
        return result

    def test_shared_storage_and_completion(self):
        status, data = self.request("POST", "/api/tasks", {"text": "  Comprar pão  "})
        self.assertEqual(status, 201)
        task = data["task"]
        self.assertEqual(task["text"], "Comprar pão")
        self.assertFalse(task["completed"])
        other_client = TaskStore(self.path)
        self.assertIn(task, other_client.list_tasks())
        other_client.set_completed(task["id"], True)
        _, tasks = self.request("GET", "/api/tasks")
        self.assertTrue(next(t for t in tasks["tasks"] if t["id"] == task["id"])["completed"])
        status, data = self.request("PATCH", f"/api/tasks/{task['id']}", {"completed": False})
        self.assertEqual(status, 200)
        self.assertFalse(data["task"]["completed"])

    def test_invalid_tasks_not_saved(self):
        before = TaskStore(self.path).list_tasks()
        for text in ("", "   ", None, 123, "a" * 501):
            with self.subTest(text=repr(text)[:30]):
                self.assertEqual(self.request("POST", "/api/tasks", {"text": text})[0], 400)
        self.assertEqual(before, TaskStore(self.path).list_tasks())

    def test_schedule_edit_and_clear(self):
        status, result = self.request("POST", "/api/tasks", {
            "text": "Consulta", "notes": "Levar exames", "due_at": "2026-12-10T10:00:00-03:00"})
        self.assertEqual(status, 201)
        task = result["task"]
        self.assertEqual(task["due_at"], "2026-12-10T13:00:00+00:00")
        status, result = self.request("PATCH", f"/api/tasks/{task['id']}", {"text": "Consulta médica"})
        self.assertEqual(status, 200)
        self.assertEqual(result["task"]["notes"], "Levar exames")
        self.assertEqual(result["task"]["due_at"], task["due_at"])
        status, result = self.request("PATCH", f"/api/tasks/{task['id']}", {"due_at": None, "notes": ""})
        self.assertEqual(status, 200)
        self.assertIsNone(result["task"]["due_at"])
        self.assertEqual(result["task"]["notes"], "")
        for changes in ({"due_at": "2026-12-10T10:00:00"}, {"due_at": "inválida"}, {"due_at": 3},
                        {"notes": None}, {"notes": "x" * 5001}, {"created_at": "x"}, {}):
            self.assertEqual(self.request("PATCH", f"/api/tasks/{task['id']}", changes)[0], 400)
        self.assertEqual(next(t for t in TaskStore(self.path).list_tasks() if t["id"] == task["id"]), result["task"])

    def test_old_database_migrates_without_losing_tasks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "old.sqlite3"
            connection = sqlite3.connect(path)
            connection.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, completed INTEGER NOT NULL, created_at TEXT NOT NULL)")
            connection.execute("INSERT INTO tasks VALUES ('old', 'Manter tarefa antiga', 1, '2026-01-01')")
            connection.commit()
            connection.close()
            for _ in range(2):
                task = TaskStore(path).list_tasks()[0]
                self.assertEqual(task["text"], "Manter tarefa antiga")
                self.assertTrue(task["completed"])
                self.assertEqual(task["notes"], "")
                self.assertIsNone(task["due_at"])

    def test_invalid_completion_and_missing_task(self):
        self.assertEqual(self.request("PATCH", "/api/tasks/missing", {"completed": True})[0], 404)
        for value in ("false", 1, None):
            self.assertEqual(self.request("PATCH", "/api/tasks/missing", {"completed": value})[0], 400)

    def test_cross_site_requests_are_denied(self):
        self.assertEqual(self.request("POST", "/api/tasks", {"text": "não salvar"},
                                      {"Origin": "https://outro-site.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/tasks", headers={"Host": "outro-site.example"})[0], 403)

    def test_unexpected_fields_and_paths(self):
        self.assertEqual(self.request("POST", "/api/tasks", {"text": "teste", "completed": True})[0], 400)
        self.assertEqual(self.request("GET", "/../store.py")[0], 404)
        self.assertEqual(self.request("GET", "/.data/tasks.sqlite3")[0], 404)

    def test_persistence_after_reopening(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "saved.sqlite3"
            task = TaskStore(path).add_task("Tarefa persistente")
            TaskStore(path).set_completed(task["id"], True)
            tasks = TaskStore(path).list_tasks()
            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0]["text"], "Tarefa persistente")
            self.assertTrue(tasks[0]["completed"])


if __name__ == "__main__":
    unittest.main()
