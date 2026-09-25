import importlib.metadata

try:
    __version__ = importlib.metadata.version("osintgraph")
except importlib.metadata.PackageNotFoundError:
    __version__ = "0.0.0"  # fallback when running from source