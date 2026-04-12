# 2026 NFL Draft Board

A high-performance, professional-grade visual board designed for tracking the 2026 NFL Draft. Originally built for the Kansas City Chiefs, the application is fully data-driven and can be configured for any team or draft board preference.

![Draft Board Preview](board.png)

## Key Features

- **Dynamic Positional Board**: Visual 2D grid of players organized by positional columns and draft round horizontal slices.
- **Configurable Layout**: Fully customizable column order (QB, RB, WR...) via `public/columns.txt`.
- **Intelligent Search**: Real-time filtering by **Player Name** or **Position** in the Left Panel.
- **Draft Unranked Players**: Manually draft players missing from the big board using the "Draft Unranked" modal.
- **Session Persistence (CSV)**: Save and restore your full draft state (including trades and pick history) using human-readable CSV files.
- **High-Quality Export**: Generate professional 15.6MP JPEG snapshots of your board for sharing and analysis.
### Live Sync
The application is prepared to support real-time synchronization by polling live draft data to automatically update the board as selections are made.

⚠️ **Disclaimer**: The current implementation is provided strictly for experimental and educational purposes. It may rely on publicly accessible, unofficial data sources and is not guaranteed to be accurate, stable, or compliant with third-party terms.

**Use at your own risk.** Users are responsible for ensuring compliance with applicable laws and terms. The authors assume no liability for any misuse or resulting damages.

## Usage

### Browser Operations
1. **Search & Draft**: Use the search bar in the Left Panel to find players by name/position. **Click any player card in the rankings or on the board to draft.**
2. **Custom Draft**: Click "Draft Unranked Player" at the bottom of the Left Panel to enter players manually.
3. **Session Management**: Use the **Save Session** and **Load Session** buttons at the bottom of the Right Panel to persist mock drafts as CSV files.
4. **Export Board**: Click **Export JPEG** in the Top Panel to download a high-resolution image of the central board.
5. **Update Picks**: Modify your team's owned picks via the "Update Picks" modal (Gold highlights).
6. **Undo**: Use the "Undo" button to revert the last drafting action.

## Disclaimers & Legal Information

### URL Parameters
- **Rankings Override**: Load a custom CSV by adding `?rankings=https://your-url.com/rankings.csv` to the URL.
  - *Note: External URLs must support CORS.*

## Data Formatting

The application is driven by three primary files in the `/public` directory:

### 1. `rankings.csv`
Defines the player pool and board layout.
- **Format**: `group,name,position`
- **Group Optionality**: The `group` field is only required for the *first* player in a new board row. Subsequent rows with empty group values will automatically inherit the last seen group.
- **Vertical Grouping**: The `group` value (e.g., `1.1`, `1.2`) creates a horizontal slice across the entire board, allowing you to group players by round or specific draft tier.

#### Creating Rankings with Excel
1. Open Excel and create three columns: `group`, `name`, and `position`.
2. Enter your player data. Use the `group` column sparingly to create row breaks.
3. Click **File > Save As**.
4. Choose **CSV (Comma delimited) (*.csv)** as the file format.
5. Save the file as `rankings.csv` and place it in the `public/` folder of the project.

### 2. `picks.txt`
A simple list of pick numbers owned by your team.
- **Format**: Comma-separated integers.
- **Example**: `32, 64, 95, 126`

### 3. `columns.txt`
Defines the order of positional columns from left to right.
- **Format**: Comma-separated list of positions.
- **Example**: `QB, RB, WR, TE, OT, IOL, EDGE, DL, LB, CB, S`

## Setup & Development

### Local Installation
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Live Sync Modularity
The application features a robust discovery system. If the `src/services/` directory (containing synchronization logic) is missing, the "Live Sync" functionality will gracefully disable itself in the UI without affecting the core board experience.
