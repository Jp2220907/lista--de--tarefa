"""Ferramentas MCP locais para o Hermes usar a mesma lista do aplicativo."""

from mcp.server.fastmcp import FastMCP

from cloud import SharedTasks


mcp = FastMCP(
    "Lista de tarefas",
    log_level="WARNING",
    instructions=(
        "Gerencie a lista de tarefas local do usuário. "
        "Use os identificadores retornados por listar_tarefas para concluir "
        "ou reabrir uma tarefa."
    ),
)
store = SharedTasks()


@mcp.tool()
def listar_tarefas() -> dict:
    """Liste as tarefas, seus identificadores e seus estados de conclusão."""
    return {"tarefas": store.list_tasks(), "origem": store.account.status()["mode"]}


@mcp.tool()
def adicionar_tarefa(texto: str, notas: str = "", data_hora: str | None = None) -> dict:
    """Adicione uma tarefa. Data opcional em ISO 8601 com fuso; notas até 5000 caracteres."""
    return store.add_task(texto, notas, data_hora)


@mcp.tool()
def editar_tarefa(tarefa_id: str, texto: str | None = None, notas: str | None = None,
                  data_hora: str | None = None, remover_data: bool = False) -> dict:
    """Edite só os campos informados. Data em ISO 8601 com fuso; remover_data limpa a data."""
    if remover_data and data_hora is not None:
        raise ValueError("Escolha entre definir uma data ou removê-la.")
    changes = {}
    if texto is not None:
        changes["text"] = texto
    if notas is not None:
        changes["notes"] = notas
    if data_hora is not None or remover_data:
        changes["due_at"] = None if remover_data else data_hora
    return store.update_task(tarefa_id, changes)


@mcp.tool()
def concluir_tarefa(tarefa_id: str, concluida: bool = True) -> dict:
    """Conclua uma tarefa pelo identificador; use concluida=false para reabrir."""
    return store.set_completed(tarefa_id, concluida)


if __name__ == "__main__":
    # stdout é reservado às mensagens do protocolo MCP.
    mcp.run(transport="stdio")
