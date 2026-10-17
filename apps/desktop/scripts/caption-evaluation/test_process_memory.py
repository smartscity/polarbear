"""Exercise real child memory sampling inside the qualification sandbox."""

import errno
import os
import platform
import subprocess
import sys
import unittest
from unittest.mock import patch

from process_memory import ProcessMemory


@unittest.skipUnless(platform.system() == "Darwin", "macOS native memory API")
class ProcessMemoryTests(unittest.TestCase):
    def test_real_child_memory_is_included_and_released(self):
        memory = ProcessMemory()
        before = memory.sample()
        child = subprocess.Popen(
            [sys.executable, "-c", "import sys; data=bytearray(80*1024*1024); print('ready',flush=True); sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            self.assertEqual(child.stdout.readline().strip(), "ready")
            self.assertIn(child.pid, memory.children(os.getpid()))
            self.assertGreater(memory.resident(child.pid), 60 * 1024 * 1024)
            during = memory.sample()
            self.assertGreater(during - before, 60 * 1024 * 1024)
        finally:
            child.communicate(timeout=10)
        self.assertGreater(during - memory.sample(), 60 * 1024 * 1024)

    def test_descendants_are_counted_once_and_exited_children_are_skipped(self):
        root = os.getpid()
        memory = ProcessMemory()
        with patch.object(memory, "children", side_effect=lambda pid: {root: [1, 2], 1: [3], 3: [1]}[pid]), \
                patch.object(memory, "resident", side_effect=lambda pid: {root: 100, 1: 200, 2: None, 3: 300}[pid]):
            self.assertEqual(memory.sample(), 600)

    def test_permission_failure_is_not_reported_as_zero_memory(self):
        with patch.object(ProcessMemory, "resident", side_effect=PermissionError(errno.EPERM, "denied")):
            with self.assertRaises(PermissionError):
                ProcessMemory().sample()


if __name__ == "__main__":
    unittest.main()
