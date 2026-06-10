# Slack AI Agent

An AI-powered Slack agent that automatically analyzes new Slack workspace members using OpenAI and stores insights in PostgreSQL.

## Features

- Detects new Slack members joining the workspace
- Detects members joining Slack channels
- Collects user profile information from Slack
- Uses OpenAI GPT-4 for AI-driven analysis
- Stores analysis results in PostgreSQL
- Sends analysis insights back to Slack
- REST API endpoints for testing and monitoring
- Health check endpoint

---

## Tech Stack

- Node.js
- Express.js
- Slack Bolt SDK
- Slack Web API
- OpenAI GPT-4
- LangChain
- PostgreSQL
- dotenv

---

## Project Structure

```bash
Slack_AI_Agent/
│
├── index.js              # Main application
├── db.js                 # Database operations
├── .env                  # Environment variables
├── package.json
└── node_modules/
```

---

## Installation

### 1. Clone Repository

```bash
git clone <repository-url>
cd Slack_AI_Agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# OpenAI
OPENAI_API_KEY=sk-your-api-key

# PostgreSQL
DATABASE_URL=postgresql://username:password@localhost:5432/slack_ai_agent

# Server
PORT=3000

# Environment
NODE_ENV=development
```

---

## Database Setup

Create a PostgreSQL database:

```sql
CREATE DATABASE slack_ai_agent;
```

The application automatically creates the required table:

```sql
member_analyse
```

with indexes and schema initialization during startup.

---

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

---

## API Endpoints

### Health Check

```http
GET /health
```

Response:

```json
{
  "message": "Healthy",
  "timestamp": "2026-06-10T10:00:00.000Z"
}
```

---

### Test Member Analysis

Available only in development mode.

```http
POST /test/analyze-member
```

Request:

```json
{
  "memberinfo": {
    "name": "John Doe",
    "email": "john@example.com",
    "title": "Software Engineer"
  }
}
```

Response:

```json
{
  "success": true,
  "analysis": {},
  "timestamp": "2026-06-10T10:00:00.000Z"
}
```

---

## Slack Events Supported

### team_join

Triggered when a new member joins the Slack workspace.

### member_joined_channel

Triggered when a member joins a channel.

The application automatically:

1. Fetches user information
2. Performs AI analysis
3. Stores results in PostgreSQL
4. Posts insights back to Slack

---

## Database Schema

### member_analyse

| Column | Type |
|----------|----------|
| id | SERIAL |
| member_id | VARCHAR |
| member_name | VARCHAR |
| member_email | VARCHAR |
| member_title | VARCHAR |
| member_timezone | VARCHAR |
| fit_score | INTEGER |
| insights | JSONB |
| recommendations | JSONB |
| research_data | JSONB |
| analyzed_at | TIMESTAMP |
| sent_to_slack | BOOLEAN |
| sent_to_slack_at | TIMESTAMP |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

---

## Available Scripts

```bash
npm start
```

Runs the application.

```bash
npm run dev
```

Runs with file watching enabled.

---

## Logging

The application includes structured logging:

```text
[INFO] Database Connected Successfully
[INFO] Processing member
[ERROR] Failed To Save Analysis
```

---

## Required Permissions

Your Slack App should have:

### Bot Token Scopes

- users:read
- users:read.email
- channels:read
- chat:write

### Event Subscriptions

- team_join
- member_joined_channel

---

## Future Improvements

- LinkedIn profile enrichment
- Company research integration
- Sentiment analysis
- Analytics dashboard
- Member scoring customization
- Email notifications
- Multi-workspace support

---

## Author

Amit Prajapati

## License

ISC License
