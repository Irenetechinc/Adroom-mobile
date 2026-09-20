# AdRoom video tools

These tools are vendored for the Railway backend and remain isolated from the existing AI and Supabase services.

## Sources

- `video-autopilot-kit`: https://github.com/Hao0321/video-autopilot-kit
- `beat-synced-edit`: https://github.com/ZiadAbdelkarim/beat-synced-edit

Both upstream repositories are MIT licensed. Their original `LICENSE` files are retained beside the source.

## Runtime integration

`run-beat-edit.py` invokes the upstream deterministic stages in order:

1. beat analysis
2. scene tagging
3. edit-decision-list planning
4. FFmpeg rendering

`SmartVideoEditor` invokes this adapter only when an edit job includes `__audioUri`. It then applies AdRoom's existing platform formatting and color pass. Jobs without audio continue through the original FFmpeg path.

The autopilot kit is included as a maintained QA, normalization, and editing-contract reference. Its full desktop/Editkin workflow is not silently run inside the API worker because it expects a project workspace and human review receipts.

## Updating

Review upstream changes and licenses before updating either directory. Verify the adapter with:

```text
python vendor/video-tools/run-beat-edit.py --help
```

The Railway image installs FFmpeg, Python, and `beat-synced-edit/requirements.txt`.
