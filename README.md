# EAS AI Adoption Dashboard

A web-based dashboard for tracking AI adoption across Ejada's EAS department.

## Features

- **Dashboard** — KPI cards, 6 interactive charts (tasks by practice, time saved, efficiency, AI tools usage, categories, weekly trend)
- **Practice Tracking** — Click into any of 6 practices to see detailed task logs
- **All Tasks** — Filterable/searchable table of all logged AI tasks
- **AI Accomplishments** — Notable wins, POCs, and value-adds with impact details
- **Copilot Access** — GitHub Copilot user management across practices
- **Projects** — Full project portfolio view
- **Excel Upload** — Import fresh data from your .xlsx tracker
- **Excel Export** — Export all data back to Excel format

## Quick Start

1. Open `index.html` in any modern browser
2. Data is pre-loaded from the latest tracker

## Deploy to GitHub Pages

1. Create a new GitHub repo
2. Push these files (`index.html`, `data.js`, `README.md`)
3. Go to Settings > Pages > Deploy from `main` branch
4. Your dashboard will be live at `https://yourusername.github.io/repo-name/`

## Tech Stack (All Free)

- **HTML/CSS/JS** — No framework, no build step
- **Chart.js** — Interactive charts (CDN)
- **SheetJS** — Excel read/write (CDN)
- **Google Fonts (Inter)** — Typography

## Updating Data

- **Upload**: Click "Upload Excel" in the sidebar to import a new tracker
- **Manual**: Use the "+ Log Task" and "+ Add Win" buttons
- **Export**: Click "Export to Excel" to download current data
