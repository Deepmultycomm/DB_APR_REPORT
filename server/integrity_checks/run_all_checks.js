import { execSync } from 'child_process';
import path from 'path';

const log = (message) => console.log(message);
const logSuccess = (message) => log(`✅ \x1b[32m${message}\x1b[0m`);
const logError = (message) => log(`❌ \x1b[31m${message}\x1b[0m`);
const logInfo = (message) => log(`\n\x1b[34m-- ${message} --\x1b[0m`);

function runCheck(scriptName, args) {
    const scriptPath = path.join(process.cwd(), scriptName);
    
    // Resolve all file paths to be absolute for reliability
    const absoluteArgs = args.map(arg => path.resolve(arg));

    try {
        log(`Executing: python ${scriptName}...`);
        const command = `python "${scriptPath}" ${absoluteArgs.map(arg => `"${arg}"`).join(' ')}`;
        const output = execSync(command, { encoding: 'utf-8' });
        log(output.trim());
        return true;
    } catch (error) {
        logError(`Error executing ${scriptName}:`);
        // Log the actual output from the script's stderr for better debugging
        log(error.stderr || error.stdout || 'No output from script.');
        return false;
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length !== 4) {
        logError("Usage: node run_all_checks.js <path_to_agent_activity> <path_to_users_calls> <path_to_agent_events> <path_to_final_report>");
        process.exit(1);
    }

    const [activityPath, callsPath, eventsPath, reportPath] = args;
    let allPassed = true;

    logInfo('Running Data Integrity Check Suite');

    logInfo('CHECK 1: Final Report vs. Aggregated Data');
    if (!runCheck('check_final_report.py', [activityPath, reportPath])) {
        allPassed = false;
    }

    logInfo('CHECK 2: Call Count Aggregation');
    if (!runCheck('check_call_counts.py', [activityPath, callsPath])) {
        allPassed = false;
    }

    logInfo('CHECK 3: Agent Timeline Reconstruction');
    if (!runCheck('reconstruct_timeline.py', [activityPath, eventsPath])) {
        allPassed = false;
    }

    logInfo('SUMMARY');
    if (allPassed) {
        logSuccess('All data integrity checks passed!');
    } else {
        logError('One or more data integrity checks failed.');
        process.exit(1);
    }
}

main();