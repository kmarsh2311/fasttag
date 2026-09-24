import os
import sys
import time
import subprocess
import signal
import tempfile
import shutil

# Cross-platform tests for FastTag Gemini Bridge PID lifecycle & process safety

def run_tests():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    task_src = os.path.join(repo_root, "fasttag_task.py")
    bridge_src = os.path.join(repo_root, "fasttag_gemini_bridge.py")
    
    assert os.path.exists(task_src), f"Missing {task_src}"
    assert os.path.exists(bridge_src), f"Missing {bridge_src}"

    temp_dir = tempfile.mkdtemp(prefix="fasttag_lifecycle_test_")
    try:
        task_dest = os.path.join(temp_dir, "fasttag_task.py")
        bridge_dest = os.path.join(temp_dir, "fasttag_gemini_bridge.py")
        shutil.copy(task_src, task_dest)
        shutil.copy(bridge_src, bridge_dest)

        sys.path.insert(0, temp_dir)
        import fasttag_task
        fasttag_task.PID_FILE = os.path.join(temp_dir, "fasttag_gemini_bridge.pid")
        fasttag_task.BRIDGE_SCRIPT = bridge_dest

        # 1. Dead stale PID test
        dead_pid = 9999999
        with open(fasttag_task.PID_FILE, "w") as f:
            f.write(str(dead_pid))
        assert not fasttag_task.is_bridge_process(dead_pid), "Dead PID must return False"
        fasttag_task.start()
        new_pid = fasttag_task.read_pid_file()
        assert new_pid is not None and new_pid != dead_pid, "Dead PID must be replaced"
        assert fasttag_task.is_bridge_process(new_pid), "New bridge process must be valid"
        fasttag_task.stop()
        time.sleep(0.5)

        # 2. PID reused by unrelated process
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        unrelated_pid = unrelated.pid
        with open(fasttag_task.PID_FILE, "w") as f:
            f.write(str(unrelated_pid))
        assert not fasttag_task.is_bridge_process(unrelated_pid), "Unrelated PID must return False"
        fasttag_task.start()
        bridge_pid = fasttag_task.read_pid_file()
        assert bridge_pid != unrelated_pid, "Bridge must start on fresh PID"
        assert fasttag_task.is_bridge_process(bridge_pid), "Bridge must be valid"
        assert unrelated.poll() is None, "Unrelated process must be untouched"
        fasttag_task.stop()
        time.sleep(0.5)

        # 3. Valid running FastTag bridge PID
        fasttag_task.start()
        valid_pid = fasttag_task.read_pid_file()
        assert fasttag_task.is_bridge_process(valid_pid), "Running bridge must be valid"
        fasttag_task.start()
        assert fasttag_task.read_pid_file() == valid_pid, "Duplicate start must not spawn another bridge"

        # 4. Stop does not kill unrelated process
        fasttag_task.stop()
        time.sleep(0.5)
        with open(fasttag_task.PID_FILE, "w") as f:
            f.write(str(unrelated_pid))
        fasttag_task.stop()
        assert unrelated.poll() is None, "stop() must never kill unrelated process!"
        assert not os.path.exists(fasttag_task.PID_FILE), "Stale PID file must be removed"
        unrelated.terminate()
        unrelated.wait()

        # 5. Restart after bridge code update
        fasttag_task.start()
        b_pid = fasttag_task.read_pid_file()
        assert fasttag_task.is_bridge_process(b_pid)
        new_time = time.time() + 10
        os.utime(bridge_dest, (new_time, new_time))
        fasttag_task.stop()
        time.sleep(0.5)
        fasttag_task.start()
        restarted_pid = fasttag_task.read_pid_file()
        assert restarted_pid is not None
        assert fasttag_task.is_bridge_process(restarted_pid)
        fasttag_task.stop()

        print("fasttag-bridge-lifecycle tests passed")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    run_tests()
