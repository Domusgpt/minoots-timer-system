# 🤖 MINOOTS AGENT SYSTEM DIAGRAMS

**Visual Guide to How MINOOTS Works for AI Agents and Autonomous Systems**

---

## 🔄 AGENT TIMER WORKFLOW

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   AI AGENT      │───▶│   MINOOTS API    │───▶│  FIREBASE       │
│                 │    │                  │    │  FUNCTIONS      │
│ • Claude Code   │    │ • Timer Creation │    │                 │
│ • Custom Agent  │    │ • Authentication │    │ • Persistent    │
│ • Automation    │    │ • Rate Limiting  │    │   Storage       │
│                 │    │                  │    │ • Scheduling    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ▲                                              │
         │                                              │
         │              ┌─────────────────┐            │
         │              │                 │            │
         └──────────────│   WEBHOOK       │◀───────────┘
                        │   CALLBACK      │
                        │                 │
                        │ • Timer Expired │
                        │ • Agent Data    │
                        │ • Next Actions  │
                        └─────────────────┘
```

**Flow:**
1. **Agent** creates timer with webhook callback
2. **MINOOTS** stores timer in Firebase
3. **Firebase** tracks timer and triggers expiration
4. **Webhook** delivers expiration event back to agent
5. **Agent** receives notification and continues workflow

---

## 🔥 MCP INTEGRATION FOR CLAUDE CODE (Real Example)

**SETUP:** You have Claude Code MCP installed with MINOOTS integration

**REAL USER SCENARIO:**
```
YOU: "Set a 2-hour timer to automatically commit my work in progress"

CLAUDE: "I'll create a timer that will run 'git add . && git commit -m \"Auto-save: 2hr checkpoint\"' 
in your current directory when it expires. This ensures your work gets saved even if you forget!"
```

**VISUAL FLOW:**
```
┌─────────────────────────────────────────────────────────────────┐
│                 CLAUDE CODE SESSION (YOU)                       │
│                                                                 │
│  ┌───────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │               │    │              │    │                 │  │
│  │ "Set 2hr timer│───▶│    CLAUDE    │───▶│ create_timer(   │  │
│  │ to auto-commit│    │ Understands: │    │   duration="2h",│  │
│  │ my work"      │    │ • What: commit│    │   command="git  │  │
│  │               │    │ • When: 2hrs │    │   add . && git  │  │
│  │               │    │ • Where: here│    │   commit -m..." │  │
│  └───────────────┘    └──────────────┘    │ )               │  │
│                                           └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
            ┌───────────────────────────────────────────┐
            │            MINOOTS API                    │
            │                                           │
            │  Timer Created:                           │
            │  • Name: "Auto-commit checkpoint"         │
            │  • Duration: 2 hours                      │
            │  • Command: "git add . && git commit..."  │
            │  • Session: claude_abc123_working_dir     │
            │  • Webhook: https://bridge.minoots.com    │
            │                                           │
            └───────────────────────────────────────────┘
                                    │
                           ⏰ 2 HOURS LATER ⏰
                                    ▼
            ┌───────────────────────────────────────────┐
            │         TIMER EXPIRES & EXECUTES          │
            │                                           │
            │  1. Webhook → Bridge receives timer data  │
            │  2. Extracts: session + command + context │
            │  3. System daemon executes:               │
            │     claude --resume claude_abc123_working │
            │     --print "git add . && git commit..."  │
            │                                           │
            │  4. YOUR GIT COMMITS AUTOMATICALLY! 🎉    │
            │                                           │
            └───────────────────────────────────────────┘
```

**CONCRETE RESULTS:**
- ✅ Your work gets committed automatically after 2 hours
- ✅ No need to remember or set phone alarms  
- ✅ Happens in your exact working directory
- ✅ Can continue working, timer runs independently
- ✅ Perfect for preventing work loss during long coding sessions

**OTHER PRACTICAL EXAMPLES:**
```bash
"Set 30min timer to run my tests"        → npm test
"Set 1hr timer to deploy staging"        → npm run deploy:staging  
"Set 4hr timer to backup my database"    → pg_dump mydb > backup.sql
"Set 10min timer to remind me of meeting"→ open https://zoom.us/j/123456
```

---

## 🤝 MULTI-AGENT COORDINATION

```
Agent A (Research)     Agent B (Analysis)     Agent C (Reporting)
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│ 1. Starts work  │    │ 2. Waits for    │    │ 3. Waits for    │
│                 │    │    handoff      │    │    final data   │
│ Creates timer:  │    │                 │    │                 │
│ "Research done  │    │                 │    │                 │
│  in 30 min"     │    │                 │    │                 │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       ▲                       ▲
         │                       │                       │
         ▼                       │                       │
┌─────────────────────────────────────────────────────────────────┐
│                      MINOOTS TIMER SYSTEM                       │
│                                                                 │
│  Timer 1: "Agent A → Agent B handoff"                          │
│  • Duration: 30m                                               │
│  • Webhook: https://agent-b.system.com/start                   │
│  • Data: { research_results, next_agent: "B" }                 │
│                                                                 │
│  Timer 2: "Agent B → Agent C handoff"                          │
│  • Duration: 45m (created by Agent B)                          │
│  • Webhook: https://agent-c.system.com/start                   │
│  • Data: { analysis_results, next_agent: "C" }                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │                 │
                    │ WEBHOOK         │
                    │ DELIVERY        │
                    │                 │
                    │ • HTTP POST     │
                    │ • Retry Logic   │
                    │ • Failure       │
                    │   Handling      │
                    │                 │
                    └─────────────────┘
```

**Coordination Variables:**
- **Agent ID**: Who's currently working
- **Next Agent**: Who should take over
- **Context Data**: Work results, state, instructions
- **Team Session**: Shared coordination state

---

## 🔐 AUTHENTICATION FLOW FOR AGENTS

```
ANONYMOUS AGENT           API KEY AGENT              FIREBASE AGENT
┌─────────────────┐      ┌─────────────────┐       ┌─────────────────┐
│                 │      │                 │       │                 │
│ • 5 timers/day  │ ────▶│ • 100 timers/day│ ────▶ │ • Unlimited     │
│ • IP tracking   │      │ • API key auth  │       │ • Team features │
│ • No signup     │      │ • Persistent ID │       │ • Organizations │
│                 │      │                 │       │ • Analytics     │
└─────────────────┘      └─────────────────┘       └─────────────────┘
         │                        ▲                         ▲
         │                        │                         │
         ▼                        │                         │
┌─────────────────────────────────────────────────────────────────┐
│                      MINOOTS API GATEWAY                        │
│                                                                 │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐     │
│  │               │   │               │   │               │     │
│  │ ANONYMOUS     │   │ API KEY       │   │ FIREBASE      │     │
│  │ HANDLER       │   │ VALIDATOR     │   │ JWT VERIFIER  │     │
│  │               │   │               │   │               │     │
│  │ • IP tracking │   │ • Key lookup  │   │ • Token verify│     │
│  │ • Daily limits│   │ • User data   │   │ • User profile│     │
│  │ • Rate limits │   │ • Tier access │   │ • RBAC check  │     │
│  │               │   │               │   │               │     │
│  └───────────────┘   └───────────────┘   └───────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**Bootstrap Process:**
1. **Anonymous Agent** starts with IP-based tracking
2. **Gets API Key** through bootstrap endpoint
3. **Upgrades to Firebase** for team features

---

## ⚡ TIMER LIFECYCLE & VARIABLES

```
CREATE TIMER                ACTIVE TIMER               EXPIRED TIMER
┌─────────────────┐         ┌─────────────────┐        ┌─────────────────┐
│                 │         │                 │        │                 │
│ Agent Request   │────────▶│ Firebase        │───────▶│ Webhook         │
│                 │         │ Storage         │        │ Delivery        │
│ Variables:      │         │                 │        │                 │
│ • name          │         │ Tracking:       │        │ Payload:        │
│ • duration      │         │ • start_time    │        │ • timer_data    │
│ • agent_id      │         │ • end_time      │        │ • agent_context │
│ • session_id    │         │ • status        │        │ • custom_data   │
│ • webhook_url   │         │ • progress      │        │ • next_actions  │
│ • custom_data   │         │                 │        │                 │
│                 │         │                 │        │                 │
└─────────────────┘         └─────────────────┘        └─────────────────┘
```

**Variable Flow:**
- **Input Variables**: Set by agent at creation time
- **System Variables**: Added by MINOOTS (timestamps, IDs)
- **Output Variables**: Delivered to webhook with context

---

## 🏗️ SYSTEM ARCHITECTURE FOR AGENTS

```
                    ┌─────────────────────────────────────┐
                    │            AGENT LAYER              │
                    │                                     │
                    │  Claude Code  │  Custom AI  │ Bots  │
                    │  Agents       │  Agents     │       │
                    └─────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │            API GATEWAY              │
                    │                                     │
                    │ • Authentication  • Rate Limiting  │
                    │ • Input Validation • Error Handling│
                    └─────────────────────────────────────┘
                                      │
                                      ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │                 │    │                 │    │                 │
    │ TIMER ENGINE    │    │ WEBHOOK         │    │ AGENT DATA      │
    │                 │    │ DELIVERY        │    │ STORAGE         │
    │ • Creation      │    │                 │    │                 │
    │ • Scheduling    │    │ • HTTP POST     │    │ • Sessions      │
    │ • Expiration    │    │ • Retry Logic   │    │ • Variables     │
    │ • Status Track  │    │ • Failure Queue │    │ • State Data    │
    │                 │    │                 │    │                 │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │          FIREBASE BACKEND           │
                    │                                     │
                    │ • Functions    • Firestore         │
                    │ • Scheduling   • Authentication    │
                    │ • Monitoring   • Analytics         │
                    └─────────────────────────────────────┘
```

**Agent Perspective:**
- **Simple API**: Just HTTP requests with JSON
- **Persistent Timers**: Survive agent restarts/crashes
- **Rich Context**: Variables and metadata preserved
- **Reliable Delivery**: Webhooks with retry logic

---

## 🔧 MCP TOOL INTEGRATION VARIABLES

```
Claude Code Session Environment:
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Session Variables Available to MCP:                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  CLAUDE_SESSION_ID=claude_abc123_def456                 │   │
│  │  WORKING_DIRECTORY=/mnt/c/Users/millz/project           │   │
│  │  MINOOTS_API_KEY=mnt_user_api_key_here                  │   │
│  │  USER_ID=user_millz_hostname                            │   │
│  │  CURRENT_PROJECT=timer-system                           │   │
│  │  GIT_BRANCH=main                                        │   │
│  │  PROCESS_PID=12345                                      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  MCP Timer Tools:                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  create_timer(                                          │   │
│  │    duration="5m",                                       │   │
│  │    name="Claude session timer",                         │   │
│  │    webhook="https://bridge.minoots.com/webhook",        │   │
│  │    session_data={                                       │   │
│  │      session_id: CLAUDE_SESSION_ID,                     │   │
│  │      working_dir: WORKING_DIRECTORY,                    │   │
│  │      command: "echo 'Timer expired!'",                  │   │
│  │      user_id: USER_ID                                   │   │
│  │    }                                                    │   │
│  │  )                                                      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                Timer Created with Session Context
                                │
                                ▼
                When Timer Expires → Webhook Delivers:
                {
                  "event": "timer_expired",
                  "timer": { ... },
                  "session_data": {
                    "session_id": "claude_abc123_def456",
                    "working_dir": "/mnt/c/Users/millz/project",
                    "command": "echo 'Timer expired!'",
                    "user_id": "user_millz_hostname"
                  }
                }
                                │
                                ▼
                System Daemon Executes:
                claude --resume claude_abc123_def456 --print "echo 'Timer expired!'"
```

**Key Agent Variables:**
- **session_id**: Links timer back to specific agent session
- **working_directory**: Agent's current context
- **command**: What to execute when timer expires
- **user_context**: Agent's environment and state
- **metadata**: Custom agent data and workflow info

These diagrams show how MINOOTS is designed FOR agents - with session awareness, variable passing, and context preservation that human timer systems don't need!
