# Kõneväli

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bf16f273-253f-4b0c-889e-9a0e62fad9ce).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Real recordings

Recordings of real people, what they said (replays, transcripts), truth tables and voice prints (rosters) are personal data. They are kept **outside the repository**, in a data folder: `$KONEVALI_DATA_DIR`, by default `~/konevali-data`. Nothing of the kind is committed, built into the site or deployed.

- `python tools/make-replay.py meeting.wav …` writes `<data folder>/replay/meeting.json`; `npm run dev` serves it at `/replay/meeting.json`, so `/vali?replay=meeting` plays it. This works in development only.
- The only replay in the repository is the hand-written `public/replay/sample.json` (`/vali?replay=sample`).
- `npm run build` fails if `public/` holds anything else in `replay/`, audio, tables, models, truth tables or rosters, and removes stale copies from `.output/public/replay`. `npm test` checks the same (`src/test/public-data.test.ts`).
- `tools/make-roster.py` writes rosters to `<data folder>/rosters/` by default.
