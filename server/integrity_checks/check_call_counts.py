import pandas as pd
import sys

def run_check(activity_path, calls_path):
    activity_df = pd.read_csv(activity_path)
    calls_df = pd.read_csv(calls_path)

    activity_df['report_hour'] = pd.to_datetime(activity_df['report_hour'])
    calls_df['start_timestamp'] = pd.to_datetime(calls_df['start_timestamp'])
    
    # --- Select a sample agent and day ---
    agent_ext = 3139
    check_date = pd.to_datetime('2025-09-07').date()

    print(f"Checking call counts for Agent {agent_ext} on {check_date}")

    # Sum from agent_activity
    activity_day_data = activity_df[
        (activity_df['agent_ext'] == agent_ext) &
        (activity_df['report_hour'].dt.date == check_date)
    ]
    activity_total = activity_day_data['total_calls'].sum()
    activity_answered = activity_day_data['answered_calls'].sum()

    # Sum from users_calls (source)
    source_day_data = calls_df[
        (calls_df['ext'] == agent_ext) &
        (calls_df['start_timestamp'].dt.date == check_date)
    ]
    source_total = source_day_data['total_calls'].sum()
    source_answered = source_day_data['answered_calls'].sum()

    print(f"  Aggregated (agent_activity): Total={activity_total}, Answered={activity_answered}")
    print(f"  Source (users_calls):      Total={source_total}, Answered={source_answered}")

    if activity_total == source_total and activity_answered == source_answered:
        print("CHECK PASSED: Call counts in aggregated data match the source data.")
    else:
        print("CHECK FAILED: Mismatch found in call count aggregation.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python check_call_counts.py <activity_path> <calls_path>")
        sys.exit(1)
    run_check(sys.argv[1], sys.argv[2])