---
name: outreach
description: Run a full outreach campaign: pull preferred partners from Attio, score by signal strength, research each via Perplexity, draft personalized emails, present on Slack for approval, then send via Gmail. Triggered from the slack_outreach channel.
allowed-tools: Bash(perplexity-search), mcp__attio__*, mcp__gmail__*
---

# Outreach Skill

End-to-end outreach automation for B2B campaigns targeting industrial companies.

## Perplexity research

Use the `perplexity-search` command to research a company or person before drafting:

```bash
perplexity-search "Acme Industries CEO John Dupont news 2025"
perplexity-search "Acme Industries industrial automation recent"
```

The script outputs a text summary from Perplexity's online model. Use it to find:
- Recent hires, funding, partnerships
- Industry events or trade shows they attended
- Product launches, contracts won, press coverage
- Regulatory or market context relevant to their sector

If the script returns an error or empty result, skip Perplexity for that contact and rely on Attio history alone.

## Gmail accounts

Send emails using the Gmail MCP. The user will specify which account alias to use. Configured accounts are listed in `.env` as `GMAIL_ACCOUNT_*` entries.

Default account for outreach: the OSS account (`GMAIL_FROM_OSS`).

To send:
1. Use `mcp__gmail__send_email` with `from`, `to`, `subject`, `body`
2. After sending, log a note on the Attio record via `mcp__attio__create_note`

## Perplexity script setup

The `perplexity-search` script is at `/home/node/.claude/skills/outreach/perplexity-search`.

If it's not executable yet:
```bash
chmod +x /home/node/.claude/skills/outreach/perplexity-search
```

Requires `PERPLEXITY_API_KEY` in `.env`.
