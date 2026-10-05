#!/usr/bin/python3 -I
"""Fixed privilege boundary: bounded stdin -> unprivileged systemd unit.
Install root-owned 0755. sudoers permits ONLY this no-argument executable.
No caller-supplied unit names, environment, identities, or unit properties.
"""
import base64
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
import uuid

ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise ValueError('privilege boundary')
    signal.alarm(5)
    raw = sys.stdin.buffer.readline(24577)
    signal.alarm(0)
    if len(raw) > 24576 or not raw.endswith(b'\n'):
        raise ValueError('bounded request required')
    job = json.loads(raw)
    if not isinstance(job, dict) or set(job) - {'command', 'cwd', 'timeoutMs'}:
        raise ValueError('invalid fields')
    command, cwd, timeout = job.get('command'), job.get('cwd', '/home/newport-exec'), job.get('timeoutMs')
    if not isinstance(command, str) or not command.strip() or '\0' in command or len(command.encode()) > 16384:
        raise ValueError('invalid command')
    if not isinstance(cwd, str) or not cwd.startswith('/') or '\0' in cwd or len(cwd.encode()) > 4096:
        raise ValueError('invalid cwd')
    if type(timeout) is not int or not 1 <= timeout <= 300000:
        raise ValueError('invalid timeout')
    for mount in ('/', '/mnt/terrabud'):
        quota = subprocess.run(['/usr/sbin/quotaon', '-p', '-u', mount], capture_output=True, text=True, env={**ENV, 'LC_ALL': 'C'}, timeout=5)
        if not quota.stdout.strip().endswith('is on'):
            raise RuntimeError('required aggregate quota is unavailable')
    unit = 'newport-job-' + uuid.uuid4().hex + '.service'
    props = [
        'User=newport-exec', 'Group=newport-exec', 'SupplementaryGroups=',
        'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
        'ProtectSystem=full', 'ProtectControlGroups=yes', 'ProtectKernelTunables=yes',
        'ProtectKernelModules=yes', 'ProtectKernelLogs=yes', 'ProtectClock=yes',
        'ProtectProc=invisible', 'ProcSubset=pid', 'PrivateDevices=yes',
        'PrivateIPC=yes', 'RestrictNamespaces=yes', 'RestrictSUIDSGID=yes',
        'RestrictAddressFamilies=AF_INET AF_INET6', 'LockPersonality=yes',
        'RemoveIPC=yes', 'UMask=0077', 'TasksMax=128', 'MemoryMax=1G',
        'MemorySwapMax=0', 'CPUQuota=200%', 'LimitNOFILE=1024', 'LimitFSIZE=268435456',
        'KillMode=control-group', 'TimeoutStopSec=2s', 'SendSIGKILL=yes',
        f'RuntimeMaxSec={timeout / 1000 + 1}s',
        'TemporaryFileSystem=/tmp:rw,size=256M,mode=1777 /var/tmp:rw,size=256M,mode=1777 /dev/shm:rw,size=64M,mode=1777',
        'InaccessiblePaths=-/etc/newport-shell -/opt/newport-shell -/var/lib/newport-shell -/run/newport-shell -/mnt/stash',
        'BindReadOnlyPaths=/etc/newport-shell/resolv.conf:/etc/resolv.conf',
        'IPAddressDeny=0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 173.35.51.79/32 224.0.0.0/4 2607:fea8:ff01:7bb8::/64 ::/128 ::1/128 ::ffff:0:0/96 fc00::/7 fe80::/10 ff00::/8',
    ]
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit='+unit]
    for prop in props:
        args += ['--property='+prop]
    # cwd is passed as shell data after privilege drop, not systemd specifiers.
    args += ['--', '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/home/newport-exec', 'LANG=C.UTF-8', 'USER=newport-exec', 'LOGNAME=newport-exec', '/bin/sh', '-c', 'cd -- "$1" || exit 125; exec /bin/sh -c "$2"', 'newport-shell', cwd, command]
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    assert proc.stdout is not None and proc.stderr is not None
    sel = selectors.DefaultSelector()
    sel.register(sys.stdin.buffer, selectors.EVENT_READ, 'cancel')
    sel.register(proc.stdout, selectors.EVENT_READ, 'stdout')
    sel.register(proc.stderr, selectors.EVENT_READ, 'stderr')
    deadline = time.monotonic() + timeout / 1000
    stopping = False

    def stop():
        nonlocal stopping
        stopping = True
        # Retry a requested stop until launch has settled: cancellation can race
        # systemd-run's StartTransientUnit call. Never conclude from "not found".
        subprocess.run(['/usr/bin/systemctl', 'stop', unit], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)

    try:
        streams = 2
        while streams:
            if stopping or time.monotonic() >= deadline:
                stop()
            for key, _ in sel.select(0.1):
                if key.data == 'cancel':
                    os.read(key.fd, 1024)
                    sel.unregister(key.fileobj)
                    stop()
                else:
                    data = os.read(key.fd, 8192)
                    if not data:
                        sel.unregister(key.fileobj)
                        streams -= 1
                    else:
                        print(json.dumps({'stream': key.data, 'data': base64.b64encode(data).decode()}), flush=True)
        code = proc.wait(timeout=8)
        stop()
        check = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=ActiveState', '--value'], capture_output=True, env=ENV, timeout=5)
        if check.returncode != 0 or check.stdout.strip() not in (b'inactive', b'failed'):
            raise RuntimeError('cleanup not confirmed')
        events = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.events'
        if events.exists() and 'populated 1' in events.read_text():
            raise RuntimeError('descendants remain')
        print(json.dumps({'done': True, 'exitCode': code if 0 <= code <= 255 else None}), flush=True)
    finally:
        stop()
        sel.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No command text, environment, credentials, or OS error details.
        print('Helper failed; outcome unknown', file=sys.stderr)
        sys.exit(1)
