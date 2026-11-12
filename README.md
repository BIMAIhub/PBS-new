# PBS Student Portal

The Pragmatic BIM Solution learning portal includes student and administrator sign-in, course enrollment, the student workspace and public portfolio pages.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Demo account | Email | Password |
| --- | --- | --- |
| Student | student.demo@example.com | DemoStudent2026 |
| Administrator | admin.demo@example.com | DemoAdmin2026 |

Use the matching account type on the sign-in screen. In the student workspace, Ctrl+K or Command+K opens search for pages and tools.

## Build

```sh
npm run lint
npm run build
NODE_ENV=production npm start
```

The app uses Express for its API and Vite for the frontend. The demo store initializes locally. Keep the runtime database and environment variables private. The included sign-in and database endpoints are for demo use. Configure authenticated, role-scoped storage before hosting real student data.

The UI redesign was informed by [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The Instrument typefaces include their licenses in `src/assets`.
