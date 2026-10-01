# Loaded via PYTHONPATH=tests/netguard: tests must never touch the network.
import socket

_connect = socket.socket.connect


def _guarded(self, address):
    host = address[0] if isinstance(address, tuple) else address
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise OSError(f"netguard: network access blocked in tests ({host})")
    return _connect(self, address)


socket.socket.connect = _guarded
