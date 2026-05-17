# Advanced Feature Pack

This pack is a clean-room implementation of OpenClaw-shaped usability patterns:
local memory, sessions, skills, automation, gateway inspection, and practical
workspace tools. It does not copy OpenClaw source code.

Public feature references used for direction:

- https://docs.openclaw.ai/concepts/features
- https://github.com/openclaw/openclaw/blob/main/docs/index.md
- https://github.com/openclaw/openclaw/blob/main/docs/tools/index.md

## Implemented Features

1. `butterclaw memory list`
2. `butterclaw memory search <query>`
3. `butterclaw memory add [--role role] <text>`
4. `butterclaw memory show <id|index>`
5. `butterclaw memory forget <id|index>`
6. `butterclaw memory clear`
7. `butterclaw memory stats`
8. `butterclaw memory export [path]`
9. `butterclaw memory import <path>`
10. `butterclaw memory prune --keep <n>`
11. `/memory [query]` slash command
12. `memory_list` agent tool
13. `memory_search` agent tool
14. `memory_add` agent tool
15. `memory_forget` agent tool
16. `memory_stats` agent tool
17. `butterclaw session search <query>`
18. `butterclaw session stats [name]`
19. `butterclaw session tail <name> [count]`
20. `butterclaw session append <name> [--role user|assistant] <text>`
21. `butterclaw session rename <old> <new>`
22. `butterclaw session copy <old> <new>`
23. `butterclaw session export <name> [path]`
24. `butterclaw session clear --all`
25. `butterclaw session prune --all <maxTurns>`
26. `session_list` agent tool
27. `session_show` agent tool
28. `session_search` agent tool
29. `butterclaw skill search <query>`
30. `butterclaw skill info <name>`
31. `butterclaw skill list --verbose`
32. `butterclaw skill validate [name]`
33. `butterclaw skill copy <old> <new>`
34. `butterclaw skill rename <old> <new>`
35. `butterclaw skill delete <name>`
36. `skill_search` agent tool
37. `skill_info` agent tool
38. `butterclaw tasks list --source <source> --limit <n>`
39. `butterclaw tasks cancel <id> [reason]`
40. `butterclaw tasks stats`
41. `butterclaw tasks clear [--status s] [--kind k] [--source src]`
42. `butterclaw tasks prune --keep <n>`
43. `butterclaw tasks export [path]`
44. `task_cancel` agent tool
45. `task_stats` agent tool
46. `butterclaw schedule due`
47. `butterclaw schedule stats`
48. `butterclaw schedule enable <id|name>`
49. `butterclaw schedule disable <id|name>`
50. `butterclaw schedule export [path]`
51. `schedule_enable` agent tool
52. `schedule_disable` agent tool
53. `schedule_stats` agent tool
54. `GET /metrics`
55. `GET /config`
56. `GET /sessions` and `GET /sessions/<name>`
57. `GET /skills` and `GET /skills/<name>`
58. `GET /memory`
59. `GET /memory/search?q=<query>`
60. Gateway `OPTIONS` preflight with local CORS headers
61. `/tasks` gateway filtering by `status`, `kind`, `source`, and `limit`
62. `read_file_range` workspace tool
63. `find_files` workspace wildcard tool
64. `file_stat` workspace metadata tool
65. `file_hash` workspace verification tool

## Tool Groups

New tools are wired into existing profiles through these groups:

- `group:memory`
- `group:sessions`
- `group:skills`
- expanded `group:read`
- expanded `group:runtime`
- expanded `group:automation`

`full` includes all of them. `minimal` gets the safe read-only workspace tools.
