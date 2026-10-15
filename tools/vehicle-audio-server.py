"""Local capture receiver. Run from an isolated checkout; bind only localhost."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / '.scratch' / 'engine-audio'
DEST.mkdir(parents=True, exist_ok=True)
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        name = self.path.rsplit('/', 1)[-1]
        size = int(self.headers.get('Content-Length', 0))
        if not name.endswith(('.wav', '.json')) or not 0 < size <= 20_000_000:
            self.send_error(400)
            return
        (DEST / name).write_bytes(self.rfile.read(size))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

ThreadingHTTPServer(('127.0.0.1', 8767), Handler).serve_forever()
