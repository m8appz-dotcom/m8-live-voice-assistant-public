#!/bin/bash
sqlite3 /home/m8apps/titan-os/data/titan-os.db "UPDATE project_registry SET name='M8 Live' WHERE name='OpenClaw Live';"
sqlite3 /home/m8apps/titan-os/data/titan-os.db "SELECT id, name FROM project_registry WHERE id=69;"
