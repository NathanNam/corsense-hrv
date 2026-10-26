# Legacy Newton experiments (session-based Lens API)

These March 2026 scripts used Archetype AI's older, session-based API
(`https://api.u1.archetypeai.app/v0.5`: lens sessions, file uploads, SSE):

| Script | What it tried |
|---|---|
| `newton_experiment.py` | Collect RR from a CorSense over BLE, run the LightGBM model, then ask Newton about it |
| `test_activity_monitor.py`, `test_activity_monitor_video.py` | Activity Monitor lens on CSV data and on chart screenshots turned into video |
| `test_sensor_stream.py` | Machine State lens streaming classification |
| `extract_focus_csv.py` | Built the WESAD relaxed/stressed RR files used as Newton's examples (now `web/public/demo/wesad-session.json`) |

They're kept for reference. The web app now uses the stateless
`/api/lens/query` endpoint on `https://platform.u1.archetypeai.app`:
the Newton C 2.6 fusion model for questions, and the Newton Omega encoder with
n-shot KNN for its stress reading. See `web/lib/atai.ts` and
`web/lib/omega-knn.ts`, and Archetype AI's `atai-newton-fusion-model` and
`atai-newton-omega-model` agent skills.
