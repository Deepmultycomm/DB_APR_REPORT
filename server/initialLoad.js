import pool from './DB/connection.js';
import { fetchAndMergeData } from "./Collecetions/fetchAPIToMergeData.js";
import { buildAgentActivity } from "./Collecetions/reportDatabase.js";

// --- Main function to perform the initial data load ---
async function runInitialLoad() {
    console.log(" MIGRATION SCRIPT ".padStart(50, "=").padEnd(80, "="));
    console.log("This script will wipe all existing report data and perform a fresh load.");
    console.warn("\n🚨 WARNING: This is a destructive operation and cannot be undone. 🚨\n");

    // A simple prompt to prevent accidental execution
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const answer = await new Promise(resolve => {
        rl.question("Type 'YES' to continue: ", resolve);
    });

    if (answer !== 'YES') {
        console.log("Aborted by user.");
        rl.close();
        process.exit(0);
    }
    rl.close();


    let connection;
    try {
        console.log("\n--- Step 1: Wiping existing data ---");
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Use TRUNCATE for efficiency - it's faster than DELETE for wiping entire tables
        console.log("   - Truncating agent_activity...");
        await connection.execute('SET FOREIGN_KEY_CHECKS = 0;');
        await connection.execute('TRUNCATE TABLE agent_activity;');
        console.log("   - Truncating agent_events...");
        await connection.execute('TRUNCATE TABLE agent_events;');
        console.log("   - Truncating users_calls...");
        await connection.execute('TRUNCATE TABLE users_calls;');
        await connection.execute('SET FOREIGN_KEY_CHECKS = 1;');
        
        await connection.commit();
        console.log("✅ Tables wiped successfully.\n");

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error wiping tables:", error);
        if (connection) connection.release();
        await pool.end();
        process.exit(1); // Exit if wiping fails
    } finally {
        if (connection) connection.release();
    }


    try {
        // --- Step 2: Fetching and loading the last 48 hours of data ---
        const nowSec = Math.floor(Date.now() / 1000);
        const fortyEightHoursAgoSec = nowSec - (48 * 3600);
        const startTime = new Date(fortyEightHoursAgoSec * 1000).toISOString();
        const endTime = new Date(nowSec * 1000).toISOString();

        console.log(`--- Step 2: Fetching data from ${startTime} to ${endTime} ---`);
        await fetchAndMergeData(fortyEightHoursAgoSec, nowSec);
        console.log("✅ Raw data loaded successfully.\n");

        // --- Step 3: Aggregating the raw data into the hourly report ---
        console.log("--- Step 3: Building hourly activity summary ---");
        await buildAgentActivity(fortyEightHoursAgoSec, nowSec);
        console.log("✅ Hourly summary built successfully.\n");
        
        console.log("🎉 Initial data load complete! 🎉");

    } catch (error) {
        console.error("❌ Error during data loading:", error);
    } finally {
        await pool.end();
    }
}

runInitialLoad();