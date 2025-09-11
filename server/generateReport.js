import { Parser } from 'json2csv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs/promises';
import path from 'path';
import pool from './DB/connection.js';

// --- Helper function to format seconds into HH:MM:SS ---
function secondsToHms(d) {
    d = Number(d);
    if (isNaN(d) || d < 0) return "00:00:00";
    const h = Math.floor(d / 3600);
    const m = Math.floor(d % 3600 / 60);
    const s = Math.floor(d % 3600 % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

/**
 * CORE LOGIC
 * This function fetches and transforms the report data.
 */
export async function getReportData(startDate, endDate) {
    console.log(`📊 Fetching report data from ${startDate} to ${endDate}...`);
    let connection;
    try {
        connection = await pool.getConnection();

        const sql = `
            SELECT * FROM agent_activity
            WHERE report_hour >= ? AND report_hour < ?
            ORDER BY report_hour, agent_ext
        `;
        const [rows] = await connection.execute(sql, [startDate, endDate]);

        if (rows.length === 0) {
            console.log("No data found for the specified date range.");
            return [];
        }
        console.log(`Found ${rows.length} records to process.`);

        return rows.map(row => {
            const talk = row.talk_time_secs || 0;
            const hold = row.hold_time_secs || 0;
            const wrap = row.wrap_up_time_secs || 0;
            const answered = row.answered_calls || 0;
            const total = row.total_calls || 0;

            const ahtSeconds = answered > 0 ? (talk + hold + wrap) / answered : 0;
            const answerRate = total > 0 ? ((answered / total) * 100).toFixed(2) + "%" : "0.00%";

            const reportDate = new Date(row.report_hour);
            const startTime = reportDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            reportDate.setHours(reportDate.getHours() + 1);
            const endTime = reportDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

            const interval = `${startTime} - ${endTime}`;
            const date = new Date(row.report_hour).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

            // Safe JSON parse for event_details
            let events = [];
            if (row.event_details) {
                try {
                    events = typeof row.event_details === "string"
                        ? JSON.parse(row.event_details)
                        : row.event_details; // MySQL JSON already returns object
                } catch (err) {
                    console.warn("⚠️ Failed to parse event_details JSON:", err);
                    events = [];
                }
            }

            return {
                Interval: interval,
                Date: date,
                Ext: row.agent_ext,
                Name: row.agent_name,
                "Available Time": secondsToHms(row.available_status_secs),
                "Productive Break": secondsToHms(row.productive_break_secs),
                "Non-Prod. Break": secondsToHms(row.non_prod_break_secs),
                "Login Time": secondsToHms(row.login_secs),
                "Logoff Time": secondsToHms(row.logoff_secs),
                "Idle Time": secondsToHms(row.idle_time_secs),
                "Total Calls": row.total_calls,
                "Answered Calls": answered,
                "Failed Calls": row.failed_calls,
                AHT: secondsToHms(ahtSeconds),
                // "Answer Rate (%)": answerRate,
                "Lunch Time": secondsToHms(row.npt_lunch_secs),
                "Tea/Coffee Break": secondsToHms(row.npt_tea_break_secs),
                "Bio Break": secondsToHms(row.npt_bio_break_secs),
                "Short Break": secondsToHms(row.npt_short_break_secs),
                "Other NPT": secondsToHms(row.npt_other_secs),
                "Meeting Time": secondsToHms(row.pt_meeting_secs),
                "Training Time": secondsToHms(row.pt_training_secs),
                "Chat Time": secondsToHms(row.pt_chat_secs),
                "Tickets Time": secondsToHms(row.pt_tickets_secs),
                "Outbound Time": secondsToHms(row.pt_outbound_secs),
                "Event Details": events
            };
        });

    } finally {
        if (connection) connection.release();
    }
}





// --- Main function to generate the CSV file from the command line ---
async function generateAndSaveReport(startDate, endDate) {
    try {
        const transformedData = await getReportData(startDate, endDate);
        
        if (!transformedData || transformedData.length === 0) {
            return; 
        }

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(transformedData);

        const fileName = `report_hourly_${startDate.split(' ')[0]}.csv`;
        const filePath = path.join(process.cwd(), fileName);
        await fs.writeFile(filePath, csv);

        console.log(`\n✅ Success! Report saved to:\n${filePath}`);

    } catch (error) {
        console.error("❌ Error generating report:", error);
    } finally {
        await pool.end();
    }
}

// --- Command-line interface setup ---
// This part only runs when the file is executed directly
if (process.argv[1] && process.argv[1].endsWith('generateReport.js')) {
    const argv = yargs(hideBin(process.argv))
        .option('startDate', {
            alias: 's',
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
            demandOption: true
        })
        .option('endDate', {
            alias: 'e',
            type: 'string',
            description: 'End date (exclusive) in YYYY-MM-DD format. Defaults to startDate + 1 day.'
        })
        // --- NEW ARGUMENTS ADDED HERE ---
        .option('startTime', {
            type: 'string',
            description: 'Start time in HH:MM:SS format',
            default: '00:00:00'
        })
        .option('endTime', {
            type: 'string',
            description: 'End time in HH:MM:SS format (exclusive)',
            default: '00:00:00'
        })
        .help()
        .argv;

    // --- UPDATED LOGIC TO COMBINE DATE AND TIME ---
    const startDate = `${argv.startDate} ${argv.startTime}`;
    let endDate;

    if (argv.endDate) {
        endDate = `${argv.endDate} ${argv.endTime}`;
    } else {
        const nextDay = new Date(`${argv.startDate}T${argv.startTime}`);
        nextDay.setDate(nextDay.getDate() + 1);
        // Format to 'YYYY-MM-DD HH:MM:SS'
        endDate = `${nextDay.toISOString().slice(0, 10)} ${argv.startTime}`;
    }

    generateAndSaveReport(startDate, endDate);
}