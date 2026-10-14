# Autonomous Supermarket: 60-Day Simulation and Commercial Assurance

**CSE3CWA Assignment 4, Semester 2, 2026**
**Student:** Matthew Elliott, 22453699

A full-stack web application that simulates a small, unstaffed IGA-style supermarket near 
Swanston Street and Melbourne Town Hall for 60 days. A simulated customer world generates
demand, an autonomous rule-based Store Brain runs inventory and replenishment, every
event is stored in SQLite, and the website reports and audits the result. This is a 
fictional educational scenario and is not affiliated with IGA.

**Stack:** React (Vite) . Node.js + Express . SQLite (`better-sqlite3`)

## Quick Start

**Requirements:** Node.js and npm. Developed and tested on Node 23.9.0 (macOS); Node 20 or 22 LTS
should also work. No environment variables are needed.

```bash
npm run install:all     # installs root, server and client dependencies
npm run dev             # starts the API (port 3001) and the website (port 5173)
```

Open **http://localhost:5173**. The site opens on the Submitted Run.

## The database and the Submitted Run

- The SQLite database is **`server/src/db/supermarket.db` and is included in the submitted ZIP.
  It contains the Submitted Run with it's complete history.
  Please do not delete it: the app would recreate an empty database and the Submitted Run would be lost.
- **Submitted Run ID: `RUN-20261012120727-2026`** (seed 2026, 60/60 days).
- The Submitted Run is identified by the `submitted_run_id` row in the `app_settings` table, 
  which is set outside the web app by `npm run mark-submitted -- <RUN-ID>` (run in `server/`).
  The website selects it automatically and labels it "Submitted Run".

  