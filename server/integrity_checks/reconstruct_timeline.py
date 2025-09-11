import pandas as pd
import sys

def run_check(activity_path, events_path):
    try:
        activity_df = pd.read_csv(activity_path)
        events_df = pd.read_csv(events_path)
    except FileNotFoundError as e:
        print(f"Error loading file: {e}")
        sys.exit(1)
        
    activity_df['report_hour'] = pd.to_datetime(activity_df['report_hour'])

    # Find a meaningful record to reconstruct
    target_record_query = activity_df[(activity_df['login_secs'] > 0) | (activity_df['logoff_secs'] > 0)]
    if target_record_query.empty:
        print("Could not find a record with login/logoff activity to reconstruct. Skipping check.")
        return
    target_record = target_record_query.iloc[0]
    
    target_ext = target_record['agent_ext']
    target_hour_dt = pd.to_datetime(target_record['report_hour'])
    
    hour_start_ts = int(target_hour_dt.timestamp())
    hour_end_ts = hour_start_ts + 3600
    context_start_ts = hour_start_ts - (6 * 3600) # 6-hour lookback for initial state

    print(f"Reconstructing timeline for Agent {target_ext} at {target_hour_dt.strftime('%Y-%m-%d %H:%M')}")

    # Filter relevant events for the agent
    agent_events = events_df[
        (events_df['ext'] == target_ext) &
        (events_df['ts_epoch'] >= context_start_ts) &
        (events_df['ts_epoch'] < hour_end_ts)
    ].sort_values(by='ts_epoch').drop_duplicates(subset=['ts_epoch'], keep='last')

    # --- REFACTORED TIMELINE CALCULATION ---
    calculated = {'login_secs': 0, 'logoff_secs': 0}

    # 1. Find the state at the exact start of the hour
    last_event_before_hour = agent_events[agent_events['ts_epoch'] <= hour_start_ts].tail(1)
    if last_event_before_hour.empty:
        # If no history, assume agent was logged off
        current_state_event = {'enabled': 1, 'event': 'agent_not_avail_state', 'state': 'logoff'}
    else:
        current_state_event = last_event_before_hour.iloc[0].to_dict()
    
    last_ts = hour_start_ts
    
    # 2. Get all events that happened strictly inside the hour
    events_in_hour = agent_events[agent_events['ts_epoch'] > hour_start_ts]

    # 3. Iterate through events, calculating duration of the *previous* state
    for index, event in events_in_hour.iterrows():
        duration = event['ts_epoch'] - last_ts
        if duration > 0 and current_state_event['enabled'] == 1 and current_state_event['event'] == 'agent_not_avail_state':
            state = str(current_state_event['state']).lower().strip()
            if state == 'login':
                calculated['login_secs'] += duration
            elif state == 'logoff':
                calculated['logoff_secs'] += duration
        # Update state for the next iteration
        current_state_event = event.to_dict()
        last_ts = event['ts_epoch']

    # 4. Calculate duration from the last event to the end of the hour
    final_duration = hour_end_ts - last_ts
    if final_duration > 0 and current_state_event['enabled'] == 1 and current_state_event['event'] == 'agent_not_avail_state':
        state = str(current_state_event['state']).lower().strip()
        if state == 'login':
            calculated['login_secs'] += final_duration
        elif state == 'logoff':
            calculated['logoff_secs'] += final_duration
    
    print(f"  Calculated -> Login: {calculated['login_secs']}s, Logoff: {calculated['logoff_secs']}s")
    print(f"  Original   -> Login: {int(target_record['login_secs'])}s, Logoff: {int(target_record['logoff_secs'])}s")

    if calculated['login_secs'] == target_record['login_secs'] and calculated['logoff_secs'] == target_record['logoff_secs']:
        print("CHECK PASSED: Reconstructed timeline matches the aggregated data.")
    else:
        print("CHECK FAILED: Mismatch in timeline reconstruction.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python reconstruct_timeline.py <activity_path> <events_path>")
        sys.exit(1)
    run_check(sys.argv[1], sys.argv[2])