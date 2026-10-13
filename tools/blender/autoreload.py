"""Auto-reload the open .blend whenever it changes on disk.

Run once inside Blender (Scripting tab > Open > autoreload.py > Run Script).
The watcher keeps running until Blender quits. Run it again to stop it.
Any unsaved edits in Blender are discarded when the file reloads.
"""
import os

import bpy

POLL_SECONDS = 1.0


def _view3d_spaces():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                yield area.spaces.active


def _watch():
    path = bpy.data.filepath
    if not path or not os.path.exists(path):
        return POLL_SECONDS

    mtime = os.path.getmtime(path)
    state = _watch.state
    if state.get("path") != path:
        state.update(path=path, mtime=mtime, pending=None)
        return POLL_SECONDS

    if mtime == state["mtime"]:
        return POLL_SECONDS

    # Wait one tick so we don't load a file that is still being written
    if state["pending"] != mtime:
        state["pending"] = mtime
        return POLL_SECONDS

    # The saved file has its own default UI, so keep the current shading mode
    shading = next((s.shading.type for s in _view3d_spaces()), None)
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.revert_mainfile()
    if shading:
        for space in _view3d_spaces():
            space.shading.type = shading

    state.update(mtime=mtime, pending=None)
    print("Reloaded", path)
    return POLL_SECONDS


_watch.state = {}

# Running the script a second time stops the watcher
# (driver_namespace is a dict that survives file loads, so it remembers the timer)
ns = bpy.app.driver_namespace
previous = ns.pop("_autoreload_watch", None)
if previous and bpy.app.timers.is_registered(previous):
    bpy.app.timers.unregister(previous)
    print("Auto-reload stopped")
else:
    bpy.app.timers.register(_watch, first_interval=POLL_SECONDS, persistent=True)
    ns["_autoreload_watch"] = _watch
    print("Auto-reload watching", bpy.data.filepath)
