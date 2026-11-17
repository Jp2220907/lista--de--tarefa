"""Atualiza uma instalação existente sem mover seu banco, ambiente ou conexão MCP."""
import argparse
import shutil
import sqlite3
import tempfile
from pathlib import Path


FILES = (
    "README.md", "requirements.txt", "store.py", "server.py", "hermes_mcp.py",
    "abrir_app.py", "INICIAR_WINDOWS.bat", "static/index.html", "static/app.js",
    "static/styles.css", "tests/test_app.py", "tests/test_mcp.py",
    "atualizar.py", "tests/test_update.py", "cloud.py", "tests/test_cloud.py",
    "tests/fake_supabase.py", "static/cloud-config.json", "static/connection.js",
    "static/account-ui.js", "static/vendor/supabase.js", "static/manifest.webmanifest",
    "static/sw.js", "static/icons/icon-192.png", "static/icons/icon-512.png", "static/_headers",
    "supabase/LOGIN_E_SINCRONIZACAO.md", "SINCRONIZAR_COM_HERMES.txt",
    "static/recuperar-senha.html", "static/recovery.js",
    "static/calendar.js", "static/notifications.js", "static/push-state.js",
    "supabase/02_notificacoes.sql", "supabase/03_agendamento_notificacoes.sql",
    "supabase/ATIVAR_NOTIFICACOES.md", "supabase/config.toml",
    "supabase/functions/task-reminders/index.ts",
    "supabase/functions/_shared/push-worker.mjs", "scripts/notification-keys.mjs",
    "package.json", "package-lock.json", ".gitignore", ".vercelignore",
    "tests/push-worker.test.mjs", "tests/notification-sql.test.mjs",
    "tests/browser_calendar.py", "tests/browser_notifications.py", "tests/browser_recovery.py",
)


def update(source, destination, apply=False):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Extraia a atualização em uma pasta separada da instalação atual.")
    for name in ("server.py", "store.py", "hermes_mcp.py"):
        if not (destination / name).is_file():
            raise ValueError("Destino inválido: escolha a pasta do protótipo já instalado.")
    for name in FILES:
        if not (source / name).is_file():
            raise ValueError(f"O pacote está incompleto: {name}")
        target = destination / name
        if not target.resolve().is_relative_to(destination):
            raise ValueError(f"Caminho externo não será alterado: {name}")
        if target.exists() and not target.is_file():
            raise ValueError(f"Era esperado um arquivo: {name}")
    database = destination / ".data" / "tasks.sqlite3"
    if database.exists() and not database.resolve().is_relative_to(destination):
        raise ValueError("Banco externo detectado. Faça uma atualização assistida com backup desse banco.")
    changed = [name for name in FILES if not (destination / name).exists()
               or (source / name).read_bytes() != (destination / name).read_bytes()]
    if not apply or not changed:
        return changed, None

    # Não altera o banco. A migração ocorrerá na próxima abertura do aplicativo.
    backup = Path(tempfile.mkdtemp(prefix=destination.name + "-backup-", dir=destination.parent))
    existed = set()
    for name in changed:
        target = destination / name
        if target.exists():
            existed.add(name)
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
    if database.exists():
        saved_db = backup / ".data" / "tasks.sqlite3"
        saved_db.parent.mkdir(parents=True, exist_ok=True)
        original = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
        saved = sqlite3.connect(saved_db)
        try:
            original.backup(saved)
            if saved.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("O backup do banco não passou na verificação; atualização cancelada.")
        finally:
            original.close()
            saved.close()
    (backup / "LEIA-ME.txt").write_text(
        "Backup anterior à atualização. Os arquivos aqui são os que foram substituídos.\n"
        "A pasta .data contém o backup do banco quando ele existia no caminho padrão.\n"
        "Para restaurar, encerre servidor e conexão MCP e copie os arquivos de volta.\n"
        "Restaurar o banco descarta alterações feitas depois deste backup.\n", encoding="utf-8")
    copied = []
    try:
        for name in changed:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            copied.append(name)
            shutil.copy2(source / name, target)
    except OSError:
        for name in reversed(copied):
            if name in existed:
                shutil.copy2(backup / name, destination / name)
            else:
                (destination / name).unlink(missing_ok=True)
        raise
    return changed, backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destino", required=True, help="Pasta onde a lista já funciona")
    parser.add_argument("--aplicar", action="store_true", help="Cria backup e aplica. Sem esta opção, apenas mostra a previsão.")
    args = parser.parse_args()
    try:
        changes, backup = update(Path(__file__).resolve().parent, args.destino, args.aplicar)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"Atualização não concluída: {error}\n")
    if not changes:
        print("A instalação já contém estes arquivos. Nada foi alterado.")
    elif backup:
        print(f"Atualização aplicada. Backup: {backup}")
        print("Banco e configuração do Hermes preservados. Reinicie o servidor e recarregue a conexão MCP.")
    else:
        print("Previsão: nenhum arquivo foi alterado.")
        print("\n".join(changes))
        print("Antes de usar --aplicar, encerre o servidor da lista e desconecte seu MCP.")
        print("Se usa TASKS_DB_PATH, faça antes um backup do banco externo efetivamente utilizado.")


if __name__ == "__main__":
    main()
