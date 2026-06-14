import asyncio
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._active: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the running event loop so paho's thread can schedule coroutines on it."""
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._active.discard(ws)

    async def broadcast(self, message: str) -> None:
        """Send a text message to all connected clients; drop stale connections."""
        dead: set[WebSocket] = set()
        for ws in self._active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        self._active -= dead

    def broadcast_from_thread(self, message: str) -> None:
        """Thread-safe broadcast — called from paho's background thread."""
        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)


manager = ConnectionManager()
