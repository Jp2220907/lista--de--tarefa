import http.client
import json
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
