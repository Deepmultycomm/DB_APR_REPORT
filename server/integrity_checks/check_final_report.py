import pandas as pd
import sys
import re

def hms_to_seconds(t):
    if isinstance(t, str):
        try:
            h, m, s = map(int, t.split(':'))
            return h * 3600 + m * 60 + s
        except: return 0
    return 0

def run_check(activity_path, report_path):
    try:
        activity_df = pd.read_csv(activity_path)
        report_df = pd.read_csv(report_path)
    except FileNotFoundError as e:
        print(f"Error loading file: {e}")
        sys.exit(1)

    # Extract the date from the report's filename to ensure we compare the correct day
    match = re.search(r'(\d{4}-\d{2}-\d{2})', report_path)
    if not match:
        print(f"CHECK FAILED: Could not determine date from report filename: {report_path}")
        sys.exit(1)
    
    report_date_str = match.group(1)
    report_date = pd.to_datetime(report_date_str).date()
    print(f"Info: Checking against report for date: {report_date}")

    # Filter the master activity log to only include records from the report's date
    activity_df['start_time_dt'] = pd.to_datetime(activity_df['start_time']).dt.date
    activity_for_report_date_df = activity_df[activity_df['start_time_dt'] == report_date].copy()
    
    if activity_for_report_date_df.empty:
        print(f"CHECK FAILED: The 'full_export_agent_activity.csv' contains no data for {report_date}.")
        sys.exit(1)

    # Prepare the activity data for merging
    activity_for_report_date_df['report_hour'] = pd.to_datetime(activity_for_report_date_df['report_hour']).dt.tz_localize(None)

    # --- FIX: Correct the month abbreviation before parsing ---
    try:
        # Replace "Sept" with the standard "Sep" that pandas expects
        report_df['Date_Clean'] = report_df['Date'].str.replace("Sept", "Sep", regex=False)
        
        # Now, create the full datetime string for merging
        datetime_to_parse = report_df['Date_Clean'] + ' ' + report_df['Interval'].str.split(' - ').str[0]
        
        report_df['report_hour_dt'] = pd.to_datetime(
            datetime_to_parse,
            format='%d %b %H:%M'
        )
    except Exception as e:
        print(f"Could not parse dates in report file. Error: {e}")
        sys.exit(1)

    # Merge the two dataframes to find matching records
    merged_df = pd.merge(
        report_df,
        activity_for_report_date_df,
        left_on=['Ext', 'report_hour_dt'],
        right_on=['agent_ext', 'report_hour'],
        how='inner'
    )
    
    if merged_df.empty:
        print("CHECK FAILED: Could not find any matching records between the final report and the agent_activity data.")
        sys.exit(1)

    # Select a sample record to verify
    sample_record = merged_df[merged_df['available_status_secs'] > 0].iloc[0] if not merged_df[merged_df['available_status_secs'] > 0].empty else merged_df.iloc[0]

    agent_ext = sample_record['Ext']
    interval = sample_record['Interval']
    
    print(f"Checking sample: Agent {agent_ext} at {interval}")
    
    failures = []
    
    # Compare key metrics
    for time_col, sec_col in [('Available Time', 'available_status_secs'), ('Logoff Time', 'logoff_secs'), ('Login Time', 'login_secs')]:
        report_secs = hms_to_seconds(sample_record[time_col])
        activity_secs = sample_record[sec_col]
        if report_secs != activity_secs:
            failures.append(f"{time_col} mismatch: Report={report_secs}s, Activity DB={activity_secs}s")

    if not failures:
        print("CHECK PASSED: Final report values correctly match aggregated data.")
    else:
        print("CHECK FAILED:")
        for f in failures:
            print(f"- {f}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python check_final_report.py <activity_path> <report_path>")
        sys.exit(1)
    run_check(sys.argv[1], sys.argv[2])