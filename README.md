# ORC Map Editor

A browser-based map editor for drawing rooms, walls, portals, entities, and campaign levels.

## TypeScript Workflow

Install dependencies:

```sh
npm install
```

Typecheck without emitting files:

```sh
npm run typecheck
```

Build the browser app into `dist/`:

```sh
npm run build
```

Run the focused geometry tests:

```sh
npm test
```

Open `dist/index.html` after building. The source files are TypeScript, but the browser loads the compiled JavaScript from `dist/`.
