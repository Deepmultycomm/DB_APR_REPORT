Agent Performance Report (APR) Backend Service
This is a Node.js backend service designed to automatically fetch, process, and store agent activity data for generating performance reports. It functions as a resilient ETL (Extract, Transform, Load) pipeline that runs on a schedule, populating a MySQL database with aggregated data ready for analysis and on-demand CSV export.

The system is composed of three main parts:

Automated Data Collector (index.js): A 24/7 service that continuously fetches the latest data from multiple API endpoints every 10 minutes.

Report Generator (generateReport.js & API): Provides two methods for generating detailed CSV reports: a manual command-line script and an on-demand REST API endpoint.

Initial Data Loader (initialLoad.js): A one-time script to populate the database with a large historical dataset (e.g., the last 48 hours).

Core Features 📋
Automated Data Ingestion: A scheduler runs every 10 minutes to fetch the latest agent status and event data.

On-Demand Reporting API: A REST API endpoint (/api/report) allows for generating and downloading reports directly via HTTP requests with granular date and time parameters.

Two-Stage ETL Process:

Stage 1 (Extract & Load): Fetches raw data and stores it in staging tables (agent_events, users_calls).

Stage 2 (Transform): Aggregates the raw data into a clean, hourly summary table (agent_activity) based on specific business rules.

Robust Data Integrity: All time-based calculations (Available Time, Idle Time, Break Times, etc.) are derived from a single source of truth (the agent_events timeline). This prevents data conflicts and double-counting between different source APIs.

Resilient & Future-Proof:

Includes a robust retry mechanism with exponential backoff to handle temporary API failures.

Gracefully handles and categorizes unknown or new agent break states into an "Other" bucket, ensuring no time is ever lost from totals.

Data Sanitization: Agent names are automatically cleaned of URL-encoded characters (+, %0A, etc.) before being stored in the database.

Secure Configuration: All secrets and credentials are managed in a .env file and are not part of version control.

Project Structure 📂
server/
├── index.js                  # Main server entry point, scheduler, and API routes.
├── generateReport.js         # Standalone script and reusable module for generating CSV reports.
├── initialLoad.js            # Standalone script for one-time bulk data loading.
├── package.json              # Project dependencies and scripts.
├── tokenService.js           # Handles API authentication and token caching.
├── .env.example              # Template for environment variables.
├── apr_report.sql            # SQL script to create all necessary database tables.
|
├── Collecetions/
│   ├── fetchAPIToMergeData.js # Stage 1: Fetches API data and loads into raw staging tables.
│   └── reportDatabase.js      # Stage 2: Aggregates raw data into the final summary table.
|
├── controller/
│   └── cdrController.js       # Express controllers for the API endpoints.
|
├── DB/
│   └── connection.js          # MySQL database connection setup.
|
└── ssl/
    ├── cert.pem               # SSL certificate files.
    └── ...
Installation & Setup ⚙️
1. Clone the Repository
Bash

git clone <your-repository-url>
cd server
2. Install Dependencies
Bash

npm install
3. Set Up the Database
Execute the apr_report.sql file in your MySQL instance. This will create the database and all necessary tables.

Bash

mysql -u your_user -p your_database_name < apr_report.sql
4. Configure Environment Variables
Copy the example environment file to a new .env file.

Bash

cp .env.example .env
Now, edit the .env file and fill in your actual credentials for API_PASSWORD and DB_PASSWORD.

Running the Application ▶️
Step 1: Initial Data Load (One-Time Task)
To populate your database with historical data, run the initialLoad.js script. This will wipe the tables and fetch the last 48 hours of data.

Bash

node initialLoad.js
You will be asked to confirm the action by typing YES.

Step 2: Start the Automated Data Collector
Once the initial load is complete, start the main server. It will automatically fetch new data every 10 minutes and make the report API available.

Bash

npm start
Generating Reports 📊
You can generate a CSV report using two methods.

Method 1: Using the REST API (On-Demand)
This is the recommended method for getting reports as it can be accessed from any authorized client.

Endpoint: GET /api/report

Query Parameters:

startDate (Required): The start date of the report in YYYY-MM-DD format.

endDate (Optional): The end date (exclusive) in YYYY-MM-DD format. If omitted, the report runs for a full 24-hour period.

startTime (Optional): The start time in HH:MM:SS format. Defaults to 00:00:00.

endTime (Optional): The end time in HH:MM:SS format. Defaults to 00:00:00.

Examples:

Bash

# Get a report for a single full day (Sept 7th) and save it to a file
curl -k -o daily_report.csv "https://localhost:6699/api/report?startDate=2025-09-07"

# Get a report for a specific time range on a single day (9 AM to 5 PM)
curl -k -o business_hours_report.csv "https://localhost:6699/api/report?startDate=2025-09-07&endDate=2025-09-07&startTime=09:00:00&endTime=17:00:00"

# Get a 24-hour report starting from a custom time (Sept 7th at 9 AM to Sept 8th at 9 AM)
curl -k -o custom_24hr_report.csv "https://localhost:6699/api/report?startDate=2025-09-07&startTime=09:00:00"
Method 2: Using the Command-Line Script (Manual)
This method is useful for generating a report directly on the server. Open a new terminal window (do not stop the server) and run the script.

Examples:

Bash

# For a single full day
node generateReport.js --startDate=2025-09-07

# For a multi-day range
node generateReport.js --startDate=2025-09-07 --endDate=2025-09-10

# For a specific time range on a single day (9 AM to 5 PM)
node generateReport.js --startDate=2025-09-07 --endDate=2025-09-07 --startTime=09:00:00 --endTime=17:00:00
Data Processing Logic
To ensure data accuracy and prevent integrity issues, this application adheres to a "single source of truth" principle for its calculations:

Time Durations: All time-based metrics (Available Time, Idle Time, all Break times, Login/Logoff, etc.) are calculated exclusively by analyzing the high-resolution event stream stored in the agent_events table. This prevents double-counting and inconsistencies that can arise from merging different data sources.

Call Counts: Aggregate metrics like Total Calls and Answered Calls are taken from the summary data stored in the users_calls table, which is the authoritative source for these numbers.

Reporting Structure
The generated CSV report provides a comprehensive hourly breakdown of each agent's activity.

Column Name	Description
Interval Info	
Interval	The 1-hour window for the summarized data (e.g., "18:00 - 19:00").
Date	The date of the report in DD-Mon format (e.g., "07-Sep").
Start Time	The full start date and time for the raw data window (DD/MM/YYYY, HH:MM:SS).
End Time	The full end date and time for the raw data window (DD/MM/YYYY, HH:MM:SS).

Agent Info	
Ext	Agent's extension number.
Name	Agent's full name (sanitized and cleaned).
Time Breakdowns (HH:MM:SS)	
Available Time	Total time the agent was in a state to handle calls (Idle, On Call, Wrap Up, Hold).
Productive Break	Total time spent on productive tasks (Meeting, Training, Chat, Tickets, Outbound).
Non-Prod. Break	Total time spent on non-productive breaks (Lunch, Tea, Bio, Short breaks, and Other).
Login Time	Total time spent in the explicit "Login" state.
Logoff Time	Total time spent in the explicit "Logoff" state.
Idle Time	Total time the agent was logged in and waiting for a call.

Call Metrics	
Total Calls	Total calls presented to the agent in the interval.
Answered Calls	Number of calls the agent answered.
Failed Calls	Calculated as Total Calls - Answered Calls.

Performance KPIs	
AHT	Average Handle Time: (Talk + Hold + Wrap Up) / Answered Calls.
Answer Rate (%)	The percentage of calls offered that were answered.
Non-Productive Breakdowns (HH:MM:SS)	
Lunch Time	Time spent on 'Lunch' or 'Lunch Break'.
Tea/Coffee Break	Time spent on 'Tea Break'.
Bio Break	Time spent on 'Bio Break'.
Short Break	Time spent on 'Short Break'.
Other NPT	Time in any other generic or unrecognized 'Not Available' state.
Productive Breakdowns (HH:MM:SS)	
Meeting Time	Time spent in a 'Meeting' state.
Training Time	Time spent in a 'Training' state.
Chat Time	Time spent in a 'Chat' state.
Tickets Time	Time spent working on tickets.
Outbound Time	Time spent in an 'Outbound' call state.