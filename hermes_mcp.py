"""Ferramentas MCP locais para o Hermes usar a mesma lista do aplicativo."""

from mcp.server.fastmcp import FastMCP

from store import TaskStore


mcp = FastMCP(
    "Lista de tarefas",
    log_level="WARNING",
    instructions=(
        "Gerencie a lista de tarefas local do usuário. "
        "Use os identificadores retornados por listar_tarefas para concluir "
        "ou reabrir uma tarefa."
    ),
)
store = TaskStore()


@mcp.tool()
def listar_tarefas() -> dict:
    """Liste as tarefas, seus identificadores e seus estados de conclusão."""
    return {"tarefas": store.list_tasks()}


@mcp.tool()
def adicionar_tarefa(texto: str) -> dict:
    """Adicione uma tarefa de 1 a 500 caracteres e retorne o registro criado."""
    return store.add_task(texto)


@mcp.tool()
def concluir_tarefa(tarefa_id: str, concluida: bool = True) -> dict:
    """Conclua uma tarefa pelo identificador; use concluida=false para reabrir."""
    return store.set_completed(tarefa_id, concluida)


if __name__ == "__main__":
    # stdout é reservado às mensagens do protocolo MCP.
    mcp.run(transport="stdio")
