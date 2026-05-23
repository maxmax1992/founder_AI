# Sprint Buddy - Founder OS

Sprint Buddy is an AI companion designed for Aalto Founder Sprint participants. It provides real-time guidance grounded in operator experience, daily check-ins, and founder profiling.

## Quick Start (Local Run)

From your terminal, run the following to get the web app and tools ready:

### 1. Web Application
```bash
# Install dependencies
bun install

# Setup environment variables
cp .env.example .env

# Run development server
bun dev --port 3001
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

### 2. Knowledge Base Tools (Python)
The project uses `graphify` and `wiki_sources.py` to manage the advisor's knowledge base.

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install graphify (package name: graphifyy)
pip install graphifyy

# Manage sources (example: list sources)
python3 tools/wiki_sources.py list

# Refresh the knowledge graph/wiki
make sources-graphify
```

## Prerequisites
- [Bun](https://bun.sh/) (Runtime & Package Manager)
- Python 3.10+
- [Codex CLI](https://github.com/reinhardt/codex-cli) (Default AI provider)

## Project Structure
- `src/`: Next.js frontend and API routes.
- `sources/`: Raw source materials for advisors.
- `wiki/`: LLM-curated knowledge base.
- `tools/`: Utility scripts for source management.
- `data/`: (Local only) Stores advisor brains and application state.

## Environment Variables
Edit your `.env` file to switch AI providers:
- `AI_PROVIDER=codex-cli` (Default, uses local Codex App Server)
- `AI_PROVIDER=openai` (Requires `OPENAI_API_KEY`)
