#!/usr/bin/env python3
"""
EAS AI Adoption — Grafana IDE Usage JSON → SQL Sync Generator

Reads the NDJSON (one JSON object per line) Copilot usage dump from Grafana
and produces SQL UPDATE statements to populate the ide_* columns on copilot_users.

Username mapping: strips the '_ejadasa' suffix from user_login to get username.

Usage:
    python scripts/sync_grafana_json.py <dump.json> [--out <output-dir>]

Output:
    scripts/sync_output/sync_grafana_ide.sql
"""
import sys
import os
import json
import argparse
from datetime import datetime
from collections import defaultdict


def strip_suffix(user_login, suffix='_ejadasa'):
    login = user_login.strip().lower()
    if login.endswith(suffix):
        return login[:-len(suffix)]
    return login


def parse_ndjson(filepath):
    """Parse NDJSON file, return list of records."""
    records = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                records.append(obj)
            except json.JSONDecodeError as e:
                print(f"WARNING: Line {lineno} parse error: {e}")
    return records


def aggregate_by_user(records):
    """Aggregate daily records per user, stripping _ejadasa suffix."""
    user_data = defaultdict(lambda: {
        'days_active': 0,
        'total_interactions': 0,
        'code_generations': 0,
        'code_acceptances': 0,
        'agent_days': 0,
        'chat_days': 0,
        'loc_suggested': 0,
        'loc_added': 0,
        'last_active_date': None,
        'first_date': None,
        'last_date': None,
        'days_set': set(),
    })

    for r in records:
        raw_login = r.get('user_login') or r.get('user_name', '')
        if not raw_login:
            continue

        username = strip_suffix(str(raw_login))
        day = r.get('day', '')
        if isinstance(day, datetime):
            day = day.strftime('%Y-%m-%d')
        else:
            day = str(day).strip() if day else ''

        u = user_data[username]

        # Count unique active days
        if day and day not in u['days_set']:
            u['days_set'].add(day)
            u['days_active'] += 1

        u['total_interactions'] += int(r.get('user_initiated_interaction_count', 0) or 0)
        u['code_generations'] += int(r.get('code_generation_activity_count', 0) or 0)
        u['code_acceptances'] += int(r.get('code_acceptance_activity_count', 0) or 0)

        if r.get('used_agent'):
            u['agent_days'] += 1
        if r.get('used_chat'):
            u['chat_days'] += 1

        u['loc_suggested'] += int(r.get('loc_suggested_to_add_sum', 0) or 0)
        u['loc_added'] += int(r.get('loc_added_sum', 0) or 0)

        # Track date range
        if day:
            if u['first_date'] is None or day < u['first_date']:
                u['first_date'] = day
            if u['last_date'] is None or day > u['last_date']:
                u['last_date'] = day
            if u['last_active_date'] is None or day > u['last_active_date']:
                u['last_active_date'] = day

    # Clean up sets
    for u in user_data.values():
        del u['days_set']

    return dict(user_data)


def escape_sql(val):
    if val is None:
        return "NULL"
    s = str(val).strip()
    if not s or s.lower() in ('nan', 'none'):
        return "NULL"
    s = s.replace("'", "''")
    return f"'{s}'"


def gen_sql(user_aggregates, report_start, report_end):
    lines = [
        f"-- Grafana IDE Usage Sync (generated {datetime.now().isoformat()})",
        f"-- Source period: {report_start} to {report_end}",
        "-- Updates copilot_users.ide_* columns by matching username",
        ""
    ]

    for username, data in sorted(user_aggregates.items()):
        period = ''
        if data['first_date'] and data['last_date']:
            period = f"{data['first_date']} to {data['last_date']}"

        lines.append(f"""UPDATE copilot_users SET
  ide_days_active = {data['days_active']},
  ide_total_interactions = {data['total_interactions']},
  ide_code_generations = {data['code_generations']},
  ide_code_acceptances = {data['code_acceptances']},
  ide_agent_days = {data['agent_days']},
  ide_chat_days = {data['chat_days']},
  ide_loc_suggested = {data['loc_suggested']},
  ide_loc_added = {data['loc_added']},
  ide_last_active_date = {escape_sql(data['last_active_date'])},
  ide_data_period = {escape_sql(period)},
  ide_data_updated_at = now()
WHERE username = {escape_sql(username)};
""")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='Sync Grafana IDE NDJSON → SQL')
    parser.add_argument('file', help='Grafana NDJSON dump file')
    parser.add_argument('--out', default='scripts/sync_output', help='Output directory')
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"ERROR: File not found: {args.file}")
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)

    print(f"Reading: {args.file}")
    records = parse_ndjson(args.file)
    print(f"  {len(records)} daily records")

    # Get report period from first record
    report_start = records[0].get('report_start_day', '') if records else ''
    report_end = records[0].get('report_end_day', '') if records else ''

    unique_logins = set(r.get('user_login', '') for r in records)
    print(f"  Unique user_logins: {len(unique_logins)}")

    user_agg = aggregate_by_user(records)
    print(f"  Aggregated into {len(user_agg)} usernames (after stripping _ejadasa)")

    sql = gen_sql(user_agg, report_start, report_end)
    output_path = os.path.join(args.out, 'sync_grafana_ide.sql')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(sql)

    print(f"\n[OK] {output_path} ({len(user_agg)} UPDATE statements)")
    print(f"     Period: {report_start} to {report_end}")
    print("\nReview the SQL, then execute via Supabase MCP execute_sql.")

    # Print summary table
    print("\n--- User Summary ---")
    print(f"{'Username':<30} {'Days':>5} {'Interactions':>13} {'CodeGen':>8} {'LOC Added':>10}")
    print("-" * 70)
    for username, d in sorted(user_agg.items()):
        print(f"{username:<30} {d['days_active']:>5} {d['total_interactions']:>13} {d['code_generations']:>8} {d['loc_added']:>10}")


if __name__ == '__main__':
    main()
