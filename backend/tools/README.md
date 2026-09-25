# Backend public-profile discovery tools

These are vendored source snapshots for backend-only, public-profile discovery.
They are not imported by the mobile app, are not exposed as downloads, and are
not connected to AdRoom as submodules. Their `.git` directories were removed
after cloning so deployments use the pinned source in this repository.

## Pinned sources

| Adapter | Source | Revision | Interface used |
| --- | --- | --- | --- |
| Maigret | https://github.com/soxoj/maigret.git | `b6642744988e7e6c2d21f75db60ec3093019ba25` | `python -m maigret <username> --json ndjson --no-progressbar` |
| Deepkrak3n | https://github.com/fchr80/deepkrak3n.git | `feaf2605e97d943b4370492b1fbe439fb0172208` | Replacement for unavailable `guilhermelimait/deepkrak3n`; local FastAPI/CLI source is vendored for its public username-search role |
| Helix | https://github.com/thalha-a9/helix.git | `6c99edd469ee55571b0facb9776f2cab4be17011` | `python helix.py -u <username> --format json --output <dir> --no-browser` |
| Osintgraph | https://github.com/XD-MHLOO/Osintgraph.git | `c9bbcabb20604e2db1ae14f5ae7ba91d7938c33a` | `osintgraph discover <username>` only when explicitly enabled and configured |
| J.A.R.V.I.S | https://github.com/affaan-m/JARVIS.git | `4369c34babd21d539c420866da51c7a8365f1c9e` | Optional HTTP adapter to a separately managed `/api/agents/research` endpoint |
| Reddeye Profiler | https://github.com/vicfic18/reddeye-profiler.git | `f8fa527d56de6ee4664377938467eb21dc137311` | Firefox extension only; no server command exists, so backend uses a Reddit public-page fallback |

## Runtime rules

- No tool receives an email address, phone number, access token, cookie, or
  private account credential.
- Maigret and Helix are bounded by the adapter timeout and output limits.
- Osintgraph and J.A.R.V.I.S are opt-in because their upstream projects require
  external account/services; they never run merely because a lead exists.
- The adapter strips sensitive fields before data is passed to the profile
  builder's user-visible profile or to the Psychology Engine.
- The adapter never sends discovery results to an outbound messaging task.

Python dependencies are intentionally not installed by this repository. If a
Railway deployment provides the required runtime and packages, the adapters can
use the tools; otherwise the profile builder records the unavailable tool and
falls back to the existing public web router.