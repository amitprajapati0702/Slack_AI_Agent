import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

// Connection Events
pool.on('connect', () => {
    console.log('[INFO] Database Connected Successfully');
});

pool.on('error', (error) => {
    console.error('[ERROR] Unexpected Database Error:', error.message);
});

// Initialize Database
export async function initDatabase() {
    const client = await pool.connect();

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS member_analyse (
                id SERIAL PRIMARY KEY,
                member_id VARCHAR(255),
                member_name VARCHAR(255) NOT NULL,
                member_email VARCHAR(255),
                member_title VARCHAR(255),
                member_timezone VARCHAR(100),
                fit_score INTEGER NOT NULL,
                insights JSONB,
                recommendations JSONB,
                research_data JSONB,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_to_slack BOOLEAN DEFAULT FALSE,
                sent_to_slack_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_member_id
            ON member_analyse(member_id);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_analyzed_at
            ON member_analyse(analyzed_at);
        `);

        console.log('[INFO] Database Schema Initialized Successfully');

    } catch (error) {
        console.error('[ERROR] Database Initialization Failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Save Member Analysis
export async function saveMemberAnalysis(
    memberInfo,
    analysis,
    researchData
) {
    const client = await pool.connect();

    try {
        const result = await client.query(
            `
            INSERT INTO member_analyse (
                member_id,
                member_name,
                member_email,
                member_title,
                member_timezone,
                fit_score,
                insights,
                recommendations,
                research_data
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id;
            `,
            [
                memberInfo.id || null,
                memberInfo.name,
                memberInfo.email || null,
                memberInfo.title || null,
                memberInfo.timezone || null,
                analysis.fitScore,
                JSON.stringify(analysis.insights || []),
                JSON.stringify(analysis.recommendations || []),
                JSON.stringify(researchData || {})
            ]
        );

        console.log('[INFO] Analysis Saved Successfully');

        return result.rows[0].id;

    } catch (error) {
        console.error('[ERROR] Failed To Save Analysis:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Mark Analysis As Sent To Slack
export async function markAsSentToSlack(analysisId) {
    const client = await pool.connect();

    try {
        await client.query(
            `
            UPDATE member_analyse
            SET
                sent_to_slack = TRUE,
                sent_to_slack_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            `,
            [analysisId]
        );

        console.log(
            `[INFO] Analysis ${analysisId} marked as sent to Slack`
        );

    } catch (error) {
        console.error(
            '[ERROR] Failed To Update Slack Status:',
            error.message
        );
        throw error;
    } finally {
        client.release();
    }
}

// Close Database Connection
export async function closeDatabase() {
    await pool.end();
    console.log('[INFO] Database Connection Pool Closed');
}

export default pool;