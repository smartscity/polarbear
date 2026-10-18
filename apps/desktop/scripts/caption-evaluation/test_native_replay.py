"""Process-boundary regressions for production caption qualification."""

import asyncio
import json
import sys
import unittest
from unittest.mock import patch

import numpy as np

from native_replay import acceptance, replay, validate_native_arch


READY = "print(json.dumps({'type':'ready','protocol':1,'backend':'cpu'}),flush=True)"


class NativeReplayTests(unittest.IsolatedAsyncioTestCase):
    async def run_helper(self, source, seconds=.1, startup_timeout=1):
        events = []
        result = await replay([sys.executable, "-u", "-c", "import json,sys,time,os\n" + source],
                              [np.zeros(round(seconds * 16000), dtype="<f4")], seconds,
                              events.append, lambda: 1024, startup_timeout=startup_timeout, drain_timeout=1)
        return result, events

    async def test_paces_pcm_and_preserves_all_frames_with_an_empty_environment(self):
        result, events = await self.run_helper(READY + """
assert 'PATH' not in os.environ
began=time.monotonic()
data=sys.stdin.buffer.read()
import struct
offset=samples=0
while offset<len(data):
    timestamp,count=struct.unpack_from('<QI',data,offset)
    assert timestamp==samples*1000//16000 and 0<count<=512
    samples+=count
    offset+=12+count*4
assert samples==1600 and offset==len(data) and time.monotonic()-began>=.08
print(json.dumps({'type':'final','sequence':1,'startMs':0,'endMs':100,'english':'fixture'}),flush=True)
print(json.dumps({'type':'stopped'}),flush=True)
""")
        self.assertEqual(result["audioSeconds"], .1)
        self.assertEqual(result["frames"], 4)
        self.assertEqual(result["finals"], 1)
        self.assertTrue(any(event["type"] == "caption" for event in events))
        self.assertFalse(acceptance(result)["fullHour"])

    async def test_rejects_missing_and_wrong_handshakes(self):
        with self.assertRaisesRegex(RuntimeError, "completing"):
            await self.run_helper("pass")
        with self.assertRaisesRegex(RuntimeError, "handshake"):
            await self.run_helper(READY.replace("'cpu'", "'metal'") + "\ntime.sleep(30)")

    async def test_kills_and_reaps_stalled_startup(self):
        with self.assertRaises(TimeoutError):
            await self.run_helper("time.sleep(30)", startup_timeout=.1)

    async def test_preserves_overload_as_failure(self):
        with self.assertRaisesRegex(RuntimeError, "audioBacklog"):
            await self.run_helper(READY + "\nprint(json.dumps({'type':'error','code':'audioBacklog'}),flush=True)\ntime.sleep(30)")

    async def test_rejects_malformed_output_and_early_eof(self):
        with self.assertRaises(ValueError):
            await self.run_helper("print('not json',flush=True)\ntime.sleep(30)")
        with self.assertRaises(RuntimeError):
            await self.run_helper(READY + "\nsys.stdin.buffer.read()")

    async def test_cancellation_reaps_the_helper(self):
        task = asyncio.create_task(self.run_helper("time.sleep(30)"))
        await asyncio.sleep(.1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_rejects_duplicate_final_and_nonzero_exit(self):
        final = "print(json.dumps({'type':'final','sequence':1,'startMs':0,'endMs':100}),flush=True)"
        with self.assertRaisesRegex(RuntimeError, "Nonmonotonic"):
            await self.run_helper(READY + "\nsys.stdin.buffer.read()\n" + final + "\n" + final)
        with self.assertRaisesRegex(RuntimeError, "code 7"):
            await self.run_helper(READY + "\nsys.stdin.buffer.read()\nprint(json.dumps({'type':'stopped'}),flush=True)\nsys.exit(7)")

    async def test_rejects_oversized_output(self):
        with self.assertRaises(ValueError):
            await self.run_helper("print('x'*70000,flush=True)\ntime.sleep(30)")

    async def test_preserves_numeric_diagnostics_without_forwarding_arbitrary_stderr(self):
        _, events = await self.run_helper(READY + """
print('private path or text',file=sys.stderr,flush=True)
print('caption-metric:'+json.dumps({'stage':'final','computeMs':12,'cancelled':False}),file=sys.stderr,flush=True)
sys.stdin.buffer.read()
print(json.dumps({'type':'stopped'}),flush=True)
""")
        self.assertIn({'type': 'diagnostic', 'stage': 'final', 'computeMs': 12, 'cancelled': False}, events)
        self.assertNotIn('private path', json.dumps(events))

    async def test_rejects_unexpected_diagnostic_fields(self):
        with self.assertRaisesRegex(ValueError, "diagnostic field"):
            await self.run_helper(READY + "\nprint('caption-metric:'+json.dumps({'stage':'final','english':'private'}),file=sys.stderr,flush=True)\ntime.sleep(30)")

    async def test_measurement_failure_cancels_replay(self):
        def unavailable():
            raise OSError("RSS unavailable")
        with self.assertRaisesRegex(OSError, "RSS unavailable"):
            await replay([sys.executable, "-u", "-c", "import json,time\n" + READY + "\ntime.sleep(30)"],
                         [np.zeros(16000 * 10, dtype="<f4")], 10, lambda _: None, unavailable)

    def test_rejects_wrong_architecture_and_rosetta(self):
        with patch("qualify.platform.machine", return_value="arm64"):
            with self.assertRaisesRegex(ValueError, "declared native"):
                validate_native_arch("x86_64")
        with patch("qualify.platform.machine", return_value="x86_64"), patch("qualify.subprocess.run") as run:
            run.return_value.stdout = "1\n"
            with self.assertRaisesRegex(ValueError, "Rosetta"):
                validate_native_arch("x86_64")

    def test_missing_latency_and_memory_cannot_pass(self):
        result = {"audioSeconds": 3600, "finals": 1, "firstFromVadStartP95Seconds": None,
                  "finalAfterVadEndP95Seconds": None, "sampledPeakProcessTreeRssBytes": None,
                  "warmedMedianRssGrowthBytes": None}
        checks = acceptance(result)
        self.assertFalse(all(checks.values()))
        self.assertFalse(checks["firstText"])
        self.assertFalse(checks["memoryPeak"])


if __name__ == "__main__":
    unittest.main()
