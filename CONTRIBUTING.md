# Contributing

Issues and focused pull requests are welcome. Keep new checks deterministic where possible, label their evidence level, and include a fixture-backed test.

```bash
npm install
npm run check
```

Do not add live provider calls to CI. A new mutating tool must require an explicit user action and must not deploy, publish, or contact third parties by default.
