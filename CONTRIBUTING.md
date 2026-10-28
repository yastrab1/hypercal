# Contributing

Install Node 22+, run `npm ci`, copy `.env.example` to `.env`, and start with `npm run dev`. Demo mode requires no Google credentials.

Before opening a pull request, run `npm test` and `npm run build`. For Android changes, also run a debug build with Java 21 and Android SDK 36. Describe the behavior changed and any platform testing performed.

Use synthetic calendar fixtures in tests and screenshots. Do not submit personal events, OAuth credentials, tokens, environment files or signing keys. The project uses the MIT license.
