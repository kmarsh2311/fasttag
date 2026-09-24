#!/usr/bin/env python3
"""
FastTag Stash Plugin Task Runner
"""
import os
import sys
import subprocess
import signal

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

def is_running(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def start():
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            if is_running(pid):
                print(f"[FastTag] Gemini Bridge is already running (PID {pid}).", flush=True)
                return
        except Exception:
            pass

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
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            if is_running(pid):
                os.kill(pid, signal.SIGTERM)
                print(f"[FastTag] Gemini Bridge (PID {pid}) stopped.", flush=True)
            else:
                print("[FastTag] Gemini Bridge was not running.", flush=True)
        except Exception as e:
            print(f"[FastTag] Error stopping Gemini Bridge: {e}", flush=True)
        try:
            os.remove(PID_FILE)
        except OSError:
            pass
    else:
        print("[FastTag] Gemini Bridge is not running.", flush=True)

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "start"
    if arg == "stop":
        stop()
    else:
        start()
