import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from atualizar import FILES, update


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "novo"
        self.target = Path(self.temp.name) / "instalado"
        for root, text in ((self.source, "novo"), (self.target, "original")):
            for name in FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
        db = self.target / ".data" / "tasks.sqlite3"
        db.parent.mkdir()
        connection = sqlite3.connect(db)
        connection.execute("CREATE TABLE tasks (text TEXT)")
        connection.execute("INSERT INTO tasks VALUES ('Preservar minha tarefa')")
        connection.commit()
        connection.close()
        (self.target / ".venv").mkdir()
        (self.target / ".venv" / "preservar.txt").write_text("ambiente existente")

    def test_preview_backup_preservation_and_repeatability(self):
        changed, backup = update(self.source, self.target)
        self.assertEqual(len(changed), len(FILES))
        self.assertIsNone(backup)
        self.assertEqual((self.target / "server.py").read_text(), "original")
        original_db = (self.target / ".data/tasks.sqlite3").read_bytes()
        _, backup = update(self.source, self.target, True)
        self.assertEqual((backup / "server.py").read_text(), "original")
        self.assertEqual((self.target / "server.py").read_text(), "novo")
        self.assertEqual((self.target / ".data/tasks.sqlite3").read_bytes(), original_db)
        self.assertEqual((self.target / ".venv/preservar.txt").read_text(), "ambiente existente")
        connection = sqlite3.connect(backup / ".data/tasks.sqlite3")
        self.assertEqual(connection.execute("SELECT text FROM tasks").fetchone()[0], "Preservar minha tarefa")
        connection.close()
        self.assertEqual(update(self.source, self.target, True), ([], None))

    def test_incomplete_package_does_not_touch_destination(self):
        (self.source / "store.py").unlink()
        with self.assertRaises(ValueError):
            update(self.source, self.target, True)
        self.assertEqual((self.target / "server.py").read_text(), "original")

    def test_copy_failure_restores_previous_files(self):
        import shutil
        original_copy = shutil.copy2
        def fail_copy(source, destination):
            if Path(source) == self.source / "server.py":
                raise OSError("Falha simulada de cópia")
            return original_copy(source, destination)
        with patch("atualizar.shutil.copy2", side_effect=fail_copy):
            with self.assertRaises(OSError):
                update(self.source, self.target, True)
        for name in FILES:
            self.assertEqual((self.target / name).read_text(), "original")


if __name__ == "__main__":
    unittest.main()
