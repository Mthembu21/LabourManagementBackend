# Epiroc Workshop Management - Backend

MongoDB backend with clean architecture for easy SQL Server migration.

## Quick Start

1. Install MongoDB
2. Clone repository
3. Setup backend:

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
```

4. Backend runs on http://localhost:5000

## Migrating to SQL Server

When ready:
1. Install: `npm install mssql sequelize`
2. Replace models with Sequelize models
3. Update config/database.js
4. API endpoints stay the same!

## Architecture

- **Clean separation**: Business logic independent of database
- **Easy migration**: Swap MongoDB for SQL Server without changing frontend
- **RESTful API**: Standard endpoints work with any database