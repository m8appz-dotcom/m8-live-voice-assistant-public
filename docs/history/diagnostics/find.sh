#!/bin/bash
sqlite3 /home/m8apps/titan-os/data/titan-os.db "SELECT id, name FROM project_registry WHERE name LIKE '%Live%' OR name LIKE '%Claw%' OR name LIKE '%M8%';"
