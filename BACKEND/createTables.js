const db = require("./db");

async function createTables() {
    try {
        console.log("Creating database tables...");

        // USERS TABLE
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                aadhaar VARCHAR(20),
                dob DATE,
                mobile VARCHAR(15),
                mobile_verified BOOLEAN DEFAULT FALSE,
                face_descriptor JSONB,
                voted BOOLEAN DEFAULT FALSE
            )
        `);

        console.log("Users table checked.");

        // Add missing columns if the table already exists
        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS aadhaar VARCHAR(20)
        `);

        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS dob DATE
        `);

        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS mobile VARCHAR(15)
        `);

        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN DEFAULT FALSE
        `);

        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS face_descriptor JSONB
        `);

        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS voted BOOLEAN DEFAULT FALSE
        `);

        console.log("Users columns checked.");

        // VOTES TABLE
        await db.query(`
            CREATE TABLE IF NOT EXISTS votes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                party_name VARCHAR(100) NOT NULL
            )
        `);

        console.log("Votes table checked.");
        console.log("Database setup completed successfully.");

    } catch (error) {
        console.error("Database setup error:");
        console.error(error);
    } finally {
        await db.end();
    }
}

createTables();