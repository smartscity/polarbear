"""Sample the macOS process tree without executing privileged system tools."""

import ctypes as c
import errno
import os


class TaskInfo(c.Structure):
    # Stable PROC_PIDTASKINFO layout from the macOS SDK sys/proc_info.h.
    _fields_ = [(name, c.c_uint64) for name in (
        "virtual_size", "resident_size", "total_user", "total_system",
        "threads_user", "threads_system",
    )] + [(name, c.c_int32) for name in (
        "policy", "faults", "pageins", "cow_faults", "messages_sent",
        "messages_received", "syscalls_mach", "syscalls_unix", "csw",
        "threadnum", "numrunning", "priority",
    )]


class ProcessMemory:
    def __init__(self):
        self.lib = c.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.lib.proc_listpids.argtypes = [c.c_uint32, c.c_uint32, c.c_void_p, c.c_int]
        self.lib.proc_listpids.restype = c.c_int
        self.lib.proc_pidinfo.argtypes = [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]
        self.lib.proc_pidinfo.restype = c.c_int

    def children(self, pid):
        capacity = 64
        while capacity <= 65536:
            buffer = (c.c_int * capacity)()
            c.set_errno(0)
            count = self.lib.proc_listpids(6, pid, buffer, c.sizeof(buffer))  # PROC_PPID_ONLY
            error = c.get_errno()
            if count < 0 or (count == 0 and error):
                if error == errno.ESRCH:
                    return []
                raise OSError(error, "Cannot enumerate caption process children")
            if count < c.sizeof(buffer):
                return [value for value in buffer[:count // c.sizeof(c.c_int)] if value > 0]
            capacity *= 2
        raise RuntimeError("Process tree enumeration exceeded bounded buffer")

    def resident(self, pid):
        info = TaskInfo()
        c.set_errno(0)
        size = self.lib.proc_pidinfo(pid, 4, 0, c.byref(info), c.sizeof(info))  # PROC_PIDTASKINFO
        if size != c.sizeof(info):
            error = c.get_errno()
            if error == errno.ESRCH:
                return None
            raise OSError(error, "Cannot measure caption process resident memory")
        return info.resident_size

    def sample(self):
        root = os.getpid()
        pending, visited, total = [root], set(), 0
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            resident = self.resident(pid)
            if resident is None:
                if pid == root:
                    raise RuntimeError("Supervisor memory measurement unavailable")
                continue  # A short-lived child may exit between enumeration and sampling.
            total += resident
            pending.extend(self.children(pid))
        return total
