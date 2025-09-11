import { Parser } from 'json2csv';
import fs from 'fs/promises';
import path from 'path';
import pool from './DB/connection.js';

/**
 * A helper function to query a full table and save it as a CSV file.
 * @param {object} dbPool - The MySQL connection pool.
 * @param {string} tableName - The name of the table to export.
 */
async function exportTableToCsv(dbPool, tableName) {
    let connection;
    try {
        console.log(`\n--- Exporting table: ${tableName} ---`);
        connection = await dbPool.getConnection();
        
        const [rows] = await connection.execute(`SELECT * FROM ${tableName};`);

        if (rows.length === 0) {
            console.log(`No data found in ${tableName}. Skipping file creation.`);
            return;
        }

        console.log(`Found ${rows.length} records. Converting to CSV...`);

        // Handle JSON fields which might be stored as strings
        const transformedRows = rows.map(row => {
            const newRow = { ...row };
            for (const key in newRow) {
                if (typeof newRow[key] === 'string' && newRow[key].startsWith('{') && newRow[key].endsWith('}')) {
                    // This is likely a JSON string. json2csv will handle it, but this is a good place for future custom parsing.
                }
            }
            return newRow;
        });

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(transformedRows);

        const fileName = `full_export_${tableName}.csv`;
        const filePath = path.join(process.cwd(), fileName);
        await fs.writeFile(filePath, csv);

        console.log(`✅ Success! Report saved to: ${filePath}`);

    } catch (error) {
        console.error(`❌ Error exporting table ${tableName}:`, error);
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Main function to run the export process for all tables.
 */
async function runFullExport() {
    console.log("Starting full database export to CSV...");
    try {
        await exportTableToCsv(pool, 'agent_activity');
        await exportTableToCsv(pool, 'agent_events');
        await exportTableToCsv(pool, 'users_calls');
        console.log("\n🎉 Full export process complete.");
    } catch (err) {
        console.error("An unexpected error occurred during the export process:", err);
    } finally {
        await pool.end();
        console.log("Database connection pool closed.");
    }
}

runFullExport();