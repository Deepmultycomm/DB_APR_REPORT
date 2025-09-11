# Data Integrity Check Suite

This suite contains a set of scripts to programmatically verify the correctness of the ETL process by comparing the raw data exports with the final aggregated reports.

## Setup

1.  **Install Python**: Ensure you have Python 3.6+ installed on your system.
2.  **Install Dependencies**: Navigate to this directory in your terminal and install the required Python libraries.

    ```bash
    pip install -r requirements.txt
    ```

## How to Run

The checks are designed to be run against the CSV files exported by your application. First, run your `exportAllData.js` and `generateReport.js` scripts to get the necessary files.

Then, from within the `integrity_checks` directory, execute the main runner script, providing the paths to the four required CSV files as command-line arguments.

### Usage

```bash
node run_all_checks.js <path_to_agent_activity> <path_to_users_calls> <path_to_agent_events> <path_to_final_report>
Example
If your exported files are in the parent directory:

Bash

node run_all_checks.js ../server/full_export_agent_activity.csv ../server/full_export_users_calls.csv ../server/full_export_agent_events.csv ../server/report_hourly_2025-09-07.csv
The script will run three checks in sequence and report a PASS or FAIL for each.


#### `integrity_checks/requirements.txt`