#!/usr/bin/env python3
"""
FastTag Stash Plugin Task Runner
"""
import os
import sys
import subprocess
import signal
import re

def get_runtime_dir():
    dot_stash = os.path.expanduser("~/.stash")
    try:
        os.makedirs(dot_stash, exist_ok=True)
        return dot_stash
    except Exception:
        pass
    plugin_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        test_file = os.path.join(plugin_dir, ".perm_test")
        with open(test_file, "w") as f:
            f.write("")
        os.remove(test_file)
        return plugin_dir
    except Exception:
        pass
    import tempfile
    return tempfile.gettempdir()

PID_FILE = os.path.join(get_runtime_dir(), "fasttag_gemini_bridge.pid")
BRIDGE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fasttag_gemini_bridge.py")

def is_bridge_process(pid):
    """
    Cross-platform verification that a PID is alive and specifically belongs
    to fasttag_gemini_bridge.py (prevents PID reuse from blocking startup or killing
    unrelated processes). Safe on macOS, Linux/Docker, and Windows.
    """
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False

    cmd = None

    # Linux / Docker /proc filesystem check
    proc_cmdline = f"/proc/{pid}/cmdline"
    if os.path.exists(proc_cmdline):
        try:
            with open(proc_cmdline, "rb") as f:
                cmd = f.read().replace(b"\x00", b" ").decode("utf-8", errors="ignore")
        except Exception:
            pass

    # macOS / BSD / POSIX ps check
    if cmd is None and (hasattr(os, "uname") or os.name == "posix"):
        try:
            res = subprocess.run(
                ["ps", "-p", str(pid), "-o", "args="],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=2
            )
            if res.returncode == 0:
                cmd = res.stdout.strip()
        except Exception:
            pass

    # Windows WMIC and PowerShell fallback
    if cmd is None and (os.name == "nt" or sys.platform.startswith("win")):
        try:
            res = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=2
            )
            if res.returncode == 0 and res.stdout.strip():
                cmd = res.stdout.strip()
        except Exception:
            pass
        if cmd is None:
            try:
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=2
                )
                if res.returncode == 0:
                    cmd = res.stdout.strip()
            except Exception:
                pass

    if not cmd:
        return False

    pattern = r"(?:^|[\s/\\'\"])fasttag_gemini_bridge\.py(?:$|[\s/\\'\"])"
    return bool(re.search(pattern, cmd))

def read_pid_file():
    if not os.path.exists(PID_FILE):
        return None
    try:
        with open(PID_FILE, "r") as f:
            content = f.read().strip()
            return int(content) if content.isdigit() else None
    except Exception:
        return None

def cleanup_pid_file():
    if os.path.exists(PID_FILE):
        try:
            os.remove(PID_FILE)
        except OSError:
            pass

def start():
    pid = read_pid_file()
    if pid is not None:
        if is_bridge_process(pid):
            print(f"[FastTag] Gemini Bridge is already running (PID {pid}).", flush=True)
            return
        else:
            print(f"[FastTag] Removing stale PID file (PID {pid} is dead or not FastTag Gemini Bridge).", flush=True)
            cleanup_pid_file()

    proc = subprocess.Popen(
        [sys.executable, BRIDGE_SCRIPT],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )
    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))
    print(f"[FastTag] Gemini Bridge started successfully on PID {proc.pid}.", flush=True)

def stop():
    pid = read_pid_file()
    if pid is None:
        print("[FastTag] Gemini Bridge is not running.", flush=True)
        return

    if is_bridge_process(pid):
        try:
            os.kill(pid, signal.SIGTERM)
            print(f"[FastTag] Gemini Bridge (PID {pid}) stopped.", flush=True)
        except Exception as e:
            print(f"[FastTag] Error stopping Gemini Bridge: {e}", flush=True)
    else:
        print(f"[FastTag] PID {pid} is not FastTag Gemini Bridge. Skipping kill to protect unrelated process.", flush=True)

    cleanup_pid_file()

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "start"
    if arg == "stop":
        stop()
    else:
        start()
