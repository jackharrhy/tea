"""Linux/Xvfb native-window smoke test; run from the repository root."""
import os
from pathlib import Path
import subprocess
import time

out = Path("artifacts")
out.mkdir(exist_ok=True)
binary = Path(os.environ.get("CARGO_TARGET_DIR", "target")) / "debug/img"
with (out / "native.log").open("w") as log:
    app = subprocess.Popen([str(binary), "samples/blue-block.gif"], stdout=log, stderr=log)
    try:
        window = None
        for _ in range(100):
            if app.poll() is not None:
                raise RuntimeError(f"app exited {app.returncode}")
            found = subprocess.run(
                ["xdotool", "search", "--pid", str(app.pid), "--name", "img"],
                capture_output=True, text=True,
            )
            if found.returncode == 0:
                window = found.stdout.splitlines()[0]
                break
            time.sleep(0.1)
        if not window:
            raise RuntimeError("no native window")
        time.sleep(3)
        def capture(name):
            subprocess.run(["magick", "import", "-window", window, str(out / name)], check=True)
        capture("workspace.png")
        time.sleep(0.24)
        capture("animated.png")
        if (out / "workspace.png").read_bytes() == (out / "animated.png").read_bytes():
            raise RuntimeError("native preview did not animate")
        print(f"Native app alive; window={window}; animation changed between captures")
        print(f"Screenshots: {out.resolve()}")
    finally:
        app.terminate()
        app.wait(timeout=10)
