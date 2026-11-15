"""Verifica o protocolo MCP real em subprocessos com banco temporário."""

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class MCPIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="lista-mcp-test-")
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "tasks.sqlite3"

    @asynccontextmanager
    async def session(self):
        parameters = StdioServerParameters(
            command=sys.executable,
            args=[str(PROJECT_ROOT / "hermes_mcp.py")],
            env={**os.environ, "TASKS_DB_PATH": str(self.database)},
        )
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as client:
                await client.initialize()
                yield client

    async def call(self, client, name, arguments=None):
        result = await client.call_tool(name, arguments or {})
        self.assertFalse(result.isError, result.content)
        return json.loads(result.content[0].text)

    async def test_tools_task_lifecycle_and_persistence(self):
        async with self.session() as client:
            tools = await client.list_tools()
            self.assertEqual(
                {tool.name for tool in tools.tools},
                {"listar_tarefas", "adicionar_tarefa", "concluir_tarefa", "editar_tarefa"},
            )
            self.assertEqual(await self.call(client, "listar_tarefas"), {"tarefas": [], "origem": "local"})
            task = await self.call(
                client, "adicionar_tarefa", {"texto": "  Testar integração com Hermes  "}
            )
            self.assertEqual(task["text"], "Testar integração com Hermes")
            self.assertFalse(task["completed"])
            self.assertTrue(task["id"])
            self.assertTrue(task["created_at"])
            listing = await self.call(client, "listar_tarefas")
            self.assertEqual(listing["tarefas"], [task])

            completed = await self.call(
                client, "concluir_tarefa", {"tarefa_id": task["id"]}
            )
            self.assertTrue(completed["completed"])
            self.assertEqual(completed["id"], task["id"])
            reopened = await self.call(
                client,
                "concluir_tarefa",
                {"tarefa_id": task["id"], "concluida": False},
            )
            self.assertFalse(reopened["completed"])
            self.assertEqual(reopened["created_at"], task["created_at"])

        # Um novo processo deve enxergar o que o anterior gravou em disco.
        async with self.session() as client:
            listing = await self.call(client, "listar_tarefas")
            self.assertEqual(listing["tarefas"], [reopened])

    async def test_invalid_requests_do_not_change_tasks(self):
        async with self.session() as client:
            for text in ("", "   ", "x" * 501):
                result = await client.call_tool("adicionar_tarefa", {"texto": text})
                self.assertTrue(result.isError)
            task = await self.call(client, "adicionar_tarefa", {"texto": "Preservar tarefa"})
            for task_id in ("", "id-inexistente"):
                result = await client.call_tool(
                    "concluir_tarefa", {"tarefa_id": task_id}
                )
                self.assertTrue(result.isError)
            result = await client.call_tool(
                "concluir_tarefa",
                {"tarefa_id": task["id"], "concluida": "talvez"},
            )
            self.assertTrue(result.isError)
            listing = await self.call(client, "listar_tarefas")
            self.assertEqual(listing["tarefas"], [task])

    async def test_schedule_and_notes_are_available_to_hermes(self):
        async with self.session() as client:
            task = await self.call(client, "adicionar_tarefa", {
                "texto": "Reunião", "notas": "Revisar projeto", "data_hora": "2026-12-01T09:00:00-03:00"})
            self.assertEqual(task["due_at"], "2026-12-01T12:00:00+00:00")
            edited = await self.call(client, "editar_tarefa", {
                "tarefa_id": task["id"], "texto": "Reunião do projeto", "notas": "Novo detalhe"})
            self.assertEqual(edited["due_at"], task["due_at"])
            self.assertEqual(edited["notes"], "Novo detalhe")
            cleared = await self.call(client, "editar_tarefa", {
                "tarefa_id": task["id"], "remover_data": True})
            self.assertIsNone(cleared["due_at"])
            result = await client.call_tool("editar_tarefa", {
                "tarefa_id": task["id"], "remover_data": True, "data_hora": "2026-12-01T12:00:00Z"})
            self.assertTrue(result.isError)
            self.assertEqual((await self.call(client, "listar_tarefas"))["tarefas"], [cleared])


if __name__ == "__main__":
    unittest.main()
