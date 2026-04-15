---
name: webflow
description: Edit and publish Webflow website content — CMS items (text, fields), static page text, and site publishing via the Webflow v2 API. Use whenever the user wants to update website content, create blog posts, edit page text, or publish changes to their Webflow site.
allowed-tools: Bash
---

# Webflow Content Editor

Manage Webflow website content via the Webflow v2 API.

**Setup required:** `WEBFLOW_API_TOKEN` must be set in your `.env` file.

## How to run

```bash
node /home/node/.claude/skills/webflow/webflow <command> [args]
```

Or use the short alias set up in your session:
```bash
webflow <command>
```

If the alias isn't set, define it first:
```bash
alias webflow='node /home/node/.claude/skills/webflow/webflow'
```

## Workflow: Edit CMS content

```bash
# 1. Find your site ID
webflow sites

# 2. Find the collection (blog posts, products, etc.)
webflow collections <site-id>

# 3. List items and find the one to edit
webflow items <collection-id>
webflow item <collection-id> <item-id>

# 4. Update the item's text fields
webflow update <collection-id> <item-id> '{"fieldData":{"name":"New Title","body":"<p>New content</p>"}}'

# 5. Publish to make it live
webflow publish <site-id>
```

## Workflow: Edit static page text

```bash
# 1. Find your site and its pages
webflow sites
webflow pages <site-id>

# 2. Get the current page DOM (look for nodeId values)
webflow page-dom <page-id>

# 3. Update specific text nodes
webflow update-page-dom <page-id> '{"nodes":[{"nodeId":"<node-id>","text":{"text":"Updated text here"}}]}'

# 4. Publish
webflow publish <site-id>
```

## All commands

| Command | Description |
|---------|-------------|
| `webflow sites` | List all your Webflow sites |
| `webflow collections <site-id>` | List CMS collections for a site |
| `webflow items <collection-id>` | List all items in a collection |
| `webflow item <collection-id> <item-id>` | Get a single item with all fields |
| `webflow update <collection-id> <item-id> <json>` | Update item fields (partial update) |
| `webflow create <collection-id> <json>` | Create a new CMS item |
| `webflow delete <collection-id> <item-id>` | Delete a CMS item |
| `webflow pages <site-id>` | List all static pages |
| `webflow page-dom <page-id>` | Get page static content as DOM nodes |
| `webflow update-page-dom <page-id> <json>` | Update text in static page nodes |
| `webflow publish <site-id>` | Publish all changes to live site |

## JSON formats

### CMS item update
```json
{
  "fieldData": {
    "name": "Article Title",
    "slug": "article-slug",
    "body": "<p>Rich text content</p>",
    "post-summary": "Short description"
  },
  "isArchived": false,
  "isDraft": false
}
```

### Page DOM update (static text nodes)
```json
{
  "nodes": [
    {
      "nodeId": "a245c12d3258b",
      "text": { "text": "New heading text" }
    }
  ]
}
```

## Getting a Webflow API token

1. Go to [Webflow Dashboard](https://webflow.com/dashboard) → Account Settings → Integrations
2. Under **API Access**, generate a new token with CMS and Publishing permissions
3. Add to your `.env`: `WEBFLOW_API_TOKEN=your_token_here`
4. Restart NanoClaw (`launchctl kickstart -k gui/$(id -u)/com.nanoclaw` on macOS)
