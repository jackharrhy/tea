#!/usr/bin/python3 -I
"""Enable existing quotas without rescanning or altering other users' limits."""
import os
import subprocess

assert os.geteuid() == 0
for mount in ('/', '/mnt/terrabud'):
    result = subprocess.run(['/usr/sbin/quotaon','-p','-u',mount],capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},check=False)
    if result.stdout.strip().endswith('is off'):
        subprocess.run(['/usr/sbin/quotaon','-u',mount],check=True)
        result = subprocess.run(['/usr/sbin/quotaon','-p','-u',mount],capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},check=False)
    if not result.stdout.strip().endswith('is on'):
        raise SystemExit('Required execution-account quota unavailable')
