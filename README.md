# Saturn Live

Photoreal Saturn + rings in Three.js (oblate globe, real NASA-based textures, ring shadows on the planet, planet shadow on the rings, backlit ring glow, Milky Way sky, bloom). A cinematic camera loops through 10 angles: wide, ring-skimming, edge-on, backlit, polar top-down, below the ring plane, and more.

GitHub Actions renders it to MP4, saves it to a **GitHub Release**, and streams it as a looping **YouTube Live**.

## Run locally

    npm install
    npm run textures      # downloads the real textures into web/textures
    npm start             # http://localhost:8080  (add ?free=1 to orbit with the mouse)

## One-time setup on GitHub

1. Create a repo and push this folder.
2. YouTube Studio -> **Go live** -> copy the **Stream key**. (Your channel must be enabled for live streaming; YouTube can take up to 24 h to activate it the first time.)
3. Repo -> Settings -> Secrets and variables -> Actions -> new secret **`YOUTUBE_STREAM_KEY`**.
4. Repo -> Settings -> Actions -> General -> Workflow permissions -> **Read and write**.
5. Actions tab -> **Saturn - render, release & YouTube live** -> Run workflow.

## Modes

- `render_only`: render and publish the release video.
- `render_and_stream`: render, publish, then go live on YouTube.
- `stream_only`: re-use an existing release (`release_tag`) and go live without re-rendering.

`restart_when_done` starts a fresh stream job when the 5.5 h job ends, so the live keeps going. Expect a short gap at each restart; YouTube usually reconnects the same broadcast.

## Where are the links?

- **Video URL:** printed in the render job log and in the run summary:
  `https://github.com/<owner>/<repo>/releases/download/<tag>/saturn.mp4` (public repos only; private repos need login).
- **YouTube live URL:** from YouTube Studio -> Content -> Live.

## Notes

- Rendering uses software WebGL (SwiftShader) on the free runner, so it is slow. At 1080p expect roughly seconds per frame; the log prints an ETA. Lower `width`/`height`/`duration` if needed.
- `--require-real-textures` makes the render fail instead of silently using the procedural fallback, so you never stream fake textures by accident.
- The audio is a generated soft ambient drone (YouTube needs an audio track). Replace it with royalty-free music you have rights to.

## Credits (put this in your YouTube description)

Textures: Solar System Scope (https://www.solarsystemscope.com/textures/), CC BY 4.0, based on NASA imagery. Rendered with Three.js.

Suggested title: `LIVE: Saturn in 4K detail - real NASA-based textures, rings & shadows`
