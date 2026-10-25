"""Measure the shared VPS during a synthetic recording; no conference data."""
import argparse
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import time


def counters():
    cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()}
    vm = dict(line.split() for line in Path('/proc/vmstat').read_text().splitlines())
    return {'cpuTotal': sum(cpu), 'cpuIdle': cpu[3] + cpu[4], 'memAvailable': memory['MemAvailable'], 'swapUsed': memory['SwapTotal'] - memory['SwapFree'], 'swapInPages': int(vm['pswpin']), 'swapOutPages': int(vm['pswpout']), 'diskFree': shutil.disk_usage('/').free}


def containers():
    names = subprocess.check_output(['docker', 'ps', '-q'], text=True).split()
    data = json.loads(subprocess.check_output(['docker', 'inspect', *names], text=True))
    return {x['Name']: {'restartCount': x['RestartCount'], 'oomKilled': x['State']['OOMKilled'], 'health': x['State'].get('Health', {}).get('Status'), 'startedAt': x['State']['StartedAt']} for x in data}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=240)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    before = counters()
    previous = before
    initial_containers = containers()
    samples = []
    end = time.monotonic() + options.seconds
    while time.monotonic() < end:
        current = counters()
        sample = {**current, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        total = current['cpuTotal'] - previous['cpuTotal']
        sample['cpuBusyPercent'] = round(100 * (1 - (current['cpuIdle'] - previous['cpuIdle']) / total), 2) if total else 0
        previous = current
        stats = subprocess.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}'], text=True, capture_output=True, timeout=15)
        sample['containers'] = [json.loads(line) for line in stats.stdout.splitlines() if line]
        samples.append(sample)
        time.sleep(3)
    after = counters()
    final_containers = containers()
    report = {'before': before, 'after': after, 'initialContainers': initial_containers, 'finalContainers': final_containers, 'samples': samples, 'minimumMemAvailable': min(x['memAvailable'] for x in samples), 'maximumCpuBusyPercent': max(x['cpuBusyPercent'] for x in samples), 'swapOutPages': after['swapOutPages'] - before['swapOutPages']}
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    options.output.chmod(0o600)
    print(json.dumps({k:report[k] for k in ['minimumMemAvailable', 'maximumCpuBusyPercent', 'swapOutPages']}))


if __name__ == '__main__':
    main()
