"""
Fractal Explorer – Python/Flask REST backend.
Serves the static frontend and provides persistence endpoints for
fractal configs and custom palettes stored as plain JSON files.

Endpoints
---------
GET  /                              -> index.html
GET  /api/fractals                  -> list saved fractal names
GET  /api/fractals/<name>           -> load fractal config
POST /api/fractals/<name>           -> save fractal config (JSON body)
DELETE /api/fractals/<name>         -> delete fractal config

GET  /api/palettes                  -> list saved palette names
GET  /api/palettes/<name>           -> load palette
POST /api/palettes/<name>           -> save palette (JSON body)
DELETE /api/palettes/<name>         -> delete palette
"""

from flask import Flask, jsonify, request, send_from_directory, abort
import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRACTALS_DIR = os.path.join(BASE_DIR, "fractals")
PALETTES_DIR = os.path.join(BASE_DIR, "palettes")

os.makedirs(FRACTALS_DIR, exist_ok=True)
os.makedirs(PALETTES_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static", static_url_path="")

_SAFE_NAME = re.compile(r"^[\w\- ]{1,64}$")


def _safe(name: str) -> bool:
    return bool(_SAFE_NAME.match(name))


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ---------------------------------------------------------------------------
# Fractals
# ---------------------------------------------------------------------------

@app.route("/api/fractals", methods=["GET"])
def list_fractals():
    names = sorted(
        f[:-5] for f in os.listdir(FRACTALS_DIR) if f.endswith(".json")
    )
    return jsonify(names)


@app.route("/api/fractals/<string:name>", methods=["GET"])
def get_fractal(name):
    if not _safe(name):
        abort(400)
    path = os.path.join(FRACTALS_DIR, name + ".json")
    if not os.path.exists(path):
        abort(404)
    with open(path, "r", encoding="utf-8") as fh:
        return jsonify(json.load(fh))


@app.route("/api/fractals/<string:name>", methods=["POST"])
def save_fractal(name):
    if not _safe(name):
        abort(400)
    data = request.get_json(silent=True)
    if data is None:
        abort(400)
    path = os.path.join(FRACTALS_DIR, name + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    return jsonify({"status": "ok"})


@app.route("/api/fractals/<string:name>", methods=["DELETE"])
def delete_fractal(name):
    if not _safe(name):
        abort(400)
    path = os.path.join(FRACTALS_DIR, name + ".json")
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Palettes
# ---------------------------------------------------------------------------

@app.route("/api/palettes", methods=["GET"])
def list_palettes():
    names = sorted(
        f[:-5] for f in os.listdir(PALETTES_DIR) if f.endswith(".json")
    )
    return jsonify(names)


@app.route("/api/palettes/<string:name>", methods=["GET"])
def get_palette(name):
    if not _safe(name):
        abort(400)
    path = os.path.join(PALETTES_DIR, name + ".json")
    if not os.path.exists(path):
        abort(404)
    with open(path, "r", encoding="utf-8") as fh:
        return jsonify(json.load(fh))


@app.route("/api/palettes/<string:name>", methods=["POST"])
def save_palette(name):
    if not _safe(name):
        abort(400)
    data = request.get_json(silent=True)
    if data is None:
        abort(400)
    path = os.path.join(PALETTES_DIR, name + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    return jsonify({"status": "ok"})


@app.route("/api/palettes/<string:name>", methods=["DELETE"])
def delete_palette(name):
    if not _safe(name):
        abort(400)
    path = os.path.join(PALETTES_DIR, name + ".json")
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, port=5000)
