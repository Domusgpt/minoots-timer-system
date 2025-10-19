# Community Runbook — Discord & Reddit

## Setup Checklist
- Provision Discord server with channels noted in `CHANNEL_PLAYBOOK.md`.
- Install bots: MEE6 (leveling), Statbot (analytics), Typefully webhooks (content drip), Orbit integration (member CRM).
- Publish community guidelines pinned to `#launchpad` referencing MINOOTS Code of Conduct.
- Create notion-based member directory for high-signal contributors.

## Weekly Rhythm
| Day | Activity | Owner |
| --- | --- | --- |
| Monday | Tempo Check post (metrics + roadmap). | Community Manager |
| Tuesday | Builder spotlight (user story or timer recipe). | DevRel |
| Wednesday | Office Hours (30 minutes, recorded). | Engineering rotation |
| Thursday | Stream watch party or tutorial drop. | Community Moderator |
| Friday | Wins thread + next week's preview. | Community Manager |

## Engagement Programs
- **Timer Recipes** – Encourage members to share JSON/YAML timer definitions; feature top recipes in newsletter.
- **Observability Lab** – Monthly debug session analyzing OTEL traces and jitter metrics with engineering.
- **Partner Stage** – Invite ecosystem partners (Parserator, agent frameworks) for co-marketing AMAs.
- **Beta Access** – Offer early access codes for enterprise features (RBAC, governance) to engaged members.

## Moderation & Escalation
- Set up auto-moderation for spam links; flagged posts escalate via PagerDuty webhook.
- Clear guidelines for support vs. product feedback vs. feature requests.
- Document responses in shared Notion. Escalate bugs to `#control-plane-sos` Slack channel with reproduction steps.

## Success Metrics
- Weekly active members (WAM) target: 40% of total.
- Question-to-answer time < 2 hours during business days.
- 10 community-generated timer recipes per month.
- Net sentiment tracked via monthly survey; aim for 60+ NPS.
