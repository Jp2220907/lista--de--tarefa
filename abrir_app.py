"""Abre a lista local no navegador, sem depender do Hermes ou de pacotes externos."""
import webbrowser

from server import make_server


def main():
    try:
        server = make_server()
    except OSError:
        print("Não foi possível abrir a porta 8765. Verifique se a lista já está aberta.")
        return 1
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Lista iniciada: {url}\nMantenha esta janela aberta. Ctrl+C encerra o aplicativo.", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
