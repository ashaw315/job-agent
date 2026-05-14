# Job Search Agent

A personal job search agent that scrapes company job boards daily, scores listings against your profile using keyword matching and Claude AI, and sends a morning digest of the best matches.

Built with Next.js 14, Drizzle ORM, Neon (PostgreSQL), and deployed on Vercel.

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd job-agent
npm install
cp .env.example .env.local
```

### 2. Create a Neon database

- Go to [neon.tech](https://neon.tech) and create a project
- Copy the connection string into `DATABASE_URL` in `.env.local`

### 3. Push the schema

```bash
npm run db:push
```

Uses Drizzle Kit to sync the schema to Neon. No manual SQL needed.

### 4. Fill in environment variables

```env
DATABASE_URL=postgresql://...          # From Neon dashboard
ANTHROPIC_API_KEY=sk-ant-...           # From console.anthropic.com (optional for Phase 1)
CRON_SECRET=<openssl rand -hex 32>     # Protects scrape endpoint
NOTIFICATION_EMAIL=you@email.com       # For daily digest (Phase 2)
```

### 5. Seed and scrape

```bash
npm run dev

# Seed companies:
curl -X POST http://localhost:3000/api/seed \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Run first scrape:
curl http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 6. Deploy to Vercel + GitHub Actions

Deploy to Vercel, add env vars, then add `SCRAPE_URL` and `CRON_SECRET` as GitHub repo secrets. The daily workflow runs at 8am ET.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run db:push` | Push schema to Neon |
| `npm run db:studio` | Open Drizzle Studio |
# job-agent
