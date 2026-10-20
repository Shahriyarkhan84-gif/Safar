# Safar

Two ride-hailing apps for Leeds that share one Supabase database.

| Folder | App | Who it's for |
| --- | --- | --- |
| `rides/` | **Safar Rides** | Riders book a car, track it and rate the driver |
| `driver/` | **Safar X** | Drivers go online, accept rides and see earnings |

Each folder is a complete static website. On Vercel, import this repo once per app and set **Root Directory** to `rides` or `driver`. No build step is needed.

- `database/safar_setup.sql` sets up the Supabase tables and secure functions (already run on the `safar` project).
- `source/` holds the editable source; `python3 source/build.py` rebuilds both apps.

Test mode: payments are not taken, the map is a simplified Leeds grid, and a test driver accepts rides if no Safar X driver does within 22 seconds.
