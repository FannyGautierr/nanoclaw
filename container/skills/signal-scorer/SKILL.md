---
name: signal-scorer
description: Score Attio contacts by outreach signal strength. Takes contact data (last activity, deal stage, notes, company signals) and returns a score 1-10 with a one-line rationale. Use before selecting who to contact in an outreach run.
allowed-tools: mcp__attio__*
---

# Signal Scorer

Score a batch of Attio contacts to prioritise outreach. Higher score = stronger reason to reach out now.

## Scoring model

For each contact, evaluate these dimensions and sum the weighted scores:

### 1. Recency gap (0–3 pts)

Days since last activity of any type (email, meeting, note, call):

| Gap | Score |
|-----|-------|
| > 60 days | 3 |
| 30–60 days | 2 |
| 14–30 days | 1 |
| < 14 days | 0 |

### 2. Deal momentum (0–3 pts)

| Situation | Score |
|-----------|-------|
| Active deal, stalled > 14 days | 3 |
| Active deal, last activity 7–14 days ago | 2 |
| No deal but previously engaged | 1 |
| Deal won or lost recently | 0 |

### 3. External signal (0–2 pts)

Flags in Attio notes or custom fields suggesting a buying signal:

| Signal | Score |
|--------|-------|
| Recent event, hire, or product launch noted | 2 |
| Mentioned pain point or interest in notes | 1 |
| No signals noted | 0 |

### 4. Relationship warmth (0–2 pts)

Based on number and recency of past interactions:

| History | Score |
|---------|-------|
| Multiple past touchpoints, last one positive | 2 |
| At least one past interaction | 1 |
| Cold / first contact | 0 |

## Output format

For each contact, output:

```
[Name] — [Company] | Score: X/10
Rationale: [one sentence explaining the top signal]
```

Sorted highest to lowest.

## Usage

When called by the outreach workflow:

1. Receive the list of contacts already fetched from Attio
2. For each contact, evaluate the four dimensions using the data available
3. Return the ranked list with scores and rationale
4. The outreach agent picks the top 5

If data is missing for a dimension (e.g., no deal stage info), assign 0 for that dimension and note it.
