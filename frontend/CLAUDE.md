# frontend/CLAUDE.md

Notes for the **React web client only**. Repo-wide context is in the root
[`CLAUDE.md`](../CLAUDE.md).

## API host resolution

[`src/api/config.js`](src/api/config.js) resolves the API origin from
`REACT_APP_API_BASE_URL`, defaulting to `""` so requests stay root-relative and
the CRA dev proxy in `package.json` is unchanged. A set value has trailing
slashes stripped, so `https://api.example.com/` and `https://api.example.com`
behave identically.

`process.env.REACT_APP_API_BASE_URL` must be written out in full for CRA's
build-time substitution to find it — **do not destructure `process.env`**.
