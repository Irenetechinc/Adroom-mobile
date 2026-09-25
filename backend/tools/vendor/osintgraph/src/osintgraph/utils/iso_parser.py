from datetime import datetime, timezone

def safe_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Assume naive datetime is UTC if you trust the source
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
